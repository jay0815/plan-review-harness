# 需求背景

授权页返回行为只依赖导航栈：

- OCR 成功后使用 `replace(Authorization)`，使 OCR 成功页不留在返回栈。
- 首页入口使用 `push(Authorization)`。
- 授权页内部统一执行返回动作；页面内部没有按入口来源分支的业务逻辑。
- 输入没有声明 deeplink、通知或中间页入口。

# 待审查计划

## Plan Complexity

- level: feature
- reason: 调整一个授信导航流程和授权页返回语义。

## Scope / Non-goals

- Scope: 定义 OCR 成功、首页待办和授权页返回的导航语义。
- Non-goals: 不新增 deeplink、通知入口、中间页入口或授权页内部入口来源分支。

## Requirements Mapping

- OCR 成功进入授权页后，返回不应回到 OCR 成功页。
- 首页待办进入授权页后，返回应回到首页。
- 授权页不需要根据入口来源执行不同业务逻辑。

## Existing Code Refs

None

## Contract Decisions

- OCR 成功进入授权页使用 `replace(Authorization)`。
- 首页待办进入授权页使用 `push(Authorization)`。
- 授权页返回键统一执行 `goBack()`；不同返回效果由导航栈结构自然产生。
- 不新增 `source`、`entry` 或同类 route param 来区分 OCR 与首页入口，因为授权页内部没有入口相关业务分支。

## Blocking Decisions

None

## Implementation Discretion

- 具体导航 helper 名称、事件绑定位置和局部封装由实现者按现有项目模式决定。

## Tasks and Dependencies

1. 在 OCR 成功分支使用 replace 进入授权页。
2. 在首页待办入口使用 push 进入授权页。
3. 确认授权页返回键只调用统一返回动作。
4. 补充覆盖 OCR replace 与首页 push 的导航行为验证。

## Tests / Acceptance

- OCR 成功后进入授权页，返回不展示 OCR 成功页。
- 首页待办进入授权页，返回回到首页。
- 授权页代码不存在按 `source` 或 `entry` 分支的返回逻辑。

## Open Questions / Risks

None
