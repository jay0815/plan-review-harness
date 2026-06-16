---
name: plan-review
description: 仅在用户显式调用 /plan-review 时，使用 plan-review-harness MCP 对计划文件或用户粘贴的计划正文执行多角色只读工程评审，并输出带问题节点映射的 Mermaid 流程图、分歧和修订清单。
allowed-tools:
  - mcp__plan-review-harness__start_plan_review
  - mcp__plan-review-harness__get_plan_review
---

# Plan Review

按以下流程执行，不要让用户重复提供固定调用说明。

1. 根据 `$ARGUMENTS` 确定计划来源：
   - `$ARGUMENTS` 非空时，始终将其作为计划文件路径，不要把它解释为计划正文。不要使用 `Read` 读取文件；将路径直接传给 MCP 的 `plan_file`，由 MCP 完成文件校验和读取。
   - `$ARGUMENTS` 为空时，只询问：`请粘贴需要审查的完整计划正文。` 将用户下一条非空回复作为计划全文，不要求用户创建文件。
2. 计划内容为空时停止，不要调用 MCP。
3. 调用 `plan-review-harness` 的 `start_plan_review`：
   - 文件模式：只传 `plan_file: $ARGUMENTS`，不要传 `plan`。
   - 粘贴模式：只传 `plan`，不要传 `plan_file`。
   - `context`：`全角色计划评审。只评审计划，不修改工程文件。`
   - 不传 `roles`，使用默认全部 Reviewer。
   - 通常不传 `project_root`，让 MCP 使用当前 Claude Code 工程目录。
4. 同一计划只调用一次 `start_plan_review`。
5. 立即按返回的 `next_action` 调用 `get_plan_review`。
6. `get_plan_review` 运行期间保持等待 progress notification。禁止使用 Bash、`sleep`、Monitor、`execution_log`、`claude mcp call` 或其他外部方式查询状态。
7. 只有当 `get_plan_review` 返回 `status: running` 和新的 `next_action` 时，才按其参数再次调用。
8. `status: failed` 时输出失败阶段和 MCP 返回的错误，不自行重跑。
9. `status: completed` 时按下述格式展示，不修改工程文件。

## 输出格式

### 结论

输出 `run_id`、参与角色、完成状态，以及阻塞项数量和需要人工裁决的分歧数量。

### 流程图

直接渲染 `report.synthesis.output.process_map.mermaid`：

```mermaid
<mermaid>
```

不得自行补画报告中不存在的节点或关系。
如果结果缺少 `process_map`，说明该任务使用旧版输出契约，提示用户重新发起评审，不要自行生成流程图。

### 节点问题

按 `process_map.nodes` 的流程顺序分组。只展示 `status` 为 `affected` 或 `decision` 的节点：

- 节点名称和阶段。
- 关联问题标题、严重程度、来源和证据。
- 为什么影响该节点。
- 最小修订目标。

### 人工决策

只列 `needs_human_decision: true` 的分歧，保留决策选项和影响。没有时写“无”。

### 可能误报

展示 `likely_false_positives`，不要混入修订清单。

### 修订清单

按 `revision_instructions` 顺序输出可执行清单。

### Reviewer 附录

每个 Reviewer 只输出模型、问题数量和一行角色侧重点，不重复粘贴全部 issues。
