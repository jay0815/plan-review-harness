# Fix-001: createdAt 硬编码常量

## 现状

`LangGraphWorkflowRuntime.ts` 第 20 行定义了模块级常量：

```ts
const createdAt = '2026-01-01T00:00:00.000Z'
```

该常量被 14 处引用，覆盖 state 初始化、issue ledger、disagreement ledger、decision queue、convergence report、final report、user decisions 等所有 artifact 的 `createdAt` 字段。所有运行时生成的记录都带有完全相同的固定时间戳。

## 影响

- **调试困难**：多轮 review 中所有 artifact 的时间戳完全相同，无法判断执行顺序
- **audit 能力缺失**：无法追溯某个 artifact 在何时生成
- **与 `updatedAt` 耦合**：`merge()` 方法用同一个常量设置 `updatedAt`，导致时序信息完全丢失

## 方案

### 1. 删除模块级常量

删除第 20 行的 `const createdAt = '2026-01-01T00:00:00.000Z'`。

### 2. 引入时钟工具

在 `src/utils/fs.ts` 中新增：

```ts
export interface Clock {
  now(): string
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
}
```

使用 `Clock` 接口而非直接调用 `new Date()`，原因：

- 测试可注入固定时钟，避免非确定性
- 如果未来需要单调递增时钟，只需替换实现
- 与现有 `utils/fs.ts` 的基础设施定位一致

### 3. Runtime 接受可选 Clock

修改 `LangGraphWorkflowRuntime` 构造函数：

```ts
export interface HarnessConfig {
  runDir: string
  maxRounds: number
  workers: AgentWorkerAdapter[]
  clock?: Clock  // 可选，默认 systemClock
}

constructor(private readonly config: HarnessConfig) {
  this.clock = config.clock ?? systemClock
  // ...
}
```

### 4. 逐点替换

所有 14 处 `createdAt` 引用改为调用 `this.clock.now()`：

| 位置                           | 原代码                       | 改为                                                |
| ------------------------------ | ---------------------------- | --------------------------------------------------- |
| 第 67 行 state 初始化          | `createdAt,`                 | `createdAt: this.clock.now(),`                      |
| 第 68 行 state 初始化          | `updatedAt: createdAt,`      | `updatedAt: this.clock.now(),`                      |
| 第 119 行 userDecisions        | `createdAt,`                 | `createdAt: this.clock.now(),`                      |
| 第 196 行 issueLedger          | `createdAt,`                 | `createdAt: this.clock.now(),`                      |
| 第 215 行 disagreement 元素    | `createdAt,`                 | `createdAt: this.clock.now(),`                      |
| 第 224 行 disagreementLedger   | `createdAt,`                 | `createdAt: this.clock.now(),`                      |
| 第 251 行 decision item        | `createdAt,`                 | `createdAt: this.clock.now(),`                      |
| 第 253 行 decisionQueue        | `createdAt,`                 | `createdAt: this.clock.now(),`                      |
| 第 381 行 finalReport          | `createdAt,`                 | `createdAt: this.clock.now(),`                      |
| 第 443 行 convergence done     | `createdAt,`                 | `createdAt: this.clock.now(),`                      |
| 第 456 行 convergence continue | `createdAt,`                 | `createdAt: this.clock.now(),`                      |
| 第 468 行 convergence blocked  | `createdAt,`                 | `createdAt: this.clock.now(),`                      |
| 第 493 行 merge                | `updatedAt: createdAt,`      | `updatedAt: this.clock.now(),`                      |
| blindReview.ts 第 67 行        | `createdAt: state.updatedAt` | `createdAt: state.updatedAt`（不改，由 state 携带） |

### 5. 测试使用注入时钟

```ts
const fixedClock: Clock = { now: () => '2026-06-27T00:00:00.000Z' }
const runtime = new LangGraphWorkflowRuntime({ ..., clock: fixedClock })
```

测试断言改为精确匹配 `'2026-06-27T00:00:00.000Z'`，避免 `expect.any(String)` 的不确定性。

## 验收

- `pnpm typecheck` 通过
- `pnpm test` 通过（使用注入时钟，断言确定性）
- `state.json` 中 `createdAt` 不再是 `'2026-01-01T00:00:00.000Z'`
