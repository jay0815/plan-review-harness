# 隐式约定

## 代码约定

### 错误处理
- 基础设施错误（超时、网络）记录到 `infra_errors`，支持重试
- 逻辑错误（验证失败）直接抛出，不重试
- retry 时重置 `finished_at`、`report_file`、`infra_errors` 字段

### 状态机
- run 状态: created → running → completed / failed
- retry 状态: queued → running → completed / failed
- 状态变更必须同步更新 `state.json` 和 `run-manifest.json`

### 文件路径
- reviewer 产物: `roles/<role>/metadata.json`, `roles/<role>/stdout.jsonl`
- 验证产物: `report.json`, `plan-authoring-lint.json`
- 所有路径相对于 `workspace-runs/<run-id>/`

## 评审约定

### Read Boundary
- reviewer 的读取范围受 `read_boundary` 约束
- `exposed_root` 是 reviewer 能看到的路径
- `source_root` 是实际代码路径
- 越界读取产生 warning，不阻塞评审

### Evidence 约束
- reviewer 输出的 issue 必须附带 evidence
- fact_check 验证 evidence 的有效性
- 无效 evidence 会被标记，但不自动移除
