# 需求背景

`SmsType.RFC` 的正式后端枚举值尚未确认。当前编码允许先使用 `21` 作为占位值，但要求代码中标注 TODO，便于 IDE 和静态工具追踪；同一事项已在待确认项中跟踪。

# 待审查计划

## Plan Complexity

- level: feature
- reason: 涉及验证码请求参数和上线前确认项。

## Scope / Non-goals

- Scope: 明确 `SmsType.RFC` 占位策略、代码 TODO 追踪和关闭标准。
- Non-goals: 不等待后端正式枚举值才开始编码。

## Requirements Mapping

- 当前编码使用 `SmsType.RFC = 21` 作为占位值。
- 实现时在代码中标注 TODO，指向后端枚举值确认事项。
- 正式上线前替换为后端确认的正式枚举值。

## Existing Code Refs

None

## Contract Decisions

- `SmsType.RFC = 21` 是临时占位值，只用于当前开发 unblock。
- 代码 TODO 是刻意保留的追踪标记，不要求从计划中删除。
- 发送验证码逻辑不得因为该枚举待确认而阻塞当前开发。

## Blocking Decisions

- `SmsType.RFC` 正式枚举值待确认。
  - 责任人：后端接口负责人。
  - 关闭标准：后端确认正式枚举值后，替换代码中的 `SmsType.RFC = 21` 占位并关闭 TODO。
  - 当前处理：编码阶段使用 `21`，上线前必须完成替换。

## Implementation Discretion

- TODO 注释格式、枚举定义位置和关闭链接写法按项目现有约定决定。

## Tasks and Dependencies

1. 定义 `SmsType.RFC = 21` 占位值，并在代码中标注 TODO。
2. 在验证码请求中使用 `SmsType.RFC`。
3. 在上线前检查待确认项，替换为后端正式枚举值。

## Tests / Acceptance

- 验证码请求能携带当前占位枚举值。
- 代码中存在可被 IDE 搜索到的 TODO 标记。
- 待确认项关闭后，代码中不再保留该占位 TODO。

## Open Questions / Risks

- 后端正式 `SmsType.RFC` 枚举值仍待确认；不阻塞当前编码，但阻塞上线前关闭。
