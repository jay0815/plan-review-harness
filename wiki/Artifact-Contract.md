# Artifact 契约

每个 run 写入 `runs/<runId>/`，核心文件包括：

- `state.json`
- `input/requirement.md`
- `input/initial-plan.md`
- `round-001/workers/<role>/output/result.json`
- `round-001/ledgers/issue-ledger.json`
- `round-001/ledgers/disagreement-ledger.json`
- `round-001/decisions/decision-queue.json`
- `round-001/revision/revised-plan.md`
- `round-001/regression/regression-report.json`
- `round-001/convergence/convergence-report.json`
- `final/final-report.json`

`PlanReviewState.artifacts` 保存 artifact ref，不保存完整正文。修改 artifact 结构时必须同步 schema、fixture 和测试。

详细说明见 [docs/artifacts.md](../docs/artifacts.md)。
