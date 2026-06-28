# Phase 5 Step 3: 移动配置库到 lib/

## 目标

移动配置相关库文件到 `scripts/lib/`。

## 要移动的文件

| 文件                       | 行数 | 依赖                                           |
| -------------------------- | ---- | ---------------------------------------------- |
| workspace-review-config.ts | 402  | lib.ts, workspace-review-types.ts（已在 lib/） |

## 操作

```bash
cd model-role-calibration/scripts
mv workspace-review-config.ts lib/workspace-review-config.ts
```

## 需要更新的 import 路径

- workspace-review-lib.ts：`from './workspace-review-config.js'` → `from '../lib/workspace-review-config.js'`
- workspace-review-config.ts 内部：`from './lib.js'` → `from './lib.js'`（同目录，不需改）

## 验证

```bash
pnpm calibration:typecheck
pnpm test
```

## 风险

低。只移动 1 个文件，更新 1 个 import。
