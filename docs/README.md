# Plan Review Harness 文档

Plan Review Harness 是一个用于编排 plan review workflow 的 TypeScript runtime spike。它负责冻结输入需求与计划，调用多个 review worker，合成 issue，必要时进入人工决策门，修订计划，执行 regression review，并写入可追溯 artifact。

## 文档地图

- [快速开始](getting-started.md)：安装、运行 mock review、查看输出。
- [架构说明](architecture.md)：模块职责、runtime 边界和 worker 契约。
- [Workflow](workflow.md)：从 `start` 到最终输出的已实现阶段。
- [Artifact 契约](artifacts.md)：run 目录结构、artifact 类型和 schema 归属。
- [Prompt Eval Foundation](prompt-eval.md)：跨项目 prompt 评估契约、adapter 边界和 baseline 语义。
- [Prompt Eval Adapter Plan](prompt-eval-adapter-plan.md)：迁移到 `harness-kit` 以及接入 `change-assurance` 的分层计划。
- [开发指南](development.md)：命令、编码风格、测试和变更规则。

## 当前范围

根包是 TypeScript ESM harness。CLI 当前暴露 `start` 和 `resume`；可运行路径使用 `MockAgentWorkerAdapter` 和 `fixtures/mock/` 下的 fixture。其他非 mock worker kind 仍是类型层面的预留能力，尚未实现适配器。

`src/prompt-eval/` 是跨项目 prompt 评估基础模块的 dry-run 原型。它只维护通用 schema、deterministic scoring、runner 和 report 语义；项目级 case discovery、模型调用和输出归一化通过 adapter 接入，后续目标是迁移到 `harness-kit`。

`model-role-calibration/` 是校准工具链，源码位于 `scripts/**/*.ts`，package scripts 通过 `node --import tsx` 直接执行 TS。默认 `pnpm test` 只运行核心 Vitest 测试；校准脚本通过 `pnpm calibration:typecheck` 和 `pnpm calibration:test` 单独验证。`plan-review:package` 会在打包 Claude Code 分发包时临时编译自包含 JS，但这些 JS 不作为仓库源码维护。

## 事实来源

以 `package.json` 判断包管理器和可用脚本，以 `src/schemas/` 判断 artifact 与 state 契约。`runs/` 下内容是生成产物；除非任务明确要求刷新示例输出，否则不要把它当作需要手工维护的源文件。
