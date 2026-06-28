# Phase 5 Step 2: 移动叶子库文件到 lib/

## 目标

移动无本地依赖的库文件到 `scripts/lib/`。

## 要移动的文件

| 文件                      | 行数 | 说明                        |
| ------------------------- | ---- | --------------------------- |
| lib.ts                    | ~400 | 基础工具函数，无本地 import |
| workspace-review-types.ts | 94   | 共享类型，无本地 import     |

## 操作

```bash
cd model-role-calibration/scripts
mv lib.ts lib/lib.ts
mv workspace-review-types.ts lib/workspace-review-types.ts
```

## 需要更新的 import 路径

所有 import `./lib.js` 或 `./workspace-review-types.js` 的文件需要改为 `../lib/lib.js` 或 `../lib/workspace-review-types.js`。

**受影响文件**（通过 grep `from './lib.js'\|from './workspace-review-types.js'` 确认）：

- workspace-review-config.ts
- workspace-review-manifest.ts
- workspace-review-lib.ts
- calibration/core.ts（如果 import lib）
- calibration/runner.ts（如果 import lib）

## 验证

```bash
pnpm calibration:typecheck
pnpm test
```

## 风险

低。只移动 2 个叶子文件，更新少量 import。
