# 架构说明

核心编排入口是 `LangGraphWorkflowRuntime`。它负责创建 run、复制输入、调用 worker、写入 ledger、处理 resume、执行 revision/regression，并持久化 state。

主要模块：

- `src/cli/`：CLI 入口。
- `src/graph/`：workflow 编排和阶段迁移。
- `src/workers/`：worker adapter 与 registry。
- `src/schemas/`：artifact、state 和 worker 输出契约。
- `src/artifacts/`、`src/state/`：路径与持久化。

当前可运行 worker 是 `MockAgentWorkerAdapter`，它只读取 fixture 并写入标准 worker artifact。

详细说明见 [docs/architecture.md](../docs/architecture.md)。
