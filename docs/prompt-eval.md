# Prompt Eval Foundation

## 目标

`src/prompt-eval/` 是跨项目 prompt 评估迭代的原型基础。当前放在 Plan Review Harness 中 dry-run，长期目标是迁移到 `harness-kit`，供 plan review、change-assurance 和后续 agent workflow 共享。

核心原则：评估核心保持项目无关，只定义 case、observed output、check、result、manifest 和 report。具体项目通过 adapter 负责运行模型、读取本地输入、归一化输出。

## 模块边界

- `schemas.ts`：Zod 契约，定义 eval case、观测输出、单项检查、case result、run manifest 和 report。
- `scoring.ts`：确定性评分，包括 outcome 白名单、必须命中、禁止命中、必需证据和 baseline 对比。
- `runner.ts`：薄编排层，调用项目 adapter，返回 manifest、results 和 report。

不在核心中实现：模型调用、prompt 文件加载、YAML/JSON case discovery、judge model、人工评分 UI、项目特定 artifact 解析。

## 评估流程

1. 项目提供 `PromptEvalCase[]` 和 `PromptEvalAdapter`。
2. adapter 执行 prompt 或 workflow，并返回 `PromptEvalObservedOutput`，或返回包含 `observed`、`checks`、`artifacts`、`metadata` 的 adapter result。
3. deterministic scorer 生成 checks 和 case result。
4. run 聚合为 manifest 和 report。
5. 如传入 baseline results，report 会标记 regressions 和 improvements。

## 文件型 Dry Run

当前仓库提供 JSON-only 的文件发现和持久化能力，用于验证契约和本地回归，不引入 YAML 依赖。

```bash
pnpm plan-review -- prompt-eval \
  --cases evals/cases \
  --observed-dir evals/observed \
  --output-dir runs/prompt-eval/eval-1 \
  --run-id eval-1 \
  --project-name plan-review-harness
```

- `--cases` 可以指向单个 JSON 文件或目录；目录会递归读取 `*.json`。
- case 文件可以是单个 `PromptEvalCase`、`PromptEvalCase[]`，或 `{ "cases": [...] }`。
- `--observed-dir` 使用 `<case-id>.json` 映射到 `PromptEvalObservedOutput`。
- `--output-dir` 写入 `run-manifest.json`、`results.json` 和 `report.json`。
- `--baseline` 可指向旧的 `results.json`，用于计算 regressions/improvements。

## Case 示例

```ts
const testCase = {
  version: 1,
  id: 'plan-review.rollback',
  suite: 'golden',
  domain: 'plan-review',
  role: 'architecture-reviewer',
  title: 'Detect missing rollback plan',
  input: { kind: 'inline', value: { plan: 'Deploy without rollback steps.' } },
  expectations: {
    allowedOutcomes: ['issues_found'],
    mustFind: [{ id: 'rollback-missing', title: 'rollback', severity: 'high' }],
    mustNotFind: [{ id: 'no-kubernetes-claim', text: 'Kubernetes' }],
    requiredEvidence: [{ path: 'plan.md', quote: 'rollback' }],
  },
}
```

## Adapter 示例

```ts
const adapter = {
  id: 'change-assurance-local',
  async evaluate(testCase) {
    const output = await runProjectWorkflow(testCase.input)
    return {
      observed: {
        outcome: output.status,
        findings: output.issues.map((issue) => ({
          id: issue.id,
          title: issue.title,
          text: issue.summary,
          severity: issue.severity,
          evidence: issue.evidence,
        })),
      },
      checks: [
        {
          id: 'change-assurance.coverage',
          category: 'contract',
          status: output.coverage.passed ? 'pass' : 'fail',
          message: output.coverage.message,
          score: output.coverage.passed ? 1 : 0,
        },
      ],
    }
  },
}
```

adapter 返回的 `checks` 用于项目特定的确定性检查，例如 coverage、verification、policy contract 或 artifact completeness。通用 scorer 仍会基于 expectations 自动生成 deterministic checks。

## Baseline 语义

失败不是自动回归。只有当前 result 相比 baseline 变差时才进入 `report.regressions`；当前 result 相比 baseline 变好时进入 `report.improvements`。没有 baseline 时，report 只汇总通过率和平均分。`skipped` 表示未评估，不参与 regressions/improvements 判断。

## 迁移约束

后续迁到 `harness-kit` 时，优先搬迁 `src/prompt-eval/`、`tests/unit/prompt-eval.test.ts` 和本文档。各项目只保留 adapter、case discovery 和项目专属 fixture，不能把 plan-review runtime、workspace review 脚本或 calibration 历史结构引入评估核心。
