# 整体架构

## 设计目标

plan-review-harness 是一个 Plan 评审系统，通过多角色 AI 评审来验证计划的完整性、风险和可行性。

## 核心设计决策

### 多角色评审

使用多个独立 reviewer（risk、architecture、execution、rebuttal）从不同角度评审计划，避免单一视角的盲区。

### 分阶段执行

reviewers → fact_check → synthesis 三阶段流水线：

- reviewers 并发执行，各自独立输出
- fact_check 校验 evidence 的有效性
- synthesis 综合所有输入，生成最终报告

### Manifest 驱动验证

用 `run-manifest.json` 而非 `state.json` 作为验证主源：

- manifest 包含 inputs hash，能检测计划变更
- state.json 只记录运行状态，无法追溯输入变化

### Workspace Run 隔离

每次评审的产物独立存放在 `workspace-runs/<run-id>/`，互不干扰，支持重试和回溯。

## 模块关系

```
plan-review-mcp.js          # MCP 入口，接收请求
    ↓
run-workspace-review.js     # 执行器，编排评审流程
    ↓
workspace-review-manifest.js # manifest 读写
verify-workspace-review-run.js # 验证 run 完整性
inspect-workspace-run.js     # 检查 run 详情
doctor-workspace-review-run.js # 诊断问题
```
