# Fix-007: regression fixture round 硬编码

## 现状

`MockAgentWorkerAdapter.ts` 第 97-99 行：

```ts
if (this.role === 'regression') {
  return `regression.round${context.round}.json`
}
```

regression worker 的 fixture 文件名硬编码了 round 编号。当前 `fixtures/mock/` 中只有 `regression.round1.json`。如果测试多轮 review（round > 1），需要手动创建对应的 fixture 文件，否则 `readFixture` 会抛出 `Mock fixture not found` 错误。

## 影响

- **测试脆弱**：多轮 review 测试依赖手动创建的 fixture 文件
- **扩展困难**：增加 round 数需要同步创建 fixture 文件

## 方案

### 推荐方案：显式 round 映射，不默认 fallback

默认行为保持严格：round N 必须读取 `regression.roundN.json`。如果测试需要复用 round 1 的 fixture，必须在构造 mock worker 时显式声明。这样既减少样板 fixture，又不会掩盖多轮 regression 行为差异。

```ts
interface MockAgentWorkerOptions {
  role: AgentWorkerRole
  fixtureName: string
  fixtureDir?: string
  fixtureMap?: Partial<Record<number, string>>
}

private fixtureNameForContext(context: AgentWorkerContext): string {
  if (this.role === 'regression') {
    return this.fixtureMap[context.round] ?? `regression.round${context.round}.json`
  }
  return this.fixtureName
}
```

示例：允许 round 2 显式复用 round 1 fixture。

```ts
new MockAgentWorkerAdapter({
  role: 'regression',
  fixtureName: 'regression.round1.json',
  fixtureDir,
  fixtureMap: { 2: 'regression.round1.json' },
})
```

### 不采用隐式 fallback

不在 `readFixture()` 中自动 fallback 到 round 1，原因：

- `convergence.multi-round.test.ts` 已经通过 `regression.round1.json` 和 `regression.round2.json` 验证 round-specific 行为
- 缺少 round N fixture 通常代表测试数据不完整，应默认失败
- 隐式 fallback 会让多轮 convergence 测试在缺少 round 2 fixture 时仍然通过，降低测试信号

## 涉及文件

| 文件                                        | 改动                                                   |
| ------------------------------------------- | ------------------------------------------------------ |
| `src/workers/MockAgentWorkerAdapter.ts`     | 增加可选 `fixtureMap`，保留默认严格 round fixture 查找 |
| `tests/unit/MockAgentWorkerAdapter.test.ts` | 覆盖 fixtureMap 复用和缺失 round fixture 仍失败        |

## 验收

- 默认情况下，round 2 缺少 `regression.round2.json` 仍然报 `Mock fixture not found`
- 显式传入 `fixtureMap` 时，round 2 可复用指定 fixture
- `pnpm test` 通过
- `convergence.multi-round.test.ts` 仍正常工作
