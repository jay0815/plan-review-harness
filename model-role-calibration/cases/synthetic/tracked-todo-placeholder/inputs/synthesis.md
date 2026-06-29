# 需求与计划边界

计划刻意要求代码中保留 TODO 追踪 `SmsType.RFC = 21` 占位，并在 Blocking Decisions 中记录责任人和关闭标准。该事项不阻塞当前编码，但上线前必须关闭。

# Risk Reviewer

```json
{
  "probe": "risk",
  "issues": [
    {
      "title": "TODO 出现在关键约束中",
      "type": "risk",
      "severity": "low",
      "evidence": "计划要求实现时在代码中标注 TODO。",
      "why_it_matters": "TODO 可能让开发者误以为关键约束尚未确定。",
      "confidence": 0.65
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
        "notes": "检查了 SmsType.RFC 占位值和验证码请求主路径。"
      },
      {
        "boundary": "step_order",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了先占位编码、上线前替换的顺序。"
      },
      {
        "boundary": "dependencies",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "后端正式枚举值被列为待确认项。"
      },
      {
        "boundary": "inputs",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了当前占位输入和正式值关闭标准。"
      },
      {
        "boundary": "outputs",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了验证码请求携带枚举值的输出。"
      },
      {
        "boundary": "acceptance",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了占位请求、TODO 可搜索和关闭后移除占位的验收。"
      },
      {
        "boundary": "tests",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了验证码请求枚举值验证。"
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
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "上线前必须替换正式枚举值。"
      },
      {
        "boundary": "implementation_discretion",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "TODO 注释格式和枚举定义位置按项目约定决定。"
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
      "title": "计划应删除 TODO 表述",
      "type": "preference",
      "severity": "low",
      "evidence": "计划写了实现时在代码中标注 TODO。",
      "why_it_matters": "TODO 可能被 linter 报告为不确定措辞。",
      "required_plan_detail": "删除 TODO 文案，改为普通说明。",
      "blocks_execution": false,
      "confidence": 0.7
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
      "title": "删除 TODO 会破坏追踪要求",
      "type": "contradiction",
      "severity": "medium",
      "evidence": "需求明确要求代码中标注 TODO，且计划已在 Blocking Decisions 中写明责任人和关闭标准。",
      "why_it_matters": "删除 TODO 会让 IDE 和静态工具无法追踪该占位值。",
      "required_plan_change": "无需删除 TODO；保留代码 TODO，并确认待确认项仍有责任人和关闭标准。",
      "confidence": 0.95
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
      "issue_title": "TODO 出现在关键约束中",
      "status": "partially_verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "partial",
      "reason": "计划确实要求代码中标注 TODO，但同一事项已在 Blocking Decisions 中跟踪并写明责任人和关闭标准；该 TODO 是刻意追踪机制，不构成需要删除的计划风险。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-001",
      "source": "Execution Reviewer",
      "issue_title": "计划应删除 TODO 表述",
      "status": "partially_verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "partial",
      "reason": "计划确实包含 TODO，但需求明确要求代码 TODO 供 IDE 追踪，且该事项已有关闭标准；删除 TODO 的建议与需求目标冲突。",
      "checked_files": []
    },
    {
      "issue_id": "Rebuttal-Reviewer-001",
      "source": "Rebuttal Reviewer",
      "issue_title": "删除 TODO 会破坏追踪要求",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "需求和计划均明确要求代码 TODO，并在 Blocking Decisions 中提供责任人和关闭标准。",
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
