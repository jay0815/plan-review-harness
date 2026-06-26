# 开发指南

## 常用命令

```bash
pnpm build
pnpm test
pnpm calibration:test
pnpm typecheck
pnpm lint
pnpm lint:fix
pnpm fmt
pnpm fmt:check
pnpm plan-review -- start --requirement fixtures/sample-requirement.md --plan fixtures/sample-plan.md
```

- `pnpm build`：使用 Vite 构建 ESM 输出，并用 `tsc -p tsconfig.build.json --emitDeclarationOnly` 生成声明文件。
- `pnpm test`：运行核心 TypeScript harness 的 Vitest 测试套件。
- `pnpm calibration:test`：运行 `model-role-calibration/scripts/` 下的历史 JS 校准和回归脚本。
- `pnpm lint` / `pnpm lint:fix`：使用根级 `.oxlintrc.json` 检查或修复 `src/`、`tests/` 和配置文件。
- `pnpm fmt` / `pnpm fmt:check`：使用 oxfmt 格式化或检查源文件、文档、fixtures 和配置。
- `pnpm plan-review -- start ...`：使用 mock workers 执行一次本地 review run。

## 编码风格

使用 strict TypeScript 和 NodeNext ESM。TypeScript 文件中的相对导入应显式包含 `.js` 扩展名，保持与现有代码一致。格式化由 oxfmt 管理：单引号、无分号、两空格缩进、120 字符宽度。

类和 schema 使用 PascalCase，函数与变量使用 camelCase，fixture 文件名使用 `review.architecture.json`、`regression.round1.json` 这类点分命名。

## 测试

Vitest 测试位于 `tests/unit/` 和 `tests/integration/`，文件名使用 `*.test.ts`，通过 `pnpm test` 运行。单元测试覆盖模块行为，集成测试覆盖 CLI、workflow 阶段、artifact 目录结构、schema 兼容性和持久化契约。

`model-role-calibration/scripts/*.js` 属于历史校准工具链，通过 `pnpm calibration:test` 单独验证。只有修改 `model-role-calibration/` 或相关 package scripts 时，才需要把它纳入本轮验证。

`model-role-calibration/package.json` 只用于声明 CommonJS 模块边界，避免根包 `"type": "module"` 改变旧脚本语义。

生成文件的测试应使用 `mkdtemp` 创建临时目录，并在 `finally` 中清理。不要让测试依赖仓库现有 `runs/` 内容。

## 格式化范围

`.oxfmtrc.json` 是根级 formatter 配置。`pnpm fmt` 使用 `--disable-nested-config`，只读取当前配置，并通过脚本路径限制格式化范围。`runs/`、`dist/`、`node_modules/`、`coverage/` 和 `tests/fixtures/malformed/` 会被忽略；其中 malformed fixtures 用于测试错误输入，不应被 formatter 解析或修复。

## Lint 范围

`.oxlintrc.json` 是根级 linter 配置。`pnpm lint` 使用 `--disable-nested-config`，只读取当前配置，并通过脚本路径限制检查范围。配置中集中维护 `ignorePatterns`，忽略 `node_modules/`、`dist/`、`coverage/`、`runs/` 和 malformed fixtures。测试文件通过 override 启用 Vitest 环境和插件；当前未启用 `typeAware` 或 `typeCheck`，因为它们需要额外的 `oxlint-tsgolint` 依赖。

## 变更流程

修改 runtime 行为前，先确认：

1. 要解决的真实问题是什么。
2. 最小完整实现是什么。
3. 哪些 workflow、schema、fixture 或 artifact 行为可能被破坏。

行为变更优先采用 TDD：先写失败测试，再实现最小修复，通过后再按需重构。文档或纯配置变更可以不运行测试，但需要在交付说明中说明原因。

## Pull Request

当前 Git 历史只有 `init`，尚无严格提交约定。提交标题使用简短祈使句。PR 描述应说明 workflow 影响、变更的 schema 或 fixture、生成 artifact 变化，以及已运行的验证命令。
