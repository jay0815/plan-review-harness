# synthetic-event-reporting v2 归档

## 归档信息

- 场景：`synthetic/event-reporting`
- 版本：`v2`
- 原始 Run ID：`synthetic-event-reporting-v2-20260612T082942Z`
- 运行日期：`2026-06-12`
- 归档日期：`2026-06-15`
- 模型：`kimi`、`deepseek`、`glm`、`qwen`
- 角色：`planner`、`risk`、`architecture`、`execution`、`rebuttal`、`synthesis`

本目录保存第二次完整角色校准的不可变快照。v2 保持 v1 的 case、rubric、模型集合和角色集合不变，主要调整六个角色的初始化 prompt。

Risk 是唯一例外：v2 同时将共享的 `model-output.schema.json` 替换为不含 `suggested_fix` 的独立 `risk-output.schema.json`。因此 Risk 的变化是 prompt 与 schema 的联合效果，不能解释为纯 prompt 增益。

## 归档内容

```text
case/                  v2 输入、rubric 和实验说明
prompts/probes/        原始 run 实际发送给模型的六份 prompt
prompts/evaluators/    本轮人工确认评分使用的六份评估器 prompt
schemas/               v2 运行与评分涉及的 schema
results/agent-outputs/ 24 份最终模型输出
results/scores/        24 份人工确认评分
analysis/              v1/v2 对比报告
manifest.json          原始 run、数量和 schema 映射
```

归档只保存可复核的最终模型输出，不保存 `.cli.json`、`.meta.json` 和失败 attempt。原始运行过程仍保留在：

```text
model-role-calibration/runs/synthetic-event-reporting-v2-20260612T082942Z/
```

## 最终评分

分数顺序：

```text
hit_rate / contract_closure / actionability / evidence_discipline / false_positive_cost
```

| 角色 | Kimi | DeepSeek | GLM | Qwen |
|---|---:|---:|---:|---:|
| Planner | 13 | 16 | 14 | 14 |
| Risk | 22 | 14 | 17 | 23 |
| Architecture | 20 | 15 | 14 | 18 |
| Execution | 23 | 13 | 17 | 14 |
| Rebuttal | 19 | 12 | 23 | 17 |
| Synthesis | 20 | 15 | 16 | 15 |

## v2 角色建议

| 角色 | 首选 | 配置建议 |
|---|---|---|
| Planner | DeepSeek | 主模型加评估器门禁 |
| Risk | Qwen | 单模型候选；Kimi 为高质量备选 |
| Architecture | Kimi | 单模型候选；Qwen 可做范围复核 |
| Execution | Kimi | 单模型候选 |
| Rebuttal | GLM | 单模型候选 |
| Synthesis | Kimi | 主模型加来源保真评估器 |

这些结论只来自一个场景。`20/25` 及以上表示进入跨场景单模型验证，不代表已经可以固化为全局模型路由。

## 主要结论

- Risk、Architecture、Execution 和 Rebuttal 均出现满足 v2 单模型胜任条件的候选。
- Planner 最高仍为 `16/25`，不能仅靠当前 prompt 直接定稿。
- Synthesis 的 Kimi 达到 `20/25`，但仍会把有效回滚目标与未经确认的具体实现一起降权，自动化时必须保留评估门禁。
- v2 对不同模型的影响不一致。相同 prompt 可以显著提升某些模型，也可以降低另一些模型的结果。
- Risk 的明显提升不能与其他角色直接横向归因，因为它同时修改了 schema。

完整变化、角色分析和下一阶段建议见：

```text
analysis/v1-v2-comparison.md
```
