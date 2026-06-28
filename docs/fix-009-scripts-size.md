# Fix-009/010/011: model-role-calibration 模块化重构

## 现状

`model-role-calibration/scripts/` 存在三个相互关联的结构问题：

1. **目录扁平**（原 Fix-009）：45 个 `.ts` 文件平铺在同一目录，无分类
2. **上帝模块**（原 Fix-010）：`workspace-review-lib.ts`（1829 行）承担过多职责
3. **职责混合**（原 Fix-011）：校准工具和生产功能（workspace review）混在同一目录

三个问题相互耦合，不能并行解决。本文件合并为一个有明确阶段顺序的迁移计划。

## 影响

- **代码复用差**：类型定义、配置加载在多个脚本中重复
- **改动风险高**：修改 `workspace-review-lib.ts` 可能影响所有依赖脚本
- **部署边界模糊**：打包 Claude Code 分发包时需要从校准目录中提取生产文件

## 方案

### Phase 1：从 workspace-review-lib.ts 提取共享类型

**目标**：将 `workspace-review-lib.ts` 中的类型定义提取为独立模块，不移动任何可执行脚本。

**创建文件**：`scripts/workspace-review-types.ts`

从 `workspace-review-lib.ts` 提取：

- `WorkspaceRole` 类型
- `RoleRouteConfig` 接口
- `WorkspaceReviewLoadOptions` 接口
- `WorkspaceReviewSource` 接口
- `ModelConfigInput`、`ValidatedModelConfig` 接口
- `WorkspaceReviewConfig` 接口
- `WorkspaceRunDirectoryConfig` 接口
- `ConfigSummaryInput`、`ConfigSummaryResult` 接口

**修改 `workspace-review-lib.ts`**：改为从 `workspace-review-types.ts` import 类型，自身缩减约 100 行。

**验证**：`pnpm calibration:typecheck && pnpm calibration:test`

### Phase 2：从 workspace-review-lib.ts 提取配置加载

**目标**：将配置加载和校验逻辑提取为独立模块。

**创建文件**：`scripts/workspace-review-config.ts`

从 `workspace-review-lib.ts` 提取：

- `loadWorkspaceReviewConfig()` 函数
- `validateModelConfig()` 函数
- `resolveRoleRoutes()` 函数
- `configSummary()` 函数

**修改 `workspace-review-lib.ts`**：改为从 `workspace-review-config.ts` import，自身再缩减约 300 行。

**验证**：`pnpm calibration:typecheck && pnpm calibration:test`

### Phase 3：拆分 workspace manifest 脚本

**目标**：将已有 `workspace-review-manifest.ts` 中的 manifest 逻辑拆分为库模块和薄脚本入口。

**创建文件**：

- `scripts/workspace-review-manifest-lib.ts`

从 `workspace-review-manifest.ts` 提取：

- `RunManifest` 接口和相关类型
- `createRunManifest()` 函数
- `loadRunManifest()` 函数
- `backfillRunManifest()` 函数
- manifest 校验逻辑

`workspace-review-manifest.ts` 保留为 CLI/兼容入口，只 re-export 库函数并保留 `isMainScript` 执行路径。

**注意**：`runFactCheck`、`runSynthesis` 等函数**不在** `workspace-review-lib.ts` 中，它们在 `run-workspace-review.ts` 中。`spawnClaude` 相关能力也应先确认实际位置后再拆分，不在 Phase 3 处理。

**验证**：`pnpm calibration:typecheck && pnpm calibration:test`

### Phase 4：workspace-review-lib.ts 收敛为兼容入口

经过 Phase 1-3 后，`workspace-review-lib.ts` 应缩减为约 200-300 行（剩余工具函数和需要继续分析的逻辑）。如果仍有大量代码，继续提取为独立模块。

最终 `workspace-review-lib.ts` 保留兼容 export：

```ts
export * from './workspace-review-types.js'
export * from './workspace-review-config.js'
// ... 剩余工具函数
```

现有依赖脚本（`run-workspace-review.ts`、`plan-review-mcp.ts` 等）不需要修改 import 路径。

**验证**：`pnpm calibration:typecheck && pnpm calibration:test`

### Phase 5：目录重组

将 45 个脚本按职责分入子目录：

```
model-role-calibration/scripts/
├── lib/                    # 共享库（lib.ts + Phase 1-4 提取的模块）
│   ├── lib.ts              # 原 lib.ts（配置加载、路径、进程执行）
│   ├── workspace-review-types.ts
│   ├── workspace-review-config.ts
│   ├── workspace-review-manifest-lib.ts
│   └── ...
├── calibration/            # 校准流程（已有子目录）
│   ├── core.ts
│   ├── runner.ts
│   ├── role-executor.ts
│   └── fact-check-executor.ts
├── workspace/              # workspace review 可执行脚本
│   ├── run-workspace-review.ts
│   ├── workspace-review-manifest.ts
│   ├── verify-workspace-review-run.ts
│   ├── inspect-workspace-run.ts
│   ├── doctor-workspace-review-run.ts
│   ├── backfill-workspace-run-manifest.ts
│   └── retry-workspace-review-stage.ts
├── mcp/                    # MCP 服务
│   ├── plan-review-mcp.ts
│   └── json-validator-mcp.ts
├── cli/                    # CLI 工具
│   ├── create-case.ts
│   ├── generate-prompts.ts
│   ├── ingest-output.ts
│   ├── score-output.ts
│   ├── summarize-results.ts
│   ├── promote-evaluation.ts
│   ├── package-claude-distribution.ts
│   ├── plan-authoring-lint.ts
│   └── run-agent-pool.ts
└── test/                   # 测试脚本
    ├── test-calibration.ts
    ├── test-evaluation.ts
    ├── test-plan-review-mcp.ts
    └── ...
```

**同时更新 `package.json` scripts** 中所有路径引用。

同时必须更新所有硬编码脚本路径和分发路径，包括：

- 根 `package.json` 的 `calibration:*`、`fact-check:*`、`plan-review:*`、`calibration:test`、`fmt`、`fmt:check`
- `model-role-calibration/scripts/cli/package-claude-distribution.ts` 的 `RUNTIME_SCRIPT_SOURCES`、安装脚本、README 中的 `mcp/scripts/*.js` 路径
- `model-role-calibration/scripts/test/test-claude-distribution.ts` 中对 packaged files 的断言
- `model-role-calibration/scripts/cli/v2-calibration-plan.ts` 等脚本内硬编码的 `model-role-calibration/scripts/*.ts` 路径
- 所有移动后文件的相对 import，尤其是从 `scripts/calibration/*.ts` 指向共享库的 `../workspace-review-lib.js` 路径

**验证**：`pnpm calibration:typecheck && pnpm calibration:test && pnpm plan-review:package`

### Phase 6：calibration/workspace 职责声明

在目录结构已分离的基础上，在 `model-role-calibration/README.md` 中明确：

- `scripts/workspace/` 和 `scripts/mcp/` 是**生产功能**（workspace review engine）
- `scripts/calibration/` 和 `scripts/cli/` 是**开发工具**（校准工具链）
- `scripts/lib/` 是**共享库**，被两者共同依赖
- `scripts/test/` 中的测试按被测模块归属

不做更深层的目录拆分（如将 workspace-review 独立为顶层目录），因为当前规模不需要。

## 涉及文件

| Phase | 新增文件                                   | 修改文件                                          |
| ----- | ------------------------------------------ | ------------------------------------------------- |
| 1     | `scripts/workspace-review-types.ts`        | `scripts/workspace-review-lib.ts`                 |
| 2     | `scripts/workspace-review-config.ts`       | `scripts/workspace-review-lib.ts`                 |
| 3     | `scripts/workspace-review-manifest-lib.ts` | `scripts/workspace-review-manifest.ts`            |
| 4     | 无                                         | `scripts/workspace-review-lib.ts`（兼容入口收敛） |
| 5     | 子目录结构                                 | `package.json`、分发脚本、测试脚本、硬编码路径    |
| 6     | 无                                         | `model-role-calibration/README.md`                |

## 验收

- `workspace-review-lib.ts` ≤ 300 行（Phase 4 后）
- 每个子目录的文件数量 ≤ 10
- `pnpm calibration:typecheck` 通过
- `pnpm calibration:test` 通过
- `pnpm plan-review:package` 正常打包
- 现有 import 路径通过 barrel 保持兼容（Phase 1-4）
- 目录移动后 packaged MCP runtime 仍包含安装脚本引用的全部 JS 文件
