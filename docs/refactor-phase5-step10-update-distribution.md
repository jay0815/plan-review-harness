# Phase 5 Step 10: 更新分发打包脚本

## 目标

更新 `package-claude-distribution.ts` 中的文件路径引用。

## 需要检查的文件

- `model-role-calibration/scripts/cli/package-claude-distribution.ts`：`RUNTIME_SCRIPT_SOURCES` 数组中的路径
- `model-role-calibration/scripts/test/test-claude-distribution.ts`：打包文件断言中的路径

## 操作

更新路径引用，从 `scripts/xxx.ts` 改为 `scripts/子目录/xxx.ts`。

## 验证

```bash
pnpm plan-review:package
```

## 风险

中。分发打包是关键路径，必须验证打包后 MCP 能正常启动。

## 最终验证

```bash
pnpm calibration:typecheck
pnpm calibration:test
pnpm test
pnpm plan-review:package
```
