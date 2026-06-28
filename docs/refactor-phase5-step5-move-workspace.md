# Phase 5 Step 5: 移动 workspace 脚本到 workspace/

## 目标

移动 workspace review 可执行脚本到 `scripts/workspace/`。

## 要移动的文件

| 文件                               | 行数 | 说明          |
| ---------------------------------- | ---- | ------------- |
| run-workspace-review.ts            | 1638 | 主 runner     |
| verify-workspace-review-run.ts     | 756  | 验证脚本      |
| inspect-workspace-run.ts           | ~400 | 检查脚本      |
| doctor-workspace-review-run.ts     | ~500 | 诊断脚本      |
| backfill-workspace-run-manifest.ts | ~100 | backfill 脚本 |
| retry-workspace-review-stage.ts    | ~50  | 重试脚本      |
| plan-authoring-lint.ts             | 948  | 计划 lint     |

## 操作

```bash
cd model-role-calibration/scripts
mv run-workspace-review.ts workspace/
mv verify-workspace-review-run.ts workspace/
mv inspect-workspace-run.ts workspace/
mv doctor-workspace-review-run.ts workspace/
mv backfill-workspace-run-manifest.ts workspace/
mv retry-workspace-review-stage.ts workspace/
mv plan-authoring-lint.ts workspace/
```

## 需要更新的 import 路径

每个文件内部的 `from './workspace-review-lib.js'` → `from '../lib/workspace-review-lib.js'`
每个文件内部的 `from './workspace-review-manifest.js'` → `from '../lib/workspace-review-manifest.js'`
每个文件内部的 `from './lib.js'` → `from '../lib/lib.js'`

如果使用了 re-export 文件，路径可以不改（通过 `../workspace-review-lib.js` 访问 re-export）。

## 验证

```bash
pnpm calibration:typecheck
pnpm test
```

## 风险

中。移动 7 个文件，每个文件需更新 import。
