# fact-check 模块

## 设计背景

Fact Check 负责校验 reviewer 输出中 evidence 的有效性，防止虚假引用或错误证据通过评审。

## 执行时机

在所有 reviewer 完成后、synthesis 之前执行。

## 输入

- reviewer 输出的 issues 列表
- 每个 issue 附带的 evidence（文件路径、行号、内容引用）

## 校验逻辑

1. 检查 evidence 引用的文件是否存在
2. 检查引用的行号是否在范围内
3. 检查引用的内容是否与实际代码匹配
4. 生成 strictness_signal: all_verified / partial_verified / no_issues_checked

## 输出

- fact-check-summary.json: 校验统计
- 更新各 issue 的 evidence 状态
