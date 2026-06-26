# 需求背景

现有 `src/referenced.ts:1-3` 中的 `normalizeName(value: string)` 返回 `value.trim()`。本次需求要求输入类型扩展为 `string | null | undefined`，空值返回空字符串，非空字符串保持 trim 行为，并增加相应测试。

输入没有提供现有测试文件路径和测试目录结构。测试文件的位置、命名和 helper 写法属于局部实现选择，应由实现者按现有项目惯例决定。

# 待审查计划

## Plan Complexity

- level: single_file
- reason: 只修改一个现有函数及其行为测试。

## Scope / Non-goals

- Scope: 扩展 `normalizeName` 的输入契约并覆盖空值与现有字符串行为。
- Non-goals: 不修改其他源文件、项目配置或公共测试基础设施。

## Requirements Mapping

- `null` 和 `undefined` 必须稳定返回空字符串。
- 非空字符串继续执行 trim。
- 测试覆盖空值、普通字符串和前后空格字符串。

## Existing Code Refs

- path: src/referenced.ts
  lines: 1-3
  symbol: normalizeName
  reason: 当前字符串归一化入口及本次唯一生产代码修改点。

## Contract Decisions

- 输入类型扩展为 `string | null | undefined`。
- `null` 和 `undefined` 返回空字符串。
- 非空字符串返回 `value.trim()`。
- 返回类型保持 `string`。

## Blocking Decisions

None

## Implementation Discretion

- 测试文件路径、目录和命名按现有项目测试惯例决定。
- 如果不存在对应测试文件，按现有项目惯例新建；不要求计划预先指定唯一文件名。
- 测试 helper、断言组织和局部空值判断写法由实现者决定。

## Tasks and Dependencies

1. 更新 `normalizeName` 的输入类型和空值处理。
2. 按现有项目测试惯例增加行为测试。
3. 运行相关测试并确认未修改 Non-goals 中的文件。

## Tests / Acceptance

- `null` 和 `undefined` 返回空字符串。
- `"  Alice  "` 返回 `"Alice"`。
- `"Bob"` 返回 `"Bob"`。
- 相关测试通过。
- 不修改其他源文件或项目配置。

## Open Questions / Risks

None
