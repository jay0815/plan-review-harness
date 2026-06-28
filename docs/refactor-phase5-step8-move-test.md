# Phase 5 Step 8: 移动测试脚本到 test/

## 目标

移动测试脚本到 `scripts/test/`。

## 要移动的文件

| 文件                                  | 说明               |
| ------------------------------------- | ------------------ |
| test-calibration.ts                   | 校准测试           |
| test-claude-distribution.ts           | 分发测试           |
| test-evaluation.ts                    | 评估测试           |
| test-fact-check-calibration.ts        | fact check 测试    |
| test-plan-authoring-lint.ts           | plan lint 测试     |
| test-plan-review-mcp.ts               | MCP 测试           |
| test-runtime-integration.ts           | 运行时集成测试     |
| test-workspace-review-verification.ts | workspace 验证测试 |
| validate-fixtures.ts                  | fixture 校验       |

## 操作

```bash
cd model-role-calibration/scripts
for f in test-calibration.ts test-claude-distribution.ts test-evaluation.ts test-fact-check-calibration.ts test-plan-authoring-lint.ts test-plan-review-mcp.ts test-runtime-integration.ts test-workspace-review-verification.ts validate-fixtures.ts; do
  mv "$f" test/
done
```

## 需要更新的 import 路径

同 Step 5 模式。

## 验证

```bash
pnpm calibration:typecheck
pnpm test
```

## 风险

低。移动 9 个测试文件。
