# Fix-003: blindReview 双重写入

## 现状

当 `MockAgentWorkerAdapter` 被 `blindReview` 调用时，`result.json` 被写入两次：

1. **第一次**：`MockAgentWorkerAdapter.execute()` 第 58 行，在 adapter 内部写入 `{outputDir}/result.json`
2. **第二次**：`blindReview.ts` 第 61 行，在 `execute()` 返回后再次写入同一路径

两次写入路径 100% 重叠（`{runRoot}/{runId}/round-{NNN}/workers/{role}/output/result.json`），第二次覆盖第一次。

## 影响

- **冗余 I/O**：每次 reviewer 调用多一次无意义的文件写入
- **语义模糊**：不清楚哪个写入是权威来源
- **时间戳不一致**：adapter 用 epoch 时间戳，blindReview 用 `state.updatedAt`

## 方案

### 设计原则

worker contract 是 `execute()` 返回结果数据，runtime 节点统一负责持久化。这与 `LangGraphWorkflowRuntime.runRevisionRegressionFinal()` 的模式一致：reviser/regression worker 返回数据，runtime 写入文件。

因此：**移除 MockAgentWorkerAdapter 中的 `output/result.json` 写入，保留 blindReview 的写入作为唯一权威来源。**

### 具体改动

修改 `MockAgentWorkerAdapter.execute()`：

- **保留** task 元数据写入（`task/input-manifest.json`、`task/task.md`、`task/output-schema.json`）
- **保留** 日志文件写入（`stdout.log`、`stderr.log`）
- **保留** adapter 元数据写入（`meta/adapter.json`、`meta/run-result.json`）
- **移除** `output/result.json` 写入（由 blindReview 统一负责）

`blindReview.ts` 保持不变，其 `result.json` 写入是唯一的权威来源。

## 涉及文件

| 文件                                      | 改动                                       |
| ----------------------------------------- | ------------------------------------------ |
| `src/workers/MockAgentWorkerAdapter.ts`   | 移除 `output/result.json` 写入             |
| `src/graph/nodes/blindReview.ts`          | 保留现有写入，无需改动                     |
| `tests/integration/full-run.mock.test.ts` | 验证 result.json 仍由 blindReview 正确写入 |

## 验收

- `pnpm test` 通过
- `result.json` 只被写入一次
- `meta/adapter.json`、`meta/run-result.json` 仍由 adapter 写入
