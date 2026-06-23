# 评分口径：测试文件位置属于 Implementation Discretion

## 确定结论

- 计划已经关闭 `normalizeName` 的输入、输出、空值行为、实施顺序和验收标准。
- 测试文件路径、目录、命名、helper 和断言组织不改变业务语义、公共接口或失败语义。
- 计划已明确这些局部选择遵循现有项目惯例，并说明不存在对应测试文件时按惯例新建。
- 因此，未指定唯一测试文件路径不是 Execution issue，也不需要形成计划修订指令。
- “计划没有写唯一测试路径”这一事实即使被 Fact Check 确认，也不能自动证明其阻塞执行或构成计划缺口。

## 高质量输出

- Planner 应把测试文件位置和命名保留在 `implementation_discretion`，不编造仓库中未提供的测试路径。
- Execution Reviewer 的 `issues` 应为空；可以在 `false_positive_risks` 中说明测试文件位置属于项目惯例。
- Risk、Architecture 和 Rebuttal 不应把局部测试组织升级为业务、架构或公共契约问题。
- Synthesis 应保留来源追踪，但把 Execution 的意见识别为可能误报。
- Synthesis 的 `consensus_issues`、`disagreements` 和 `revision_instructions` 应为空。
- Synthesis 的流程节点应保持 `normal`，不能因为测试文件名未确定而标记为 `affected`。

## 典型误报

- 出现了 Execution issue，要求计划补充唯一测试文件路径、目录或命名规则。
- 出现了因测试文件路径未知而把计划判定为不可执行或 `needs_revision`。
- 出现了要求补充测试源码、fixture、helper、断言结构或具体测试框架配置。
- 出现了 Synthesis 仅因为 Fact Check 状态为 `verified`，就忽略其 reason 对阻塞性和因果链的否定。
- 出现了 Synthesis 一方面承认 `blocks_execution=false` 或该事项属于项目惯例，另一方面仍生成修订指令。
- 出现了编造现有测试文件路径或仓库目录结构的回答。

## 五项评分锚点

- `hit_rate`：5 分制，看是否正确识别本用例没有需要修订的执行缺口，并正确处理唯一的误报意见。
- `contract_closure`：5 分制，看是否承认输入输出、行为和验收已闭合，不把局部文件组织重新升级为契约。
- `actionability`：5 分制，看是否允许实现者直接按项目惯例开始编码和测试，不制造额外计划工作。
- `evidence_discipline`：5 分制，看是否区分事实确认与缺口成立，且不编造测试路径或仓库结构。
- `false_positive_cost`：5 分制，看是否避免要求唯一测试路径、完整测试源码或无必要的计划修订。分数越高表示误报越少、额外成本越低。

每项 `0` 表示基本失败，`3` 表示可用但仍保留明显误报，`5` 表示完整遵守 Implementation Discretion 边界且没有生成修订噪音。总分 25 分。
