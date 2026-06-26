# synthetic-event-reporting v2 实验

## 实验目标

v2 用于验证角色效果不佳的主要原因是：

1. 模型本身不适合该角色。
2. v1 prompt 对职责、事实边界和输出要求约束不足。
3. 单模型能力存在互补缺口，需要配置为 team。

本轮优先验证“优化 prompt 加单模型”能否胜任。只有单模型仍无法稳定达到角色要求时，才进入 team 组合实验。

## 控制变量

- case 输入与 v1 完全相同。
- rubric 与 v1 完全相同。
- 模型仍为 `kimi`、`deepseek`、`glm`、`qwen`。
- 每个 role 的四个模型使用同一份 `probe-<role>.md`。
- 不允许根据模型名称添加专属规则、示例或上下文。
- v2 run 使用新的 Run ID，不覆盖 v1。
- Planner、Architecture、Execution、Rebuttal、Synthesis 继续使用与 v1 相同的 schema。
- Risk 是唯一例外：v1 的共享 schema 强制要求 `suggested_fix`，与“Risk Reviewer 不提供建议”的角色定义冲突；v2 改用独立的 `risk-output.schema.json`。Risk 的提升需单独标记为 prompt 与 schema 的联合影响。

## Prompt 优化原则

### 通用约束

- 事实和硬约束优先于完整度与篇幅。
- 未知事实进入 `open_decisions` 或 `missing_questions`，不得脑补。
- 同一根因只报告一次。
- 不得通过新 API、平台、存储或可靠投递能力制造表面完整度。
- 已确定硬约束不能重新开放为参数讨论。
- 输出中的具体建议不得超过角色职责。

### Planner

- 必须形成唯一 wire contract 和责任闭环。
- 主计划不能依赖未验证的旧版本或基础设施行为。
- 先收敛阻塞设计决策，再写实施步骤。
- 严格控制可靠性和基础设施范围。

### Risk

- 只报告风险，不设计修复方案。
- 架构、实现、业务、安全等覆盖必须有 evidence。
- 不确定内容不提或放入 `missing_questions`。
- 事实正确是基础，覆盖全面是提升。

### Architecture

- 先还原真实字段路径、责任和依赖，再评价抽象。
- 区分结构缺陷、实现细节和 API 风格偏好。
- 只提出最小结构修订目标，不指定具体机制。

### Execution

- 区分设计未决与步骤缺失。
- 检查返回值、异步语义、依赖、修改范围、测试和回滚。
- 没有仓库上下文时不得编造路径和命令。
- 不得把硬约束重新变成超时参数讨论。

### Rebuttal

- 独立审查不等于必须发现新问题。
- 只挑战有 evidence 的错误共识。
- 不得为了反驳而引入可靠投递、版本探测或业务副作用。
- 主动说明可能误报的成立条件。

### Synthesis

- 每个结论必须准确追溯来源。
- 未表态不等于共识。
- 事实错误应直接裁决，只有真实 L3 方向分歧交给用户。
- 已降权意见不得重新进入修订指令。
- 不得新增 Reviewer 未提出的机制。

## 单模型胜任条件

当前场景中，一个模型暂定满足以下条件时，可进入“优质 prompt 加单模型”候选：

- 总分达到 `20/25`。
- `evidence_discipline` 不低于 `4`。
- `false_positive_cost` 不低于 `3`。
- 没有违反该角色底线的 failure mode。
- 没有被标记为该角色不适合。
- 关键 blocker 和确定契约问题没有遗漏。

单个场景只能形成候选结论，后续仍需在其他同角色场景验证稳定性。

## Team 判定条件

只有满足以下任一情况时，才建议配置 team：

- 没有任何单模型满足胜任条件。
- 最佳单模型持续存在无法通过 prompt 修复的稳定缺口。
- 两个模型的优势明显互补，组合后能够消除关键遗漏。
- team 的增益不是单纯增加篇幅，而是提高契约闭环或证据纪律。
- team 没有显著增加误报、冲突和合成成本。

## v1 Team 基线候选

| 角色 | 候选组合 | 互补原因 |
|---|---|---|
| Planner | Qwen + GLM / DeepSeek | 覆盖与契约，或覆盖与范围控制 |
| Risk | Qwen + Kimi | 完整覆盖与相对稳定的契约意识 |
| Architecture | Qwen + DeepSeek | 覆盖与依赖方向分析 |
| Execution | Kimi + DeepSeek | 全面执行清单与精确异步契约 |
| Rebuttal | GLM + Kimi | 误报意识与异步契约反驳 |
| Synthesis | Kimi + DeepSeek | 修订清单与结构化合并 |

这些组合只是 v1 假设。v2 应先重新评估单模型，再决定是否运行 team。

## v2 比较输出

每个 role 至少比较：

- v1 与 v2 五维分数变化。
- 关键确定问题命中变化。
- `evidence_discipline` 和 `false_positive_cost` 是否提升。
- v1 failure modes 是否消失。
- 是否产生新的 prompt 诱导问题。
- 角色判断是否从辅助或不适合变为主审候选。
- 单模型是否达到胜任条件。
- 若未达到，缺口是否可由明确的第二模型互补。
- Risk 额外记录移除 `suggested_fix` 后的角色越界变化，不与其他角色的纯 prompt 对比混为一谈。
