# Fix-005: workerContext role 类型

## 现状

`LangGraphWorkflowRuntime.ts` 第 472 行的 `workerContext` 方法：

```ts
private workerContext(state: PlanReviewState, role: 'reviser' | 'regression', nodeName: string)
```

只接受 `reviser` 或 `regression` 两种角色。而 `blindReview.ts` 中的三个 reviewer 角色（`architecture-reviewer`、`execution-reviewer`、`risk-reviewer`）需要手工构造完整的 `AgentWorkerContext` 对象（第 47-57 行）。

两条构造路径的逻辑完全相同（都从 `ArtifactPathBuilder` 获取 5 个路径），但代码分散在两处。

## 影响

- **代码重复**：相同的 context 构造逻辑在两个文件中各写一遍
- **维护风险**：如果 `AgentWorkerContext` 接口新增字段，需要改两处
- **类型限制**：`workerContext` 的 role 参数类型过窄，无法覆盖所有角色

## 方案

### 1. 在 ArtifactPathBuilder 中添加工厂方法

修改 `src/artifacts/paths.ts`，新增 `buildWorkerContext` 方法：

```ts
import type { AgentWorkerContext, AgentWorkerRole } from '../workers/AgentWorkerAdapter.js'

buildWorkerContext(
  runId: string,
  round: number,
  role: AgentWorkerRole,
  nodeName: string,
): AgentWorkerContext {
  return {
    runId,
    round,
    nodeName,
    role,
    runDir: this.getRunDir(runId),
    workerDir: this.getWorkerDir(runId, round, role),
    inputDir: this.getWorkerInputDir(runId, round, role),
    outputDir: this.getWorkerOutputDir(runId, round, role),
    logDir: this.getWorkerLogDir(runId, round, role),
  }
}
```

### 2. 删除 LangGraphWorkflowRuntime 中的 workerContext 私有方法

删除第 472-484 行的 `workerContext` 方法。

### 3. 修改 LangGraphWorkflowRuntime 的调用点

第 308 行：

```ts
// 原：this.workerContext(state, 'reviser', 'revision')
// 改：this.paths.buildWorkerContext(state.runId, state.round, 'reviser', 'revision')
```

第 321 行：

```ts
// 原：this.workerContext(state, 'regression', 'regression')
// 改：this.paths.buildWorkerContext(state.runId, state.round, 'regression', 'regression')
```

### 4. 修改 blindReview.ts 的调用点

第 47-57 行的内联构造改为：

```ts
const workerCtx = ctx.paths.buildWorkerContext(state.runId, state.round, role as AgentWorkerRole, 'blindReview')
const outputDir = workerCtx.outputDir
```

注意：`blindReview` 函数的参数对象已经叫 `ctx`（类型为 `NodeContext`），新变量使用 `workerCtx` 避免 shadowing。

## 涉及文件

| 文件                                    | 改动                                                                |
| --------------------------------------- | ------------------------------------------------------------------- |
| `src/artifacts/paths.ts`                | 新增 `buildWorkerContext` 方法                                      |
| `src/graph/LangGraphWorkflowRuntime.ts` | 删除 `workerContext` 私有方法，改用 `this.paths.buildWorkerContext` |
| `src/graph/nodes/blindReview.ts`        | 改用 `ctx.paths.buildWorkerContext`                                 |

## 验收

- `pnpm typecheck` 通过
- `pnpm test` 通过
- 只有一个 context 构造入口（`ArtifactPathBuilder.buildWorkerContext`）
