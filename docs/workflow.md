# Workflow

## Start

`plan-review start` 创建 `run-<uuid>`，把 requirement 复制到 `input/requirement.md`，把 initial plan 复制到 `input/initial-plan.md`，初始化 `PlanReviewState`，然后进入 `blind_review`。

## Blind Review

Blind review 节点会调用三个 reviewer role：

- `architecture-reviewer`
- `execution-reviewer`
- `risk-reviewer`

每个 reviewer 接收 requirement/current-plan artifact ref、review dimension 和当前 round。输出会通过 `ReviewResultSchema` 校验，并作为 review artifact ref 写入 state。

## Synthesis 与 Human Gate

Runtime 读取所有 review 输出，把 issue 合并到 issue ledger，为 blocker issue 生成 disagreement ledger 和 decision queue。如果存在 blocker issue，run 状态变为 `waiting_for_decision`；如果不存在 blocker issue，则直接进入 revision。

## Resume

`LangGraphWorkflowRuntime.resume()` 会加载等待中的 run，校验用户决策是否匹配 decision queue，写入 `decisions/user-decisions.json`，然后从 revision 继续。该能力当前存在于 runtime API 中，尚未暴露为 CLI 命令。

## Revision、Regression 与 Convergence

Reviser 生成 `revision/revised-plan.md` 和 `revision/revision-log.json`。Regression worker 生成 `regression/regression-report.json`。Convergence 根据 blocker/high issue 数量决定下一步：

- 没有 blocker/high issue：`done`
- 仍有 blocker/high issue 且未达到 round 上限：`continue`
- 达到 round 上限仍有 blocker/high issue：`blocked`

如果继续，revised plan 会成为下一轮的 current plan。如果完成或阻塞，最终产物写入 `final/`。

## State 状态

主要持久化状态包括 `running`、`waiting_for_decision`、`completed` 和 `blocked`。schema 还保留 `initialized` 与 `failed`，用于覆盖更完整的生命周期。
