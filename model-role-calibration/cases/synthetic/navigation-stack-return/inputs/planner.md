# 需求：授权页返回行为由导航栈自然决定

移动端授信流程有两个入口：

- OCR 提交成功后，根据 `switchOn` 决定是否进入授权页；进入授权页时使用 `replace`，避免返回 OCR 成功页。
- 首页待办入口在 `isFinishAuthorization === false` 时使用 `push` 进入授权页。

授权页内部只有统一返回动作，不根据入口来源执行不同业务逻辑。返回效果由进入方式形成的导航栈自然决定：

- OCR 路径：`Home -> OCR -> Authorization`，其中 OCR 成功后 `replace(Authorization)`，返回时回到 Home。
- 首页路径：`Home -> Authorization`，返回时 `goBack()` 回到 Home。

请生成一份计划，明确导航语义、授权页统一返回动作、以及不引入 source/entry route param 的边界。
