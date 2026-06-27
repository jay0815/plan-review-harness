# Plan Review Harness 文档

Plan Review Harness 是一个用于编排 plan review workflow 的 TypeScript runtime spike。它负责冻结输入需求与计划，调用多个 review worker，合成 issue，必要时进入人工决策门，修订计划，执行 regression review，并写入可追溯 artifact。

## 文档地图

- [快速开始](getting-started.md)：安装、运行 mock review、查看输出。
- [架构说明](architecture.md)：模块职责、runtime 边界和 worker 契约。
- [Workflow](workflow.md)：从 `start` 到最终输出的已实现阶段。
- [Artifact 契约](artifacts.md)：run 目录结构、artifact 类型和 schema 归属。
- [开发指南](development.md)：命令、编码风格、测试和变更规则。

## 当前范围

根包是 TypeScript ESM harness。CLI 当前只暴露 `start`；`LangGraphWorkflowRuntime` 中已有 resume 行为，但尚未提供 CLI resume 命令。当前可运行路径使用 `MockAgentWorkerAdapter` 和 `fixtures/mock/` 下的 fixture；其他非 mock worker kind 仍是类型层面的预留能力，尚未实现适配器。

`model-role-calibration/` 是校准工具链，源码位于 `scripts/**/*.ts`，并由 `pnpm calibration:build` 生成 CommonJS 兼容的 `scripts/**/*.js`。子目录 `package.json` 用于和根包的 `"type": "module"` 隔离。默认 `pnpm test` 只运行核心 Vitest 测试；校准脚本通过 `pnpm calibration:typecheck`、`pnpm calibration:build` 和 `pnpm calibration:test` 单独验证。

## 事实来源

以 `package.json` 判断包管理器和可用脚本，以 `src/schemas/` 判断 artifact 与 state 契约。`runs/` 下内容是生成产物；除非任务明确要求刷新示例输出，否则不要把它当作需要手工维护的源文件。
