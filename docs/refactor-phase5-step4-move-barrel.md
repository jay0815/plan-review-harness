# Phase 5 Step 4: 移动主库到 lib/ 并保留兼容 re-export

## 目标

移动 `workspace-review-lib.ts` 和 `workspace-review-manifest.ts` 到 `scripts/lib/`，在原位置保留 re-export 文件保持向后兼容。

## 要移动的文件

| 文件                         | 行数 | 依赖                                                                       |
| ---------------------------- | ---- | -------------------------------------------------------------------------- |
| workspace-review-lib.ts      | 1419 | lib.ts, workspace-review-types.ts, workspace-review-config.ts（已在 lib/） |
| workspace-review-manifest.ts | 793  | lib.ts（已在 lib/）                                                        |

## 操作

```bash
cd model-role-calibration/scripts
mv workspace-review-lib.ts lib/workspace-review-lib.ts
mv workspace-review-manifest.ts lib/workspace-review-manifest.ts
```

### 创建兼容 re-export 文件

```ts
// scripts/workspace-review-lib.ts
export * from './lib/workspace-review-lib.js'
```

```ts
// scripts/workspace-review-manifest.ts
export * from './lib/workspace-review-manifest.js'
```

## 需要更新的 import 路径

- lib/workspace-review-lib.ts 内部：`from './lib.js'` → `from './lib.js'`（同目录，不需改）
- lib/workspace-review-manifest.ts 内部：`from './lib.js'` → `from './lib.js'`（同目录，不需改）

由于保留了 re-export 文件，所有下游 import 路径不变。

## 验证

```bash
pnpm calibration:typecheck
pnpm test
```

## 风险

中低。移动 2 个文件 + 创建 2 个 re-export。下游 import 路径不变。
