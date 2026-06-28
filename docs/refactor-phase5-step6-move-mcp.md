# Phase 5 Step 6: 移动 MCP 脚本到 mcp/

## 目标

移动 MCP 服务脚本到 `scripts/mcp/`。

## 要移动的文件

| 文件                  | 行数 | 说明                      |
| --------------------- | ---- | ------------------------- |
| plan-review-mcp.ts    | 1050 | Plan Review MCP server    |
| json-validator-mcp.ts | ~400 | JSON Validator MCP server |

## 操作

```bash
cd model-role-calibration/scripts
mv plan-review-mcp.ts mcp/
mv json-validator-mcp.ts mcp/
```

## 需要更新的 import 路径

同 Step 5 模式。

## 验证

```bash
pnpm calibration:typecheck
pnpm test
```

## 风险

低。只移动 2 个文件。
