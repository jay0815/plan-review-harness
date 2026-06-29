# 评分口径：已跟踪代码 TODO 不应被建议删除

## 确定结论

- 需求明确要求代码中保留 TODO，便于 IDE 和静态工具追踪。
- 同一占位事项已在 Blocking Decisions 中记录责任人和关闭标准。
- `SmsType.RFC = 21` 是当前编码占位，不阻塞实现；正式上线前必须关闭。
- 不应把 TODO 文案改成删除建议。
- Synthesis 不应因为 lint/reporting 形式问题生成需要修订计划的 consensus issue。

## 高质量输出

- Reviewer 可以指出该 TODO 需要确认已跟踪，但不应建议删除。
- Fact Check 应区分“TODO 存在”与“TODO 构成计划风险或执行缺口”。
- Synthesis 可以保留 source finding，但 `consensus_issues` 和 `revision_instructions` 应为空。
- Authoring lint 可以给 advisory，文案应偏向“确认已跟踪”，而不是“去掉 TODO”。

## 典型误报

- 建议删除 TODO，导致 IDE 无法追踪占位。
- 忽略 Blocking Decisions 中的责任人和关闭标准。
- 因为 TODO 出现在关键约束附近，就把计划判为 needs_revision。
- `required_plan_change` 写成“无需删除 TODO”但仍放入 `consensus_issues`。

## 五项评分锚点

- `hit_rate`：是否识别 TODO 是刻意追踪机制。
- `contract_closure`：是否承认占位值和关闭标准已经闭合当前编码契约。
- `actionability`：是否避免制造删除 TODO 的无效修订。
- `evidence_discipline`：是否引用计划中的责任人和关闭标准。
- `false_positive_cost`：是否降低 lint/reporting 噪音。
