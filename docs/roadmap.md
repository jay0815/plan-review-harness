# Roadmap

## 当前阶段：架构修复

目标：解决架构梳理中发现的问题，提升系统正确性和可维护性。

### Phase 1：Core 修复 [P0] ✅

- [x] Fix-001: createdAt 硬编码常量 → Clock 接口 + 注入时钟
- [x] Fix-002: merge 函数 updatedAt 处理 → 联动 Fix-001
- [x] Fix-003: blindReview 双重写入 → 移除 adapter result.json 写入
- [x] Fix-005: workerContext role 类型 → 统一到 ArtifactPathBuilder.buildWorkerContext
- [x] Fix-008: 失败状态持久化 → saveFailedState + WorkflowError

### Phase 2：CLI 和功能增强 [P1] ✅

- [x] Fix-006: resume CLI 入口 → 暴露 resume 为 CLI 命令
- [x] Fix-007: regression fixture round 硬编码 → fallback 机制
- [x] Fix-004: synthesis issue 合并逻辑 → 全链路共识检测

### Phase 3：文档和流程 [P1] ✅

- [x] Fix-014: context.md 更新流程 → CLAUDE.md + AGENTS.md 维护规则
- [x] Fix-015: backlog 结构化改进 → 增加优先级和估算

### Phase 4：模块化重构 [P2] ✅

- [x] Phase 1: 类型提取到 workspace-review-types.ts
- [x] Phase 2: 配置加载提取到 workspace-review-config.ts
- [x] Phase 3: manifest 拆分（已是纯库模块，跳过）
- [x] Phase 4: workspace-review-lib.ts 收敛（通过 import + re-export）
- [x] Fix-012: toolchain 边界文档化
- [x] Fix-013: schema 一致性验证
- [x] Phase 5: 目录重组（scripts/lib、workspace、mcp、cli、test）
- [x] Phase 6: README 职责声明

### 进度

- Phase 1: 5/5 ✅
- Phase 2: 3/3 ✅
- Phase 3: 2/2 ✅
- Phase 4: 8/8 ✅
- 总计: 13/13 完成

## 下一阶段：评审质量提升

目标：提高 reviewer 输出的准确性和实用性。

### 待规划

- reviewer prompt 优化
- fact check 覆盖率提升
- synthesis 报告结构化改进
