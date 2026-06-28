# Phase 5 Step 9: 更新 package.json scripts

## 目标

更新根 `package.json` 中所有引用 `model-role-calibration/scripts/` 的脚本路径。

## 需要更新的脚本

所有 `calibration:*`、`fact-check:*`、`plan-review:*` 脚本中的路径需要从 `scripts/xxx.ts` 更新为 `scripts/子目录/xxx.ts`。

示例：

```json
{
  "calibration:create-case": "node --import tsx model-role-calibration/scripts/cli/create-case.ts",
  "plan-review:mcp": "node --import tsx model-role-calibration/scripts/mcp/plan-review-mcp.ts",
  "calibration:test": "... model-role-calibration/scripts/test/test-calibration.ts ..."
}
```

## 操作

编辑根 `package.json`，更新所有路径。

## 验证

```bash
pnpm calibration:test
pnpm plan-review:mcp --help
```

## 风险

中。涉及 20+ 脚本路径更新。
