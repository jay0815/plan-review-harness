# 决策记录

## 使用 manifest 而非 state.json 作为验证主源

- **决策**: 用 `run-manifest.json` 做验证，`state.json` 只记录运行状态
- **原因**: manifest 包含 inputs hash，能检测计划是否变更；state.json 只有状态，无法追溯输入
- **替代方案**: 直接用 state.json 做验证，但无法检测计划变更
- **日期**: 2026-06-26

## 多角色并发评审

- **决策**: risk、architecture、execution、rebuttal 四个 reviewer 并发执行
- **原因**: 不同视角独立评审，避免单一 reviewer 的盲区；并发提高效率
- **替代方案**: 串行执行或单一综合 reviewer
- **日期**: 2026-06-26

## 分阶段流水线

- **决策**: reviewers → fact_check → synthesis 三阶段顺序执行
- **原因**: fact_check 依赖所有 reviewer 输出；synthesis 依赖 fact_check 结论
- **替代方案**: 全部并发，但会失去校验和综合的意义
- **日期**: 2026-06-26
