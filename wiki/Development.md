# 开发指南

常用命令：

```bash
pnpm build
pnpm test
pnpm calibration:test
pnpm calibration:typecheck
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm plan-review -- start --requirement fixtures/sample-requirement.md --plan fixtures/sample-plan.md
```

编码规则：

- 使用 strict TypeScript 和 NodeNext ESM。
- 相对导入显式包含 `.js` 扩展名。
- oxfmt 负责格式化：单引号、无分号、两空格缩进、120 字符宽度。
- oxlint 使用根级 `.oxlintrc.json`，并在脚本中禁用 nested config lookup。
- `pnpm test` 运行核心 TypeScript harness 的 Vitest 测试，文件名为 `*.test.ts`。
- `pnpm calibration:test` 先类型检查校准工具链，再通过 TS runner 运行校准和回归脚本。
- `pnpm calibration:typecheck` 检查 `model-role-calibration/` 的 TypeScript 源码。
- `model-role-calibration/package.json` 只声明 CommonJS 模块边界，避免根包 ESM 设置影响脚本中的 `__dirname`、`__filename` 等运行语义。

行为变更优先采用 TDD。修改 workflow、schema、fixture 或 artifact 行为时，需要同步更新测试和文档。

详细说明见 [docs/development.md](../docs/development.md)。
