# Fix-012: toolchain 边界文档化

## 现状

`model-role-calibration/package.json` 声明 `"type": "commonjs"`，scripts 通过 `node --import tsx` 直接执行 TS。`tsconfig.json` extends 根 `tsconfig.base.json`。`types/index.d.ts` 只有 10 字节。

当前 scripts 已经通过 `tsx` 直接运行 TypeScript，不存在实际的 CJS/ESM 运行时冲突。问题主要是文档和配置的清晰度。

## 影响

- **边界模糊**：没有文档说明为什么 `model-role-calibration/` 需要独立的 `package.json`
- **隐式依赖**：scripts 依赖根包的 `node_modules`，但没有显式声明
- **types/index.d.ts 未清理**：可能包含无用声明

## 方案

### 1. 文档化 toolchain 边界

在 `model-role-calibration/README.md` 中增加：

```markdown
## Toolchain 说明

本目录使用 `node --import tsx` 直接执行 TypeScript，不需要预编译。

`package.json` 声明 `"type": "commonjs"` 的原因是：tsx 在 CJS 模式下对 `__dirname`、
`__filename` 等 Node.js 全局变量的处理更符合预期。如果改为 ESM，部分脚本中使用
`__dirname` 构建路径的方式需要修改。

scripts 依赖根包的 `node_modules`（zod、tsx 等）。新增依赖时，在根 `package.json`
的 `devDependencies` 中添加。
```

### 2. 清理 types/index.d.ts

检查内容。如果是空的或只包含无关声明，删除它。如果有实际类型声明，保留。

### 3. 记录 tsconfig 严格化待办，不在本 fix 中开启

`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch` 属于有价值的质量检查，但当前直接开启会产生现有错误，不应混入 toolchain 边界文档化。

已验证命令：

```bash
pnpm exec tsc -p model-role-calibration/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch
```

当前会报告未使用类型、变量和参数（例如 `ingest-output.ts`、`plan-authoring-lint.ts`、`test-plan-review-mcp.ts`、`workspace-review-lib.ts`）。因此本 fix 只在 backlog 中记录后续“清理 unused + 开启 noUnused\*”任务。

**不在此 fix 中增加** `noUncheckedIndexedAccess` 或 `exactOptionalPropertyTypes`——这些是高影响类型收紧，需要单独评估和修复，不应混入 0.5d 的文档/配置 fix。

## 涉及文件

| 文件                                      | 改动                                          |
| ----------------------------------------- | --------------------------------------------- |
| `model-role-calibration/README.md`        | 增加 toolchain 说明                           |
| `model-role-calibration/types/index.d.ts` | 清理或删除                                    |
| `docs/backlog.md`                         | 记录后续 unused cleanup / noUnused\* 收紧任务 |

## 验收

- `model-role-calibration/README.md` 包含 toolchain 说明
- `types/index.d.ts` 的保留或删除有明确理由
- backlog 中存在独立的 noUnused\* 收紧任务
- `pnpm calibration:typecheck` 通过
- `pnpm calibration:test` 通过
