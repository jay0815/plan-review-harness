# Backlog

## 待处理

### 其他

- [ ] reviewer 失败时支持按角色部分重试 [P2] [1d] @workspace-review

## 进行中

（暂无）

## 已完成

- [x] Fix-001: createdAt 硬编码常量 → Clock 接口 + 注入时钟 [P0] [0.5d] @core # 2026-06-27
- [x] Fix-002: merge 函数 updatedAt 处理 → 联动 Fix-001 [P0] [0.5d] @core # 2026-06-27
- [x] Fix-003: blindReview 双重写入 → 移除 adapter result.json [P0] [0.5d] @core # 2026-06-27
- [x] Fix-004: synthesis issue 合并逻辑 → 全链路共识检测 [P1] [1d] @core # 2026-06-27
- [x] Fix-005: workerContext role 类型 → buildWorkerContext [P0] [0.5d] @core # 2026-06-27
- [x] Fix-006: resume CLI 入口 → 新增 resume 命令 [P1] [1d] @cli # 2026-06-27
- [x] Fix-007: regression fixture round 硬编码 → fallback 机制 [P1] [0.5d] @core # 2026-06-27
- [x] Fix-008: 失败状态持久化 → saveFailedState + WorkflowError [P0] [1d] @core # 2026-06-27
- [x] Fix-009/010/011: model-role-calibration 模块化重构 → scripts 分层 + 分发路径更新 [P2] [8d] @workspace-review # 2026-06-28
- [x] Fix-012: toolchain 边界文档化 → README 说明 + tsconfig 收紧 [P2] [0.5d] @workspace-review # 2026-06-28
- [x] Fix-013: schema 一致性验证 → SEVERITY_VALUES + 检查脚本 [P2] [1d] @core @workspace-review # 2026-06-28
- [x] Fix-014: context.md 更新流程 → 维护规则 [P1] [0.5d] @docs # 2026-06-27
- [x] Fix-015: backlog 结构化改进 → 优先级和估算 [P1] [0.5d] @docs # 2026-06-27
- [x] 增加 reviewer 失败分支的离线 orchestration 回归测试 [P1] [0.5d] @workspace-review # 2026-06-28
- [x] `scripts/workspace/inspect-workspace-run.ts` 增加 `--format json` 输出 [P2] [0.5d] @workspace-review # 2026-06-28
- [x] 增加 workspace run manifest backfill 脚本 # 2026-06-26
- [x] 改进 reviewer 阶段失败的错误处理（reviewerStageError） # 2026-06-26
- [x] 支持中文计划的显式章节映射 # 2026-06-26
- [x] 区分成功/失败的读取尝试，检测失败的越界读取 # 2026-06-26
