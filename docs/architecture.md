# 架构说明

## Runtime 概览

`src/graph/LangGraphWorkflowRuntime.ts` 是主要编排边界。它创建 run、复制输入文件、调用 worker、写入 ledger artifact、处理人工决策 resume 数据、评估 convergence，并持久化 `state.json`。

## 模块职责

- `src/cli/`：`plan-review start` 的 CLI 入口、参数解析和用户可见输出。
- `src/graph/`：workflow runtime、节点状态 patch 和阶段迁移。
- `src/graph/nodes/`：workflow 节点，例如 blind review。
- `src/workers/`：worker adapter 接口、registry 和 mock adapter。
- `src/schemas/`：state、artifact、worker、issue、decision、ledger、revision、regression 的 Zod schema。
- `src/artifacts/`：artifact 路径构造和相关工具。
- `src/state/`：基于文件的 state 持久化。
- `src/utils/`：文件系统工具，例如原子写 JSON 和文本。

## Worker 边界

Worker 实现 `AgentWorkerAdapter<I, O>`，接收 `AgentWorkerTask` 和 `AgentWorkerContext`。context 提供 run、round、role、worker 目录、输出目录和日志路径。

当前可运行 adapter 是 `MockAgentWorkerAdapter`。它读取 fixture JSON，按 role schema 校验输出，并写入 task metadata、result JSON、日志和 adapter metadata。mock worker 不应访问网络，也不应依赖真实 API key。

## Schema 边界

Schema 模块是 runtime、fixture、测试和生成 artifact 之间的契约。不要只修改 runtime 就改变 artifact 结构；必须同步更新对应 Zod schema，并补充测试证明合法与非法数据路径都符合预期。

## 当前限制

CLI 需要同时传入 `--requirement` 和 `--plan`。虽然类型定义中存在 planner 和多种 worker kind，当前 CLI 路径只注册 architecture、execution、risk、reviser 和 regression 这几类 mock worker。
