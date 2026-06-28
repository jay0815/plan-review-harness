# Phase 5 Step 7: 移动 CLI 脚本到 cli/

## 目标

移动 CLI/校准工具脚本到 `scripts/cli/`。

## 要移动的文件

| 文件                                  | 说明                   |
| ------------------------------------- | ---------------------- |
| create-case.ts                        | 创建校准 case          |
| create-fact-check-calibration-case.ts | 创建 fact check case   |
| generate-prompts.ts                   | 生成 prompt            |
| generate-fact-check-prompts.ts        | 生成 fact check prompt |
| ingest-output.ts                      | 录入输出               |
| ingest-fact-check-output.ts           | 录入 fact check 输出   |
| score-output.ts                       | 评分                   |
| score-fact-check-output.ts            | fact check 评分        |
| summarize-results.ts                  | 汇总结果               |
| summarize-fact-check-calibration.ts   | 汇总 fact check        |
| promote-evaluation.ts                 | 晋升评估               |
| package-claude-distribution.ts        | 打包分发               |
| run-agent-pool.ts                     | 运行 agent pool        |
| run-calibration.ts                    | 运行校准               |
| run-evaluation.ts                     | 运行评估               |
| run-fact-check-calibration.ts         | 运行 fact check 校准   |
| run-model.ts                          | 运行模型               |
| v2-calibration-plan.ts                | v2 校准计划            |
| verify-schema-consistency.ts          | schema 一致性检查      |
| evaluation-lib.ts                     | 评估库                 |
| fact-check-calibration-lib.ts         | fact check 校准库      |

## 操作

```bash
cd model-role-calibration/scripts
for f in create-case.ts create-fact-check-calibration-case.ts generate-prompts.ts generate-fact-check-prompts.ts ingest-output.ts ingest-fact-check-output.ts score-output.ts score-fact-check-output.ts summarize-results.ts summarize-fact-check-calibration.ts promote-evaluation.ts package-claude-distribution.ts run-agent-pool.ts run-calibration.ts run-evaluation.ts run-fact-check-calibration.ts run-model.ts v2-calibration-plan.ts verify-schema-consistency.ts evaluation-lib.ts fact-check-calibration-lib.ts; do
  mv "$f" cli/
done
```

## 需要更新的 import 路径

同 Step 5 模式。

## 验证

```bash
pnpm calibration:typecheck
pnpm test
```

## 风险

中。移动 21 个文件，但大多是独立脚本，相互依赖少。
