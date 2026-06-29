# 需求与计划边界

计划已经用 `replace`、`push` 和统一 `goBack()` 定义返回栈效果。授权页内部没有按入口来源执行不同业务逻辑，输入也没有声明 deeplink、通知或中间页入口。

# Risk Reviewer

```json
{
  "probe": "risk",
  "issues": [
    {
      "title": "授权页缺少入口来源区分机制",
      "type": "risk",
      "severity": "medium",
      "evidence": "计划写了 OCR 入口和首页入口的返回效果不同，但没有 source 或 entry route param。",
      "why_it_matters": "如果授权页不知道入口来源，返回键可能无法选择正确行为。",
      "confidence": 0.78
    }
  ],
  "missing_questions": [],
  "false_positive_risks": []
}
```

# Execution Reviewer

```json
{
  "probe": "execution",
  "coverage_declaration": {
    "reviewed_boundaries": [
      {
        "boundary": "main_path",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了 OCR replace、首页 push 和授权页统一返回动作。"
      },
      {
        "boundary": "step_order",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "导航入口和返回动作的实施顺序没有倒置。"
      },
      {
        "boundary": "dependencies",
        "status": "not_applicable",
        "evidence_basis": "plan_text",
        "notes": "输入没有触发跨团队或服务端依赖。"
      },
      {
        "boundary": "inputs",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "检查了是否需要入口来源参数。"
      },
      {
        "boundary": "outputs",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了两条入口的返回效果。"
      },
      {
        "boundary": "acceptance",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "验收覆盖 OCR 返回不回成功页和首页入口返回首页。"
      },
      {
        "boundary": "tests",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "计划要求覆盖 replace 与 push 导航行为。"
      },
      {
        "boundary": "failure_semantics",
        "status": "not_applicable",
        "evidence_basis": "plan_text",
        "notes": "输入没有触发失败、重试或降级语义。"
      },
      {
        "boundary": "rollback_or_recovery",
        "status": "not_applicable",
        "evidence_basis": "plan_text",
        "notes": "输入没有触发迁移、回滚或恢复边界。"
      },
      {
        "boundary": "compatibility_or_release",
        "status": "not_applicable",
        "evidence_basis": "plan_text",
        "notes": "输入没有触发新旧版本兼容或发布顺序。"
      },
      {
        "boundary": "implementation_discretion",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "导航 helper 名称和绑定位置属于实现自由。"
      },
      {
        "boundary": "plan_bloat",
        "status": "not_applicable",
        "evidence_basis": "plan_text",
        "notes": "计划没有用未来代码淹没关键决策。"
      }
    ],
    "unverified_assumptions": [],
    "not_reviewed": []
  },
  "issues": [
    {
      "title": "授权页返回键入口来源机制未明确",
      "type": "input",
      "severity": "medium",
      "evidence": "计划没有说明授权页如何通过 source、entry 或 route param 区分 OCR 与首页入口。",
      "why_it_matters": "实现者无法确定返回键应按哪个入口执行。",
      "required_plan_detail": "补充授权页入口来源字段或等价机制。",
      "blocks_execution": true,
      "confidence": 0.82
    }
  ],
  "missing_questions": [],
  "false_positive_risks": []
}
```

# Rebuttal Reviewer

```json
{
  "probe": "rebuttal",
  "issues": [
    {
      "title": "入口来源机制被误判为计划缺口",
      "type": "contradiction",
      "severity": "medium",
      "evidence": "计划已明确 OCR 使用 replace、首页使用 push、授权页统一 goBack，返回效果由导航栈自然决定。",
      "why_it_matters": "要求新增 source 或 entry param 会把不存在的页面内业务分支引入计划。",
      "required_plan_change": "无需修改计划；保留导航栈语义和统一返回动作。",
      "confidence": 0.94
    }
  ],
  "missing_questions": [],
  "false_positive_risks": []
}
```

# Fact Check

```json
{
  "probe": "fact_check",
  "checked_issues": [
    {
      "issue_id": "Risk-Reviewer-001",
      "source": "Risk Reviewer",
      "issue_title": "授权页缺少入口来源区分机制",
      "status": "partially_verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "partial",
      "reason": "计划确实没有 source 或 entry route param，但计划已声明 OCR replace、首页 push 和授权页统一 goBack；返回效果可由导航栈自然产生，Reviewer 声称必须区分入口来源的直接后果不成立。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-001",
      "source": "Execution Reviewer",
      "issue_title": "授权页返回键入口来源机制未明确",
      "status": "partially_verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "partial",
      "reason": "计划没有入口来源字段这一弱事实成立，但授权页没有入口相关业务分支，且返回动作由 replace/push 栈结构决定；缺少字段不构成计划执行缺口。",
      "checked_files": []
    },
    {
      "issue_id": "Rebuttal-Reviewer-001",
      "source": "Rebuttal Reviewer",
      "issue_title": "入口来源机制被误判为计划缺口",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划文本直接支持 replace、push 和统一 goBack 的导航栈语义，且没有要求授权页内部按入口来源分支。",
      "checked_files": []
    }
  ],
  "source_summaries": [
    {
      "source": "Risk Reviewer",
      "total_issues": 1,
      "verified": 0,
      "partially_verified": 1,
      "unsupported": 0,
      "contradicted": 0,
      "unverifiable": 0
    },
    {
      "source": "Execution Reviewer",
      "total_issues": 1,
      "verified": 0,
      "partially_verified": 1,
      "unsupported": 0,
      "contradicted": 0,
      "unverifiable": 0
    },
    {
      "source": "Rebuttal Reviewer",
      "total_issues": 1,
      "verified": 1,
      "partially_verified": 0,
      "unsupported": 0,
      "contradicted": 0,
      "unverifiable": 0
    }
  ],
  "limits": []
}
```
