# Fix-004: synthesis issue 合并逻辑

## 现状

`LangGraphWorkflowRuntime.ts` 的 `synthesizeAndMaybePause()` 方法中，issue 处理存在三段独立逻辑：

1. **mergedIssues**（第 182-188 行）：从原始 issues 做简单映射，每个都标记为 `single_point`
2. **disagreements**（第 200-216 行）：从原始 `l3Issues`（severity=blocker）生成，不使用 mergedIssues
3. **decisionQueue**（第 228-253 行）：从原始 `l3Issues` 生成，不使用 mergedIssues

问题：即使 mergedIssues 做了共识合并，disagreements 和 decisionQueue 仍然使用原始 issues，重复问题会进入人工决策队列。

## 影响

- **decision queue 膨胀**：三个 reviewer 报告同一问题时，用户需要对同一问题做三次决策
- **缺乏共识信号**：无法区分共识问题和单点问题
- **合并结果未被消费**：mergedIssues 写入 issue ledger 后，下游逻辑完全忽略它

## 方案

### 1. 重写合并逻辑

基于 title 归一化检测重复 issue：

```ts
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function mergeIssues(issues: Issue[]): MergedIssue[] {
  const groups = new Map<string, Issue[]>()
  for (const issue of issues) {
    const key = `${normalizeTitle(issue.title)}::${issue.planRef}::${issue.type}`
    const existing = groups.get(key)
    if (existing) existing.push(issue)
    else groups.set(key, [issue])
  }

  return Array.from(groups.values()).map((group) => {
    const first = group[0]
    const supporters = [...new Set(group.map((i) => i.sourceWorkerId ?? 'unknown'))]
    const status: MergedIssue['status'] = supporters.length >= 2 ? 'consensus' : 'single_point'
    return {
      ...first,
      id: `MERGED-${first.id}`,
      supportedBy: supporters,
      status,
      relatedIssueIds: group.map((i) => i.id),
    }
  })
}
```

### 2. 全链路使用 mergedIssues

重写 `synthesizeAndMaybePause()` 中的三段逻辑，确保都从 mergedIssues 派生：

```ts
// 第一步：合并 issues
const mergedIssues = mergeIssues(issues)

// 第二步：写入 issue ledger（已有逻辑，使用 mergedIssues）

// 第三步：disagreements 从 mergedIssues 的 blocker 生成
const l3MergedIssues = mergedIssues.filter((i) => i.severity === 'blocker')
const issuesById = new Map(issues.map((issue) => [issue.id, issue]))
const positionsFor = (issue: MergedIssue) =>
  issue.relatedIssueIds.map((issueId) => {
    const original = issuesById.get(issueId)
    return {
      workerId: original?.sourceWorkerId ?? 'unknown',
      claim: original?.claim ?? issue.claim,
      confidence: original?.confidence ?? issue.confidence,
      reasoning: original?.suggestion ?? issue.suggestion,
    }
  })

const disagreements = l3MergedIssues.map((issue) => ({
  id: `disagreement-${issue.id}`,
  issueId: issue.id, // 直接用 mergedIssues 的 id
  title: issue.title,
  level: 'L3' as const,
  positions: positionsFor(issue),
  humanDecisionRequired: true,
  createdAt: now(),
}))

// 第四步：decisionQueue 从 mergedIssues 的 blocker 生成
const queue: DecisionQueue = {
  runId: state.runId,
  round: state.round,
  items: l3MergedIssues.map((issue) => ({
    id: `decision-${issue.id}`,
    disagreementId: `disagreement-${issue.id}`,
    title: issue.title,
    description: issue.claim,
    options: [
      { key: 'adopt', label: 'Adopt', description: 'Adopt the issue suggestion.' },
      { key: 'reject', label: 'Reject', description: 'Reject the issue suggestion.' },
    ],
    context: {
      positions: positionsFor(issue),
      relatedIssues: [issue.id],
      impactSummary: issue.impact,
    },
    createdAt: now(),
  })),
  createdAt: now(),
}
```

### 3. 不做自动丢弃

之前方案提到"如果 blocker 数量过多（>5），只保留 consensus + severity=blocker 的 issue 进入 queue，其余自动进入下一轮"。这个设计**不做**，因为：

- 没有 schema/state 承载"自动进入下一轮"的语义
- 静默丢弃需要人工裁决的问题比 queue 膨胀更危险
- consensus vs single_point 的排序已足够让用户快速聚焦

### 4. 确认状态语义

`MergedIssueStatusSchema` 已包含所有需要的枚举值：

- `consensus`：多个 reviewer 独立发现同一问题
- `single_point`：仅一个 reviewer 报告

无需修改 schema。

### 5. 测试重点

新增集成测试时必须覆盖两个层面：

- issue ledger 中重复问题被合并，`supportedBy` 和 `relatedIssueIds` 保留全部来源
- decision queue 和 disagreement ledger 也只生成一个条目，并且 `context.positions` 分别保留每个原始 reviewer 的 claim/confidence/suggestion，而不是把第一个 issue 的内容复制给所有 supporter

## 涉及文件

| 文件                                    | 改动                                                      |
| --------------------------------------- | --------------------------------------------------------- |
| `src/graph/LangGraphWorkflowRuntime.ts` | 重写 `synthesizeAndMaybePause()`，全链路使用 mergedIssues |

## 验收

- 三个 reviewer 报告同一问题时，decision queue 中只有一个条目，`supportedBy` 包含三个 workerId
- 只有一个 reviewer 报告时，decision queue 中有一个条目，`supportedBy` 包含一个 workerId
- disagreements 的 `issueId` 引用 mergedIssues 的 id，而非原始 issue id
- disagreements 和 decision queue 的 `positions` 与原始 issue 一一对应
- `pnpm test` 通过
