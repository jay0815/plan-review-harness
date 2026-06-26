# 错误记录

## retry 后验证误判 run 已完成

- **现象**: retry 后 verify-run 认为 run 已完成，但实际还在运行
- **原因**: retry 未重置 `finished_at` 字段
- **解决**: retry 开始时显式重置 `finished_at: undefined`
- **日期**: 2026-06-26

## reviewer 全部失败时无诊断信息

- **现象**: reviewer 全部超时，只抛出 "All reviewers failed"，无具体原因
- **原因**: 未区分基础设施错误和逻辑错误
- **解决**: 新增 `reviewerStageError` 函数，收集 infra_error 详情
- **日期**: 2026-06-26

## 旧版 run 验证失败但无法修复

- **现象**: 旧版 run 缺少 manifest，verify-run 报错但无修复路径
- **原因**: manifest 是后加功能，旧版不生成
- **解决**: 新增 backfill 脚本，doctor 诊断时给出 backfill 命令
- **日期**: 2026-06-26
