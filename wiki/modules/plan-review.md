# plan-review 模块

## 设计背景

Plan Review 是核心功能，负责接收计划文件并执行多角色评审。

## 入口

- MCP 入口: `scripts/plan-review-mcp.js` — 暴露 `start_plan_review`、`get_plan_review`、`retry_plan_review_stage` 工具
- 执行器: `scripts/run-workspace-review.js` — 实际编排评审流程

## 数据流

```
用户请求
  ↓
plan-review-mcp.js (MCP 层，校验输入)
  ↓
run-workspace-review.js (执行层)
  ├── plan-authoring-lint.js (结构检查，不调模型)
  ├── runReviewers() → [risk, architecture, execution, rebuttal] 并发
  ├── runFactCheck() → 校验 evidence
  └── runSynthesis() → 生成最终报告
  ↓
workspace-runs/<run-id>/
  ├── run-manifest.json (验证主源)
  ├── state.json (运行状态)
  ├── report.json (评审报告)
  └── roles/<role>/ (各角色产物)
```

## 关键设计决策

- **manifest 驱动验证**: 用 manifest 而非 state.json 做验证，因为 manifest 包含 inputs hash
- **分阶段流水线**: reviewers → fact_check → synthesis，每阶段依赖上阶段输出
- **并发评审**: 4 个 reviewer 并发执行，提高效率
