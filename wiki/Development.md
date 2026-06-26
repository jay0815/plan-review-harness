# 开发指南

常用命令：

```bash
pnpm build
pnpm test
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
- 测试使用 Vitest，文件名为 `*.test.ts`。

行为变更优先采用 TDD。修改 workflow、schema、fixture 或 artifact 行为时，需要同步更新测试和文档。

详细说明见 [docs/development.md](../docs/development.md)。
