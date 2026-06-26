# 技术债

## reviewer 越界读取

- **状态**: 已知，暂不修
- **影响**: 轻微，只产生 warning，不阻塞评审
- **原因**: reviewer prompt 未严格约束读取范围
- **后续**: 考虑在 prompt 中增加 read_boundary 说明，或在 tool 层面拦截

## retry 配额检查

- **状态**: 已修（2026-06-18）
- **影响**: 修复前可能超过 MAX_EXECUTOR_RETRIES 限制
- **原因**: retryPlanReviewStage 中 MAX_EXECUTOR_RETRIES 是常量，不随 stage 变化
- **后续**: 考虑为不同 stage 配置不同的重试上限

## test 命令过长

- **状态**: 已知
- **影响**: package.json 中 test 脚本超过 3000 字符，难以维护
- **原因**: 所有 node --check 和测试命令串行拼接
- **后续**: 考虑拆分为独立的 test 脚本文件
