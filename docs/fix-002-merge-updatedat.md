# Fix-002: merge 函数 updatedAt 处理

## 现状

`LangGraphWorkflowRuntime.ts` 的 `merge()` 方法（第 486-496 行）每次调用都将 `updatedAt` 覆盖为固定常量：

```ts
private merge(state, patch): PlanReviewState {
  return { ...state, ...patch, updatedAt: createdAt, ... }
}
```

该方法在 6 处被调用，覆盖了 workflow 的所有状态转换点。`updatedAt` 始终等于 `createdAt`（`'2026-01-01T00:00:00.000Z'`），完全没有"最后更新时间"的语义。

## 影响

- `state.json` 中的 `updatedAt` 无法反映状态实际变更时间
- 与 Fix-001 耦合：如果 Fix-001 已将 `createdAt` 改为 `now()`，`merge()` 也会自动受益

## 方案

### 与 Fix-001 联动

Fix-001 将 `merge()` 中的 `updatedAt: createdAt` 改为 `updatedAt: this.clock.now()`。本 fix 确认：

1. `merge()` 中的 `updatedAt` 使用 `this.clock.now()` 而非固定常量
2. patch 中如果包含 `updatedAt`，会被 `this.clock.now()` 覆盖（merge 时间应为当前时间，非调用方传入）

### 测试覆盖

使用注入时钟验证 `merge()` 的 `updatedAt` 行为：

```ts
let tick = 0
const fakeClock: Clock = { now: () => `2026-06-27T00:00:0${tick++}.000Z` }
const runtime = new LangGraphWorkflowRuntime({ ..., clock: fakeClock })

// 通过 start() 间接验证 merge 的 updatedAt
const handle = await runtime.start({ ... })
// state.updatedAt 应为 clock 在 merge 时的值
expect(handle.state.updatedAt).toBe('2026-06-27T00:00:0X.000Z')
```

注意：`merge()` 是 `private` 方法，通过公开 API 间接验证。`updatedAt` 不要求严格递增（系统时间不保证），只要求不再是固定常量。

## 依赖

- Fix-001 必须先完成

## 验收

- `state.json` 中 `updatedAt` 不再是 `'2026-01-01T00:00:00.000Z'`
- 测试使用注入时钟，断言确定性
