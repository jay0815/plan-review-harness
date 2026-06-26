# synthetic-event-reporting v1 归档

## 归档信息

- 场景：`synthetic/event-reporting`
- 版本：`v1`
- 原始 Run ID：`synthetic-event-reporting-20260611T094509Z`
- 归档日期：`2026-06-12`
- 模型：`kimi`、`deepseek`、`glm`、`qwen`
- 角色：`planner`、`risk`、`architecture`、`execution`、`rebuttal`、`synthesis`

本目录保存第一次完整角色校准的不可变快照。v2 继续使用相同 case 输入和评分口径，主要调整角色初始化 prompt，以便把结果变化归因到 prompt，而不是场景变化。

唯一例外是 Risk：v1 运行时使用共享的 `model-output.schema.json`，其中要求 `suggested_fix`；根据 v1 评估后确认的角色边界，v2 使用独立的 `risk-output.schema.json` 并移除该字段。Risk 的 v1-v2 变化必须同时标记为 prompt 与 schema 的联合影响。

## 归档内容

```text
case/                 v1 输入与 rubric
prompts/probes/       实际发送给模型的六份 v1 prompt
prompts/evaluators/   人工校准后形成的六份评估器 prompt
schemas/              v1 运行与评分涉及的 schema
results/agent-outputs 24 份最终模型输出
results/scores/       24 份最终评分
analysis/             Planner 分析报告与下一轮优化建议
manifest.json         原始 run、数量与 schema 映射
```

`prompts/probes/` 来自原始 run 已生成的 prompt，不使用归档时的活跃模板，因此能够准确还原 v1 实际输入。

## 最终评分

分数顺序：

```text
hit_rate / contract_closure / actionability / evidence_discipline / false_positive_cost
```

| 角色 | Kimi | DeepSeek | GLM | Qwen |
|---|---:|---:|---:|---:|
| Planner | 9 | 13 | 15 | 16 |
| Risk | 17 | 14 | 13 | 19 |
| Architecture | 13 | 13 | 10 | 17 |
| Execution | 20 | 19 | 16 | 12 |
| Rebuttal | 18 | 13 | 18 | 15 |
| Synthesis | 17 | 17 | 12 | 16 |

## v1 角色建议

| 角色 | 首选 | 备选 | 辅助 | 暂不推荐 |
|---|---|---|---|---|
| Planner | Qwen | GLM | DeepSeek | Kimi |
| Risk | Qwen | Kimi | DeepSeek | GLM |
| Architecture | Qwen | Kimi / DeepSeek | - | GLM |
| Execution | Kimi | DeepSeek | GLM | Qwen |
| Rebuttal | GLM | Kimi | Qwen | DeepSeek |
| Synthesis | Kimi | DeepSeek | Qwen | GLM |

这些建议只适用于当前单一场景，是 v2 的比较基线，不是最终全局模型分工。

## v1 共同缺点

- 模型容易把未知版本行为、基础设施和业务后果写成事实。
- 多个角色会越界提供具体修复方案。
- 架构与执行审查容易遗漏真实 wire path，只讨论 API 风格或参数。
- 硬约束容易被重新开放为“等待多久”“超时多少”的参数问题。
- Synthesizer 容易把事实错误平均化为人工分歧，并新增来源中不存在的机制。

## v2 对比原则

- case 输入不变。
- rubric 不变。
- 模型集合不变。
- 同一角色的四个模型使用完全相同的 prompt。
- 不根据模型名称添加任何专属提示。
- 比较每个模型的 v1 与 v2 分数、失败模式和角色适配结论。
- 先验证优质 prompt 加单模型是否达标，再评估 team 是否产生稳定增益。
