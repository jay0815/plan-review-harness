# 角色 Prompt 下一轮优化建议

## 文档目的

本文总结不同角色的初始化 prompt、输出 Schema 和评估器 prompt 的下一轮优化方向。

目标：

- 支持当前模型角色校准流程继续迭代。
- 为其他项目创建 Planner、Reviewer、Synthesizer 和 Evaluator prompt 提供可复用方法。
- 保证角色输出和评估标准使用同一份职责契约。
- 为后续接入 Codex CLI 自动评分建立稳定边界。

## v2 已确认结论

`synthetic/event-reporting` v2 已完成四模型、六角色共 24 份输出的人工确认评分。完整快照和对比报告位于：

```text
model-role-calibration/archive/synthetic-event-reporting/v2/
model-role-calibration/archive/synthetic-event-reporting/v2/analysis/v1-v2-comparison.md
```

本轮确认：

- Risk：Qwen `23`、Kimi `22`，已进入单模型跨场景验证候选。
- Architecture：Kimi `20`，进入单模型跨场景验证候选。
- Execution：Kimi `23`，进入单模型跨场景验证候选。
- Rebuttal：GLM `23`，进入单模型跨场景验证候选。
- Planner：最高为 DeepSeek `16`，仍需要主模型加评估器门禁。
- Synthesis：Kimi `20`，数值达标，但来源裁决错误的影响较大，仍必须保留评估器。

v2 还证明：

- 相同 prompt 对不同模型的影响可能相反，不能把 prompt 优化视为统一增益。
- DeepSeek 的 Execution 从 `19` 降至 `13`，说明角色路由必须使用实测结果，不能按模型总体能力推断。
- Risk 的提升同时受到 prompt 和独立 schema 影响，不能与其他角色做纯 prompt 横向归因。
- 继续围绕当前单一 case 调参会增加过拟合风险，下一阶段应冻结 v2 prompt，转向跨场景验证。

## 通用原则

### 1. 先定义职责，再定义输出字段

初始化 prompt 必须明确：

- 角色负责什么。
- 角色不负责什么。
- 输入中哪些内容是事实。
- 遇到未知事项时如何处理。
- 什么情况属于职责越界。

Schema 必须反映职责边界。不要在 Schema 中强制角色输出其本不负责的内容。

已验证问题：

- Risk Reviewer 不负责设计修复方案，但旧 Schema 强制输出 `suggested_fix`。
- 仅通过 prompt 禁止某项行为不够，Schema 仍会驱动模型生成该内容。

下一轮要求：

- 初始化 prompt、Schema、评估器三者必须同步修改。
- 新增或删除字段前，先说明该字段属于哪个角色职责。

### 2. 评分优先级必须分层

所有角色的评估器使用统一优先级：

1. `底线`：不胡说、不脑补、不违反输入硬约束。
2. `基础`：正确完成角色核心职责。
3. `提升`：在守住底线和基础后，提高覆盖面、闭环程度和可执行性。

禁止：

- 用篇幅、问题数量或术语数量抵消事实错误。
- 因为输出覆盖面广，就降低对无依据假设的惩罚。
- 为了拉开模型差距而制造扣分项。

### 3. 未知事实必须进入专用字段

不同角色对未知事实的处理方式不同：

- Planner：放入 `open_decisions`，主路径不得依赖未验证结论。
- Reviewer：放入 `missing_questions`，不得自行补全事实。
- Synthesizer：标记为证据不足或待用户裁决，不得替来源补证据。
- Evaluator：降低 `evidence_discipline`，并记录具体脑补内容。

“不提”通常优于“猜测一个答案”。

### 4. 覆盖维度不能变成强制编造

角色可从多个维度检查输入，但只输出有 evidence 的结论。

例如 Risk Reviewer 可检查：

- 架构风险。
- 实现风险。
- 业务影响。
- 安全风险。
- 兼容、观测和回滚风险。

如果输入没有安全 evidence，不输出安全问题是正确行为。为了覆盖维度而虚构问题，应降低 `evidence_discipline` 和 `false_positive_cost`。

### 5. 初始化 Prompt 与评估器必须成对维护

每个角色至少包含：

```text
prompts/probe-<role>.md
schemas/<role>-output.schema.json
prompts/evaluate-<role>.md
```

评估器必须检查初始化 prompt 中的职责约束，而不是只检查案例 rubric。

推荐在评估器中显式写出：

- 输入材料的权威顺序。
- 角色职责边界。
- 各评分维度的 0 到 5 锚点。
- 已确认的校准经验。
- 输出 JSON 契约。

## Planner

### 初始化 Prompt

当前有效规则：

- 明确目标、范围和不做事项。
- 定义关键接口、数据流、执行顺序和依赖。
- 覆盖失败、兼容、测试、验收和回滚。
- 将改变实现方向的未知事项放入 `open_decisions`。

下一轮优化：

1. 强制在实施步骤前定义权威契约：
   - 公共 API。
   - 内部数据结构。
   - 字段权威位置。
   - 字段生成方和读取方。
   - 跨层传递路径。
2. 增加 `blocking_design_decisions`，区分执行前必须决定的问题和非阻塞待确认项。
3. 明确主路径不得依赖 `open_decisions` 中尚未验证的结果。
4. 明确最小实现和不做事项，抑制可靠投递、平台化和并行 API 扩张。
5. 要求兼容矩阵、观测指标和回滚条件，但不得假设已有基础设施。

### Planner 评估器

继续强化：

- `hit_rate`：覆盖关键约束和主问题。
- `contract_closure`：唯一权威结构、责任和失败语义是否闭合。
- `actionability`：步骤是否能执行，阻塞决策是否前置。
- `evidence_discipline`：未知事实是否被隔离。
- `false_positive_cost`：是否引入超范围建设。

下一轮校准重点：

- 区分“提到一个主题”和“真正闭环”。
- Planner 可以做决策，但必须说明依据和范围。
- 同一语义存在多个候选位置且未决策时，降低 `contract_closure`。
- 把未知事实同时写入主方案和 `open_decisions`，仍应扣分。

## Risk Reviewer

### 初始化 Prompt

已确认职责：

- 从架构、实现、业务影响和安全等角度识别失败风险。
- 只报告输入 evidence 支持的问题。
- 输出风险类型、严重性、证据、影响和置信度。
- 未知事项进入 `missing_questions`。
- 不提供修复方案。

已完成调整：

- 新增独立 `risk-output.schema.json`。
- 移除 `suggested_fix`。
- 明确事实正确是基础，覆盖全面是提升。
- 明确胡说和脑补是底线错误。

下一轮优化：

1. 增加 `trigger_condition` 字段，迫使模型说明风险在什么条件下发生。
2. 考虑增加 `affected_dimension`：
   - `architecture`
   - `implementation`
   - `business`
   - `security`
   - `compatibility`
   - `observability`
   - `rollback`
3. `false_positive_risks` 统一为字符串或结构化对象，不要让不同模型自行选择形状。
4. 增加根因标识或合并规则，减少同一问题被拆成多个 issue。
5. 明确 `preference` 默认不得使用 `high` 或 `blocker`。

### Risk 评估器

已确认评分原则：

- 底线：不胡说、不脑补。
- 基础：风险结论符合事实和直接因果。
- 提升：架构、实现、业务、安全、兼容、观测和回滚覆盖全面。
- 错误建议不能提高 `actionability`。
- Risk Reviewer 提供具体修复方案属于职责越界。

后续回归样本应覆盖：

- 高覆盖但大量脑补。
- 覆盖较少但证据严格。
- 正确识别风险但给出破坏设计的修复建议。
- 没有安全 evidence 且不输出安全问题。
- 为了覆盖安全维度而虚构安全问题。

## Architecture Reviewer

### 初始化 Prompt

当前问题：

- Schema 仍强制输出 `suggested_fix`。
- “不陷入实现细节”与“输出修复建议”可能冲突。
- `boundary`、`dependency`、`coupling` 等类型边界缺少说明。

下一轮建议：

1. 明确 Architecture Reviewer 是否负责建议。
   - 推荐只指出结构性修订目标，不指定具体实现。
   - 可将 `suggested_fix` 改为 `required_architecture_change`，限制在边界级描述。
2. 明确只评价：
   - 模块和层次边界。
   - 责任归属。
   - 依赖方向。
   - 权威数据源。
   - 发布与版本耦合。
   - 长期维护成本。
3. 不评价：
   - 业务价值。
   - 具体超时和重试参数。
   - 文件名、命令名和代码风格。
   - 无证据的未来扩展需求。
4. 未知系统结构放入 `missing_questions`，不自行假设已有模块。

### Architecture 评估器

重点检查：

- 是否识别真正的结构问题，而不是实现 bug。
- 是否把局部字段错误上升为正确的契约或所有权问题。
- 是否把偏好包装成架构 blocker。
- 是否因为“更清晰”就要求拆分公共 API。
- 是否引入不必要抽象、平台或中间层。
- 是否能够保持结构结论和输入 evidence 一致。

## Execution Reviewer

### 初始化 Prompt

当前问题：

- `suggested_fix` 会推动 Reviewer 重写计划。
- “文件、命令”不是所有输入都会提供，容易诱发模型编造仓库结构。

下一轮建议：

1. 明确 Execution Reviewer 负责发现执行阻塞，不负责设计架构。
2. 输出应聚焦：
   - 缺失步骤。
   - 顺序错误。
   - 未声明依赖。
   - 输入和输出不明确。
   - 验收不可验证。
   - 发布、回滚和恢复步骤缺失。
3. 没有仓库上下文时：
   - 不得编造文件路径和命令。
   - 应指出需要确定的文件或接口类型。
4. 考虑将 `suggested_fix` 改为 `required_plan_detail`，只允许说明计划必须补充什么。
5. 增加 `blocks_execution: true | false`，区分真正阻塞项和质量改进项。

### Execution 评估器

重点检查：

- 是否准确识别“无法执行”的原因。
- 是否区分设计未决和步骤缺失。
- 是否把架构偏好当成执行阻塞。
- 是否编造路径、命令、工具和基础设施。
- 是否覆盖测试、验收、发布顺序和回滚。
- 输出是否能直接转化为 Planner 的补充清单。

## Rebuttal Reviewer

### 初始化 Prompt

当前问题：

- 容易为了反驳而反驳。
- `suggested_fix` 会增加输出越界风险。
- 与 Risk Reviewer 的职责边界不够清晰。

下一轮建议：

1. 核心任务应是测试“专家认可”是否造成从众偏差。
2. 只报告：
   - 被共识忽略的明确缺陷。
   - 方案内部矛盾。
   - 无依据假设。
   - 遗漏的硬约束。
3. 不要求发现新问题；没有额外问题时允许输出空数组。
4. 不得为了体现独立性而降低证据标准。
5. 考虑移除 `suggested_fix`，保留 `counter_evidence` 或 `why_consensus_is_insufficient`。
6. 不得把 API 风格偏好提升为方向性结论。

### Rebuttal 评估器

重点检查：

- 是否独立但不刻意唱反调。
- 是否重复其他 Reviewer 已明确指出的问题而没有新增价值。
- 是否能够挑战错误共识。
- 是否把“专家认可”当成证据。
- 是否为反驳而引入超范围替代方案。

## Synthesizer

### 初始化 Prompt

当前有效职责：

- 合并重复问题。
- 识别真正分歧。
- 区分互补与冲突。
- 标记需要用户裁决的问题。
- 降权无 evidence 的高风险判断。

下一轮建议：

1. 增加来源保真要求：
   - 不得新增 Reviewer 未提出的事实。
   - 每个共识问题必须能追溯到来源。
2. 明确分歧分类：
   - 事实分歧。
   - 严重性分歧。
   - 局部实现分歧。
   - 方向性决策分歧。
3. `suggested_fix` 和 `revision_instructions` 可能重复，建议保留一个。
4. 增加 `discarded_findings`，记录被判定为重复、无证据或超范围的意见及原因。
5. `needs_human_decision` 只用于真实方向性分歧，不能把所有未决事项都升级为人工裁决。
6. Synthesizer 不得替用户拍板 L3 方向，但应清晰列出决策选项和影响。

### Synthesis 评估器

重点检查：

- 是否真正合并重复问题。
- 是否保留关键分歧而不是平均化。
- 是否正确降权 Kafka、独立数据库、平行 API 等超范围建议。
- 是否把局部实现选择误标为 L3。
- 是否新增来源中不存在的事实。
- 修订指令是否与保留结论一致。

## Schema 设计建议

### 每个角色使用独立 Schema

不要继续让多个角色共享一个宽泛 Schema。

建议：

```text
planner-output.schema.json
risk-output.schema.json
architecture-output.schema.json
execution-output.schema.json
rebuttal-output.schema.json
synthesis-output.schema.json
score.schema.json
```

原因：

- 不同 Reviewer 是否允许建议并不相同。
- 不同角色需要不同 issue 类型和必填字段。
- 独立 Schema 可以在生成阶段硬性禁止职责越界。

### Schema 保持严格

继续使用：

- 顶层 `type: object`。
- 顶层和嵌套对象 `additionalProperties: false`。
- 明确 `required`。
- 枚举限制类型和严重性。
- 数值范围限制 `confidence` 和评分。

避免：

- 顶层 `oneOf`。
- `type: string` 代替稳定枚举。
- 同一字段允许字符串和对象两种结构。
- Schema 示例与真实 Schema 不一致。

## 评估器设计建议

### 使用案例 Rubric，但不硬编码案例答案

评估器由两部分组成：

1. 通用角色评价规则。
2. 运行时注入的案例 rubric。

通用规则负责职责和评分维度；rubric 负责当前案例的确定问题、高质量输出和典型误报。

### 输出逐维证据

评估器输出应包含：

```json
{
  "score": {},
  "dimension_assessments": {
    "hit_rate": {
      "score": 0,
      "rationale": "",
      "evidence": []
    }
  }
}
```

要求：

- 分数与说明一致。
- 每个扣分项明确所属维度。
- 同一问题影响多个维度时，分别说明影响原因。
- `total` 必须由五项分数计算。

### 自动评分前先做回归校准

每个评估器至少准备：

- 1 个高质量样本。
- 1 个高命中但脑补严重的样本。
- 1 个事实克制但覆盖不足的样本。
- 1 个职责越界样本。
- 1 个方向性错误样本。

比较自动评分与人工确认分数：

- 允许总分小幅偏差。
- 不允许事实底线和角色职责判断相反。
- 不允许高覆盖脑补输出因篇幅获得高分。

## 自动化接入建议

在 Codex CLI 自动评估接入前，按以下顺序完成：

1. 为六个角色建立独立输出 Schema。
2. 完成六个初始化 prompt 的职责边界校准。
3. 完成六个 `evaluate-<role>.md`。
4. 用人工已确认样本做评估器回归。
5. 定义 Codex CLI 隔离参数和输出 Schema。
6. 自动生成评估 prompt。
7. 执行评分 Agent。
8. 校验评分 JSON。
9. 写入 `scores/<model>-<probe>.score.json`。
10. 汇总报告。

自动化必须保留：

- 每次评估的完整 prompt。
- Codex CLI 原始输出。
- 结构化评分结果。
- 使用的评估器版本或 hash。
- 失败 attempt 和重试记录。
- 人工覆盖自动评分的审计记录。

## 下一轮执行清单

1. 冻结 `synthetic/event-reporting` v2 的六份初始化 prompt、评估器和评分结果。
2. 使用相同 prompt 运行 `synthetic/plugin-lifecycle`，不得增加模型专属提示。
3. 使用相同 prompt 运行 `synthetic/offline-drafts`，验证不同约束类型。
4. 每个角色按四模型一批生成自动草评分，人工确认后才写入正式评分。
5. 自动评分结果先写入 `scores/drafts/`，保留 evaluator 版本、完整 prompt、原始输出和失败 attempt。
6. 为 Architecture 建立独立 schema，将 `suggested_fix` 收敛为 `required_architecture_change`。
7. 为 Execution 建立独立 schema，将建议收敛为 `required_plan_detail`，并增加 `blocks_execution`。
8. 为 Rebuttal 建立独立 schema，使用 `counter_evidence` 或 `why_consensus_is_insufficient` 代替具体修复方案。
9. 强化 Synthesis 的来源映射：每条 `revision_instruction` 必须对应已保留的共识或分歧，回滚目标不得与未经确认的实现一起删除。
10. Planner 增加权威契约和阻塞设计决策的结构化字段，禁止实施步骤依赖未决问题。
11. 使用 v1 和 v2 的 48 份人工确认评分建立评估器回归集。
12. 累计至少三个场景后，再决定单模型、主模型加评估器或双模型 team。

## 跨项目复用模板

在其他项目创建新角色 prompt 时，先回答：

1. 这个角色必须完成什么？
2. 这个角色明确不能做什么？
3. 哪些输入是事实来源？
4. 未知事项应该进入哪个字段？
5. 什么行为属于底线失败？
6. 什么能力属于基础达标？
7. 什么覆盖属于提升项？
8. 输出 Schema 是否硬性执行上述边界？
9. 评估器是否使用相同职责定义？
10. 是否有人工确认样本验证评分方向？

只有这十项明确后，才进入批量模型比较和自动评分。
