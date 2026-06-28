# Fix-008: 失败状态持久化

## 现状

`LangGraphWorkflowRuntime` 的 `start()` 和 `resume()` 方法没有任何 try-catch。所有异常直接向上抛出，由 CLI 的 `.catch()` 统一处理。

Schema 中定义了 `failed` 状态和 `errors` 数组，但**从未被任何代码使用**：

- `PlanReviewStatusSchema` 包含 `'failed'` 枚举值
- `PlanReviewStateSchema.errors` 数组定义了 `{ stage, message, stack, createdAt }` 结构
- 这两个字段在 `start()` 初始化时设置，之后再未被修改

## 影响

- **无可观测性**：run 失败后无法从 `state.json` 判断失败原因和阶段
- **无恢复能力**：失败的 run 状态不明确，无法判断是否可以 resume
- **Schema 死代码**：`failed` 状态和 `errors` 数组是预留但未实现的契约

## 方案

### 策略：state 对象已构造后写回失败信息

核心原则：

- 如果 `PlanReviewState` 对象已经构造完成，失败时应将 state 标记为 `failed` 并写入 `errors` 数组，然后重新抛出异常
- 如果 state 尚未构造（例如 `start()` 复制输入文件或校验入参时失败），直接抛出异常，不尝试保存
- `resume()` 的输入校验错误（run 不存在、不在等待决策、decision 文件无效）不是 workflow 执行失败，不写入 failed state

### 1. 在 start() 中增加错误捕获

```ts
async start(input: StartPlanReviewInput): Promise<WorkflowRunHandle> {
  const runId = `run-${randomUUID()}`
  const round = 1
  await ensureDir(this.paths.getInputDir(runId))
  await copyFile(input.requirementPath, this.paths.getRequirementPath(runId))
  if (!input.initialPlanPath) throw new Error('initialPlanPath is required')
  await copyFile(input.initialPlanPath, this.paths.getInitialPlanPath(runId))

  let state: PlanReviewState = {
    runId,
    createdAt: now(),
    updatedAt: now(),
    stage: 'blind_review',
    status: 'running',
    round,
    maxRounds: input.maxRounds ?? this.config.maxRounds,
    artifacts: { /* ... 现有初始化 ... */ },
    decisions: [],
    confirmedIssues: [],
    errors: [],
  }

  // state 对象已构造，后续 workflow 执行失败需要写回
  try {
    const reviewPatch = await blindReview({ paths: this.paths, workers: this.workers }, state)
    state = this.merge(state, reviewPatch)
    state = await this.synthesizeAndMaybePause(state)
    await this.states.save(state)
    return this.handle(state)
  } catch (error) {
    await this.saveFailedState(state, error)
    throw error
  }
}
```

### 2. 在 resume() 中增加错误捕获

```ts
async resume(runId: string, input: ResumePlanReviewInput): Promise<WorkflowRunHandle> {
  let state = await this.states.load(runId)
  // ... 校验逻辑（不捕获，这些是输入校验错误，不是 workflow 执行失败）...

  try {
    // ... 现有 resume 逻辑 ...
    state = await this.runRevisionRegressionFinal(state)
    await this.states.save(state)
    return this.handle(state)
  } catch (error) {
    await this.saveFailedState(state, error)
    throw error
  }
}
```

### 3. 新增 saveFailedState 方法

```ts
private async saveFailedState(state: PlanReviewState, error: unknown): Promise<boolean> {
  const stage = state.stage === 'done' ? 'error' : state.stage
  try {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    const failedState = this.merge(state, {
      status: 'failed',
      errors: [...state.errors, {
        stage,
        message,
        stack,
        createdAt: now(),
      }],
    })
    await this.states.save(failedState)
    return true
  } catch {
    // 保存失败状态本身失败时，不掩盖原始错误
    return false
  }
}
```

### 4. 新增 WorkflowError

为 CLI 层提供结构化错误信息：

```ts
export class WorkflowError extends Error {
  readonly stage: string
  readonly runId: string
  readonly stateSaved: boolean
  constructor(message: string, options: { cause?: unknown; stage: string; runId: string; stateSaved: boolean }) {
    super(message, { cause: options.cause })
    this.name = 'WorkflowError'
    this.stage = options.stage
    this.runId = options.runId
    this.stateSaved = options.stateSaved
  }
}
```

在 `start()`/`resume()` 的 catch 块中，包装后再抛出：

```ts
} catch (error) {
  const stateSaved = await this.saveFailedState(state, error)
  throw new WorkflowError(
    `${state.stage} failed: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error, stage: state.stage, runId: state.runId, stateSaved },
  )
}
```

注意：`PlanReviewStateSchema.errors[].stage` 使用 `WorkflowStageSchema`。记录失败时必须写入合法 stage；不要把 `status` 值或任意字符串写入 `stage`。

### 5. 测试范围

新增测试覆盖：

- `start()` 在 `blindReview` 或后续节点失败时写入 `state.json`，`status` 为 `failed`
- `resume()` 在 revision/regression/finalization 阶段失败时写入 `failed`
- `resume()` 的输入校验错误不修改原 state
- `saveFailedState()` 自身保存失败时不掩盖原始错误

### 6. CLI 层捕获 WorkflowError

修改 `src/cli/index.ts`：

```ts
.catch((error) => {
  if (error instanceof WorkflowError) {
    io.stderr(`[${error.stage}] ${error.message}`)
    if (error.stateSaved) {
      io.stderr(`Run ${error.runId} marked as failed. State saved.`)
    } else {
      io.stderr(`Run ${error.runId} failed. Failed state could not be saved.`)
    }
  } else {
    io.stderr(String(error))
  }
  process.exitCode = 1
})
```

## 涉及文件

| 文件                                    | 改动                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `src/graph/LangGraphWorkflowRuntime.ts` | 新增 `saveFailedState`、`WorkflowError`；在 `start()`/`resume()` 中增加 try-catch |
| `src/cli/index.ts`                      | 增强 `.catch()` 处理                                                              |
| `src/index.ts`                          | 导出 `WorkflowError`                                                              |

## 验收

- `start()` 在 blindReview 阶段失败时，`state.json` 中 `status` 为 `'failed'`，`errors` 数组包含一条错误记录
- `resume()` 在 revision 阶段失败时，同样写回失败状态
- CLI 输出包含 `[stage]` 前缀，并根据 `stateSaved` 区分已保存或保存失败
- `pnpm test` 通过
