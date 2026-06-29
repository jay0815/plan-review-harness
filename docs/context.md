# 当前迭代上下文

## 本轮目标

建立跨项目 prompt 评估迭代基础。当前仓库作为 dry-run 原型，长期目标是迁移到 `harness-kit`，供 plan review、change-assurance 和后续 agent workflow 共享。

## 当前状态

- 已完成：架构修复计划已提交；workspace review 可靠性 backlog 已清空
- 进行中：prompt eval foundation 本轮收尾验证
- 总进度：架构修复 13/13 完成

## Prompt Eval 方向

- 核心只拥有通用 schema、评分、runner、文件型 dry-run 和 report 语义。
- 项目通过 adapter 接入模型调用、case discovery、输入读取和输出归一化。
- 当前文件型 dry-run 支持 JSON case discovery、observed output 读取、manifest/results/report 持久化。
- 已补充 `change-assurance` 和 `harness-kit` 的 adapter 分层接入计划。
- baseline 对比只在存在历史结果时计算 regressions/improvements；单纯失败不等于回归。
- 后续迁移到 `harness-kit` 时，不携带当前 plan-review runtime 或 `model-role-calibration/` 的历史结构。

## 已完成的 Fix
收紧 workspace review 评审质量边界：Synthesis 不得把无可执行修订的问题放入 consensus，
Risk/Execution 不得把导航栈自然返回误判为入口来源机制缺口，TODO 占位应作为已跟踪确认项而非删除建议。

## 当前状态

- 已完成：新增 `synthetic/navigation-stack-return` 和 `synthetic/tracked-todo-placeholder` 回归 fixture，未加入 `primary_cases`
- 已完成：`probe-risk.md` / `probe-execution.md` 增加导航栈返回边界，禁止用未声明入口推导风险
- 已完成：`probe-fact_check.md` 增加“缺机制不等于缺计划契约”的证据校验规则
- 已完成：`probe-synthesis.md` / `evaluate-synthesis.md` 增加实质性 `required_plan_change` 和弱事实保留规则
- 已完成：`run-workspace-review.ts` semantic validation 会拒绝空或“无需修订”的 consensus `required_plan_change`
- 已完成：`plan-authoring-lint.ts` 将已跟踪代码 TODO 归类为 `tracked_todo_placeholder` advisory
- 已验证：fixture 校验、calibration runtime、plan-authoring-lint、plan-review MCP semantic validation、calibration typecheck、fmt check 均通过
- 总进度：架构修复 13/13 完成

## 已完成的 Fix（最近 5 条）

| Fix     | 问题            | 状态                               |
| ------- | --------------- | ---------------------------------- |
| Fix-008 | 失败状态持久化  | ✅ saveFailedState + WorkflowError |
| Fix-012 | toolchain 边界  | ✅ README 说明 + tsconfig          |
| Fix-013 | schema 一致性   | ✅ SEVERITY_VALUES + 检查脚本      |
| Fix-014 | context.md 更新 | ✅ 维护规则                        |
| Fix-015 | backlog 结构    | ✅ 优先级和估算                    |

旧 Fix 条目归档到 `docs/backlog.md` 的已完成列表。

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

当前架构修复计划、workspace review 可靠性 backlog 和 prompt eval foundation 待办已完成。后续可以进入 reviewer prompt、fact check 覆盖率和 synthesis 报告结构化等质量提升任务。

## 方案文档索引

- docs/fix-009-scripts-size.md（含 6 阶段渐进式迁移）

## 下一步

1. 进入 reviewer prompt、fact check 覆盖率、synthesis 报告结构化等后续规划
2. 需要新工程任务时，先补充到 `docs/backlog.md` 并标注优先级和估算
3. 需要真实模型校准时，对两个新 synthetic cases 跑定向回归，重点观察 `risk`、`execution`、`fact_check`、`synthesis`
4. 对真实 workspace review run 重试 synthesis 时，确认无实质修订的 finding 不再形成 consensus issue
5. 若 report 层仍把 `tracked_todo_placeholder` 写成删除 TODO 建议，再调整报告汇总文案

## 阻塞项

（暂无）
