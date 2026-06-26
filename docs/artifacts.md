# Artifact 契约

## Run 目录结构

```text
runs/<runId>/
├─ state.json
├─ input/
│  ├─ requirement.md
│  └─ initial-plan.md
├─ round-001/
│  ├─ workers/<role>/
│  │  ├─ task/
│  │  │  ├─ task.md
│  │  │  ├─ input-manifest.json
│  │  │  └─ output-schema.json
│  │  ├─ output/result.json
│  │  ├─ logs/stdout.log
│  │  ├─ logs/stderr.log
│  │  └─ meta/
│  │     ├─ adapter.json
│  │     └─ run-result.json
│  ├─ ledgers/
│  │  ├─ issue-ledger.json
│  │  └─ disagreement-ledger.json
│  ├─ decisions/
│  │  ├─ decision-queue.json
│  │  └─ user-decisions.json
│  ├─ revision/
│  │  ├─ revised-plan.md
│  │  └─ revision-log.json
│  ├─ regression/regression-report.json
│  └─ convergence/convergence-report.json
└─ final/
   ├─ final-plan.md
   └─ final-report.json
```

部分文件只在 workflow 到达对应阶段后存在。例如，`user-decisions.json` 只会在等待中的 run 被 resume 后出现。

## Artifact Ref

`PlanReviewState.artifacts` 存储 `ArtifactRef`，不内联大块 artifact 内容。每个 ref 记录 `id`、`type`、`runId`、`round`、`path` 和 `producedBy`。state 应保持紧凑；完整 issue 内容应放在 ledger 和 worker result 中。

## Schema 归属

- `artifact.ts`：artifact type 与 artifact ref。
- `state.ts`：持久化 run state。
- `worker.ts`：各 role 的 worker result schema。
- `issue.ts`：issue 和 merged issue。
- `ledger.ts`：issue ledger 与 disagreement ledger。
- `decision.ts`：decision queue 与 user decisions。
- `revision.ts`：revision log。
- `regression.ts`：regression report 与 convergence report。

## 更新规则

修改 artifact 结构时，必须同步更新 schema、fixture 和测试。计划执行或预期输出不能作为验证证据；只有实际运行生成的文件或测试断言验证过的结果，才能作为已验证行为。
