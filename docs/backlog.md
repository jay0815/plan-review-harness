# Backlog

## 待处理

- [ ] inspect-workspace-run.js 增加 --format json 输出
- [ ] 增加 reviewer 失败分支的离线 orchestration 回归测试：stub 部分 reviewer 成功、部分失败，断言初次 run 在 fact_check 前失败并记录 reviewers_failed，且 retry stage=reviewers 只重跑失败/缺失 reviewer
- [ ] reviewer 失败时支持按角色部分重试（而非整个 reviewers 阶段）

## 进行中

（暂无）

## 已完成

- [x] 增加 workspace run manifest backfill 脚本 # 2026-06-26
- [x] 改进 reviewer 阶段失败的错误处理（reviewerStageError） # 2026-06-26
- [x] 支持中文计划的显式章节映射 # 2026-06-26
- [x] 区分成功/失败的读取尝试，检测失败的越界读取 # 2026-06-26
