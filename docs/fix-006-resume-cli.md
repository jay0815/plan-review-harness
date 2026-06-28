# Fix-006: resume CLI 入口

## 现状

`LangGraphWorkflowRuntime.resume()` 已完整实现（第 105-141 行），但 CLI（`src/cli/index.ts`）只暴露了 `start` 命令。resume 功能只能通过直接调用 runtime API 使用，无法从命令行触发。

测试 `tests/integration/human-gate.resume.test.ts` 通过直接调用 `runtime.resume()` 验证了 resume 行为。

## 影响

- **CLI 功能缺口**：用户无法通过命令行恢复等待中的 run
- **集成测试不完整**：CLI 路径的 resume 未被测试覆盖

## 方案

### 1. 新增 CLI resume 命令

修改 `src/cli/index.ts`，扩展命令分发逻辑：

```ts
const [command, ...args] = argv.slice(2)

if (command === 'start') {
  // 现有 start 逻辑
} else if (command === 'resume') {
  return await handleResume(args, io)
} else {
  io.stderr(`Unsupported command: ${command ?? '(none)'}`)
  return 1
}
```

### 2. 新增 parseResumeOptions 函数

```ts
function parseResumeOptions(argv: string[]): ResumeOptions {
  const opts: ResumeOptions = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--run-id' && argv[i + 1]) opts.runId = argv[++i]
    else if (arg === '--decisions' && argv[i + 1]) opts.decisions = argv[++i]
    else if (arg === '--run-dir' && argv[i + 1]) opts.runDir = argv[++i]
  }
  return opts
}
```

### 3. 新增 handleResume 函数

```ts
async function handleResume(argv: string[], io: CliIO): Promise<number> {
  const opts = parseResumeOptions(argv)
  if (!opts.runId) {
    io.stderr('--run-id is required')
    return 1
  }
  if (!opts.decisions) {
    io.stderr('--decisions is required')
    return 1
  }

  const runtime = new LangGraphWorkflowRuntime({
    runDir: opts.runDir ?? 'runs',
    maxRounds: 2, // 与 start 使用相同默认值；resume 从 persisted state 读取实际 maxRounds
    workers: createDefaultWorkers(),
  })

  const handle = await runtime.resume(opts.runId, { decisionsPath: opts.decisions })
  io.stdout(`Run resumed: ${handle.runId}`)
  io.stdout(`Status: ${handle.status}`)
  io.stdout(`Stage: ${handle.stage}`)
  return 0
}
```

### 4. 提取共享 worker 配置

将 start 和 resume 共用的 worker 数组提取为函数：

```ts
function createDefaultWorkers(): AgentWorkerAdapter[] {
  return [
    new MockAgentWorkerAdapter({ role: 'architecture-reviewer', fixtureName: 'review.architecture.json' }),
    new MockAgentWorkerAdapter({ role: 'execution-reviewer', fixtureName: 'review.execution.json' }),
    new MockAgentWorkerAdapter({ role: 'risk-reviewer', fixtureName: 'review.risk.json' }),
    new MockAgentWorkerAdapter({ role: 'reviser', fixtureName: 'revision.json' }),
    new MockAgentWorkerAdapter({ role: 'regression', fixtureName: 'regression.round1.json' }),
  ]
}
```

### 5. 新增集成测试

在 `tests/integration/` 中新增 `cli-resume.test.ts`，测试：

- resume 成功路径
- 缺少 --run-id 时报错
- 缺少 --decisions 时报错
- run 不在 waiting_for_decision 状态时报错

## 涉及文件

| 文件                                   | 改动                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `src/cli/index.ts`                     | 新增 resume 命令、parseResumeOptions、handleResume、createDefaultWorkers |
| `tests/integration/cli-resume.test.ts` | 新增 resume CLI 集成测试                                                 |

## 验收

- `pnpm plan-review -- resume --run-id <id> --decisions <path>` 可正常执行
- `pnpm test` 通过
