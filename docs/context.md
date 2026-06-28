# 当前迭代上下文

## 本轮目标

为 workspace review inspect 工具增加机器可读 JSON 输出。

## 当前状态

- 已完成：架构修复计划已提交；reviewer 失败分支离线回归测试和 inspect JSON 输出已补齐
- 进行中：后续 workspace review 可靠性与评审质量提升
- 总进度：架构修复 13/13 完成

## 已完成的 Fix

| Fix     | 问题                    | 状态                               |
| ------- | ----------------------- | ---------------------------------- |
| Fix-001 | createdAt 硬编码        | ✅ Clock 接口 + 注入时钟           |
| Fix-002 | merge updatedAt         | ✅ 联动 Fix-001                    |
| Fix-003 | blindReview 双重写入    | ✅ 移除 adapter result.json        |
| Fix-004 | issue 合并              | ✅ 全链路共识检测                  |
| Fix-005 | workerContext role 类型 | ✅ buildWorkerContext              |
| Fix-006 | resume CLI              | ✅ 新增 resume 命令                |
| Fix-007 | regression fixture      | ✅ round fallback                  |
| Fix-008 | 失败状态持久化          | ✅ saveFailedState + WorkflowError |
| Fix-012 | toolchain 边界          | ✅ README 说明 + tsconfig          |
| Fix-013 | schema 一致性           | ✅ SEVERITY_VALUES + 检查脚本      |
| Fix-014 | context.md 更新         | ✅ 维护规则                        |
| Fix-015 | backlog 结构            | ✅ 优先级和估算                    |

## Phase 4 进度

| 阶段    | 内容                                               | 状态                              |
| ------- | -------------------------------------------------- | --------------------------------- |
| Phase 1 | 类型提取到 workspace-review-types.ts (94 行)       | ✅                                |
| Phase 2 | 配置加载提取到 workspace-review-config.ts (402 行) | ✅                                |
| Phase 3 | manifest 拆分（已是纯库模块，无需拆分）            | ✅ 跳过                           |
| Phase 4 | workspace-review-lib.ts 收敛为兼容入口             | ✅ 已通过 import + re-export 实现 |
| Phase 5 | 目录重组（44 个文件路径变更）                      | ✅ 已完成                         |
| Phase 6 | 职责声明文档                                       | ✅ 已完成                         |

**workspace-review-lib.ts**：1829 → 1419 行（-22%）

## 待完成

当前架构修复计划已完成。剩余 backlog 聚焦 reviewer 失败时的部分重试能力。

## 方案文档索引

- docs/fix-009-scripts-size.md（含 6 阶段渐进式迁移）

## 下一步

1. 评估 reviewer 失败时按角色部分重试的实现范围
2. 进入 reviewer prompt、fact check 覆盖率、synthesis 报告结构化等后续规划

## 阻塞项

（暂无）
