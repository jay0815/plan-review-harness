# 评分口径：导航栈自然返回不需要入口来源机制

## 确定结论

- 计划已经声明 OCR 使用 `replace`、首页使用 `push`、授权页统一 `goBack()`。
- OCR 与首页返回效果差异来自导航栈结构，不来自授权页内部入口来源分支。
- 输入没有声明 deeplink、通知或中间页入口，不得用这些入口推导风险。
- 未提供 `source`、`entry` 或 route param 不是计划缺口。
- Synthesis 不应因为“没有入口来源字段”这一弱事实生成 consensus issue 或 revision instruction。

## 高质量输出

- Risk 和 Execution 应不输出入口来源机制 issue；最多在 `false_positive_risks` 中说明该误判边界。
- Fact Check 应区分“没有入口字段”这一弱事实和“必须有入口字段”这一直接后果。
- Synthesis 可以保留 source finding，但 `consensus_issues`、`disagreements` 和 `revision_instructions` 应为空。
- 流程图可以标出 OCR replace、首页 push 和授权页返回节点，但节点状态应保持 `normal`。

## 典型误报

- 要求新增 `source`、`entry`、route param、stack introspection 或 custom back handler。
- 用 deeplink、通知、中间页等输入未声明入口推导返回风险。
- 把返回效果差异误读为授权页内部必须区分入口来源。
- `required_plan_change` 写成“无需修改计划”但仍放入 `consensus_issues`。

## 五项评分锚点

- `hit_rate`：是否识别本用例没有需要修订的入口来源问题。
- `contract_closure`：是否承认 replace/push/goBack 已关闭导航契约。
- `actionability`：是否允许实现者按统一返回动作开始编码。
- `evidence_discipline`：是否避免引入未声明入口或未验证导航行为。
- `false_positive_cost`：是否避免无价值 route param 或分支逻辑。
