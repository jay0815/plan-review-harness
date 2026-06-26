# synthetic-event-reporting v1/v2 对比报告

## 对比范围

- Case：`synthetic/event-reporting`
- v1 Run：`synthetic-event-reporting-20260611T094509Z`
- v2 Run：`synthetic-event-reporting-v2-20260612T082942Z`
- 模型：`kimi`、`deepseek`、`glm`、`qwen`
- 角色：`planner`、`risk`、`architecture`、`execution`、`rebuttal`、`synthesis`
- 每份输出均按五个维度评分，总分 `25`

v2 保持 case、rubric 和模型集合不变，同一角色的四个模型使用完全相同的 prompt。Planner、Architecture、Execution、Rebuttal 和 Synthesis 的变化主要来自 prompt；Risk 同时改用独立 `risk-output.schema.json`，其结果属于 prompt 与 schema 的联合变化。

## 总体结果

24 组模型与角色组合的总分从 v1 的 `362` 提升到 v2 的 `404`，平均分从 `15.08` 提升到 `16.83`，平均增加 `1.75`。

提升并不均匀：

- Kimi：`94 → 117`，增加 `23`
- GLM：`84 → 101`，增加 `17`
- Qwen：`95 → 101`，增加 `6`
- DeepSeek：`89 → 85`，减少 `4`

因此不能把“prompt 更严格”直接解释为所有模型都会改善。模型对角色边界、输出约束和示例密度的响应存在明显差异。

## 分数对比

### v1

| 角色 | Kimi | DeepSeek | GLM | Qwen |
|---|---:|---:|---:|---:|
| Planner | 9 | 13 | 15 | 16 |
| Risk | 17 | 14 | 13 | 19 |
| Architecture | 13 | 13 | 10 | 17 |
| Execution | 20 | 19 | 16 | 12 |
| Rebuttal | 18 | 13 | 18 | 15 |
| Synthesis | 17 | 17 | 12 | 16 |

### v2

| 角色 | Kimi | DeepSeek | GLM | Qwen |
|---|---:|---:|---:|---:|
| Planner | 13 | 16 | 14 | 14 |
| Risk | 22 | 14 | 17 | 23 |
| Architecture | 20 | 15 | 14 | 18 |
| Execution | 23 | 13 | 17 | 14 |
| Rebuttal | 19 | 12 | 23 | 17 |
| Synthesis | 20 | 15 | 16 | 15 |

### v2 相对 v1

| 角色 | Kimi | DeepSeek | GLM | Qwen |
|---|---:|---:|---:|---:|
| Planner | +4 | +3 | -1 | -2 |
| Risk | +5 | 0 | +4 | +4 |
| Architecture | +7 | +2 | +4 | +1 |
| Execution | +3 | -6 | +1 | +2 |
| Rebuttal | +1 | -1 | +5 | +2 |
| Synthesis | +3 | -2 | +4 | -1 |

## 角色变化

| 角色 | v1 平均 | v2 平均 | 变化 | v1 最高 | v2 最高 |
|---|---:|---:|---:|---:|---:|
| Planner | 13.25 | 14.25 | +1.00 | 16 | 16 |
| Risk | 15.75 | 19.00 | +3.25 | 19 | 23 |
| Architecture | 13.25 | 16.75 | +3.50 | 17 | 20 |
| Execution | 16.75 | 16.75 | 0 | 20 | 23 |
| Rebuttal | 16.00 | 17.75 | +1.75 | 18 | 23 |
| Synthesis | 15.50 | 16.50 | +1.00 | 17 | 20 |

### Planner

首选从 Qwen 变为 DeepSeek，但最高分仍是 `16`，没有突破 v1 上限。

正向变化：

- Kimi 和 DeepSeek 对硬约束、主路径和执行步骤的覆盖提升。
- DeepSeek 的契约闭合和可执行性有所改善。

仍然存在：

- 四个模型均未达到单模型胜任线。
- 未知版本行为和字段位置仍会进入主方案。
- Qwen 在 v2 中违反非阻塞硬约束。
- Planner 仍需要评估器检查权威契约、硬约束和未决事项是否进入主路径。

结论：当前推荐 DeepSeek 作为主草拟模型，但不能取消评估和修订环节。

### Risk

平均分增加 `3.25`，Qwen 达到 `23`，Kimi 达到 `22`。

正向变化：

- Qwen 和 Kimi 的 `evidence_discipline` 均提升到 `5`。
- 两者的 `false_positive_cost` 均提升到 `5`。
- 移除 `suggested_fix` 后，角色越界和破坏性建议明显减少。

限制：

- Risk 同时修改了 prompt 和 schema，不能单独计算 prompt 的贡献。
- DeepSeek 没有随新约束明显改善。

结论：Qwen 和 Kimi 均进入“优质 prompt 加单模型”的跨场景验证候选，Qwen 为当前首选。

### Architecture

平均分增加 `3.50`，是平均提升最大的角色。Kimi 从 `13` 提升到 `20`。

正向变化：

- Kimi 对依赖、责任、发布、幂等和结构边界的覆盖明显改善。
- Qwen 的证据纪律和误报控制继续稳定，适合范围复核。

仍然存在：

- 部分模型仍会把 API 风格偏好升级为架构方向。
- 精确 wire mismatch 仍可能被抽象描述掩盖。
- 共享 `model-output.schema.json` 仍通过 `suggested_fix` 推动模型给出具体实现。

结论：Kimi 进入单模型跨场景验证候选；高风险场景可增加 Qwen 做范围控制，但暂不证明必须配置 team。

### Execution

角色平均分保持 `16.75`，但内部差异扩大。Kimi 从 `20` 提升到 `23`，DeepSeek 从 `19` 降到 `13`。

正向变化：

- Kimi 的契约闭合、证据纪律和误报控制提升。
- GLM 与 Qwen 对接口和异步语义的部分检查有所改善。

风险：

- 同一 prompt 对 DeepSeek 产生明显负面影响。
- DeepSeek 开始错误判断字段路径并引入更多不确定实现。
- 平均分不变说明不能只看角色总体均值。

结论：Kimi 是明确的单模型跨场景验证候选。Execution 自动路由不应设置通用模型降级顺序，必须按模型实测结果配置。

### Rebuttal

GLM 从 `18` 提升到 `23`，证据纪律和误报控制均提升到 `5`。

正向变化：

- GLM 能直接挑战硬约束和协议矛盾，不因专家认可降低判断标准。
- Kimi 覆盖面较广，可补充发布和运行闭环。
- Qwen 的误报成本显著下降。

仍然存在：

- Kimi 会重复拆分同一根因并暗示未经证实的可靠性保证。
- DeepSeek 会引入存储、容量和替代发送路径。
- 共享 schema 中的 `suggested_fix` 仍会诱导替代方案。

结论：GLM 进入单模型跨场景验证候选。后续应建立独立 Rebuttal schema，使用 `counter_evidence` 或 `why_consensus_is_insufficient` 代替具体修复方案。

### Synthesis

Kimi 从 `17` 提升到 `20`，GLM 从 `12` 提升到 `16`，但 DeepSeek 和 Qwen 略有下降。

正向变化：

- Kimi 能正确区分字段事实错误、L2 局部修改和 API L3 方向分歧。
- 主要来源归因和修订一致性明显改善。

仍然存在：

- Kimi 把有效的回滚目标与未经确认的 feature flag 实现一起降权。
- 其他模型仍会新增业务键去重、遗漏来源或直接删除真实 L3 分歧。
- Synthesis 的错误会直接污染最终修订方案，单次高分不足以取消门禁。

结论：Kimi 是主 Synthesizer 候选，但必须继续使用来源保真评估器。当前不推荐无评估器的单模型自动定稿。

## v2 单模型候选

按照 v2 实验定义的条件检查：

| 角色 | 候选模型 | 判断 |
|---|---|---|
| Planner | 无 | 最高 `16`，未达到候选线 |
| Risk | Qwen、Kimi | 达到分数、证据纪律和误报要求 |
| Architecture | Kimi | `20`，五维均为 `4` |
| Execution | Kimi | `23`，核心执行契约完整 |
| Rebuttal | GLM | `23`，证据纪律和误报控制稳定 |
| Synthesis | Kimi | 数值达标，但自动定稿仍需评估器 |

这里的“候选”只表示可以进入其他同角色场景验证，不表示已经确定全局路由。

## Prompt 与 Schema 结论

1. 角色边界写得更明确，对 Kimi 和 GLM 的提升最明显。
2. 同一 prompt 对不同模型可能产生相反影响，不能只维护一套全局模型优先级。
3. Schema 会主动塑造角色行为。Risk 移除 `suggested_fix` 后，越界建议明显减少。
4. 事实纪律规则能降低误报，但也可能让模型过度收敛，遗漏 wire contract、兼容或运行闭环。
5. Planner 和 Synthesis 的输出会决定后续方向，分数达标也应保留独立门禁。
6. 继续针对当前单一 case 调 prompt 会增加过拟合风险，下一步应冻结 v2 prompt 并进行跨场景验证。

## 推荐配置

| 角色 | 当前推荐 | 下一步验证 |
|---|---|---|
| Planner | DeepSeek 主草拟加评估器 | 检查是否在新场景继续违反权威契约和硬约束 |
| Risk | Qwen 单模型候选 | 使用 Kimi 作为备选，不默认双模型 |
| Architecture | Kimi 单模型候选 | 必要时让 Qwen 做范围复核 |
| Execution | Kimi 单模型候选 | 验证不同类型执行计划下的稳定性 |
| Rebuttal | GLM 单模型候选 | 验证没有新问题时能否克制输出 |
| Synthesis | Kimi 加来源保真评估器 | 检查是否继续误删有效目标或新增机制 |

## 下一步

1. 冻结 v2 六份 prompt 和评估器，不再针对本 case 调参。
2. 使用完全相同的角色 prompt 运行 `synthetic/plugin-lifecycle`。
3. 再运行 `synthetic/offline-drafts`，验证不同约束类型。
4. 每个角色继续按四模型一批展示自动草评分，并在人工确认后写入正式评分。
5. 累计至少三个场景后，再决定单模型、主模型加评估器或双模型 team。
6. 自动评分先写入 `scores/drafts/`，不得直接覆盖人工确认结果。
