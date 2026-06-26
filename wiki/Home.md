# Plan Review Harness Wiki

Plan Review Harness 是一个用于验证 plan review workflow 的 TypeScript runtime。它协调 review worker，写入经过 schema 校验的 artifact，处理决策门，修订计划，并判断是否收敛。

## 页面导航

- [快速开始](Getting-Started.md)
- [架构说明](Architecture.md)
- [Workflow](Workflow.md)
- [Artifact 契约](Artifact-Contract.md)
- [开发指南](Development.md)

## 当前实现

当前 CLI 支持 `plan-review start`，并要求传入 requirement 文件和 initial plan 文件。可运行路径使用 fixture 驱动的 mock workers。Runtime 中已有 resume 行为，但尚未提供 CLI resume 命令。

`model-role-calibration/` 是历史 CommonJS 校准工具链，和根 TypeScript ESM harness 分开维护。

## 维护原则

`docs/` 是详细文档源，`wiki/` 提供面向浏览的知识库入口。修改 workflow、schema 或 artifact 行为时，应同步更新相关 docs 和 wiki 页面。
