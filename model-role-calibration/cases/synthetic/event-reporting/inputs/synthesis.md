# 需求背景

移动端要在复用 `reportEvent` 的前提下，为支付成功事件增加实时上报。失败不能阻塞支付结果；线上同时存在新旧客户端和两个服务端版本；服务端只对带 `event_id` 的事件去重。第一版不新增平行上报 API，不建设 Kafka、独立数据库或新消息平台。

# Architecture Reviewer

```json
{
  "probe": "architecture",
  "issues": [
    {
      "title": "实时标记字段层级不一致",
      "type": "boundary",
      "severity": "blocker",
      "evidence": "JS 在 payload 中写入 is_realtime，原生桥却从事件对象顶层读取 is_realtime。",
      "why_it_matters": "写入方与读取方使用不同 wire path，实时分支无法按计划触发。",
      "required_contract": "为 is_realtime 定义唯一字段位置和跨层传递责任。",
      "confidence": 0.99
    },
    {
      "title": "实时与批量上报应拆分为两个公开 API",
      "type": "boundary",
      "severity": "high",
      "evidence": "实时和批量上报职责不同。",
      "why_it_matters": "复用同一 API 会使调用语义不清晰。",
      "required_contract": "拆分实时与批量公开 API。",
      "confidence": 0.8
    },
    {
      "title": "同窗口发布形成跨版本耦合",
      "type": "coupling",
      "severity": "high",
      "evidence": "方案要求 JS、原生和服务端在同一个版本窗口一起发布，但线上存在旧客户端和两个服务端版本。",
      "why_it_matters": "没有向前向后兼容顺序时，不同版本组合可能无法独立演进。",
      "required_contract": "补充跨版本兼容行为和分阶段发布顺序。",
      "confidence": 0.95
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
        "boundary": "dependencies",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "检查了 JS、原生和服务端同窗口发布对执行依赖的影响。"
      },
      {
        "boundary": "failure_semantics",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了支付结果页等待遥测上传与失败不得阻塞的硬约束冲突。"
      },
      {
        "boundary": "compatibility_or_release",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "检查了线上新旧客户端和两个服务端版本共存下的发布验收缺口。"
      }
    ],
    "unverified_assumptions": [],
    "not_reviewed": [
      "未检查现有 reportEvent 源码路径或具体桥接实现，因为输入没有 Existing Code Refs。"
    ]
  },
  "issues": [
    {
      "title": "缺少跨层修改清单、发布顺序和兼容矩阵",
      "type": "dependency",
      "severity": "high",
      "evidence": "方案只要求三个团队同窗口发布，没有定义每层接口变化、依赖顺序和新旧版本组合。",
      "why_it_matters": "各团队无法判断先实现或先发布哪一层，也无法验收版本共存。",
      "required_plan_detail": "补充各层契约、发布依赖和跨版本验收组合。",
      "blocks_execution": true,
      "confidence": 0.95
    },
    {
      "title": "支付结果页等待遥测网络请求",
      "type": "ambiguity",
      "severity": "blocker",
      "evidence": "支付成功页执行 await reportEvent，确认上传成功后才展示结果页。",
      "why_it_matters": "支付结果展示依赖遥测请求完成，直接违反上报失败不能阻塞支付成功页的硬约束。",
      "required_plan_detail": "明确支付结果展示与实时上传结果解耦的非阻塞边界。",
      "blocks_execution": true,
      "confidence": 0.99
    },
    {
      "title": "需要 Kafka 和独立事件数据库保证可靠送达",
      "type": "dependency",
      "severity": "blocker",
      "evidence": "实时事件需要可靠送达。",
      "why_it_matters": "没有独立基础设施就无法保证实时事件不丢失。",
      "required_plan_detail": "建设 Kafka 和独立事件数据库。",
      "blocks_execution": true,
      "confidence": 0.75
    }
  ],
  "missing_questions": [],
  "false_positive_risks": []
}
```

# Risk Reviewer

```json
{
  "probe": "risk",
  "issues": [
    {
      "title": "实时重试回落批量队列可能重复上报",
      "type": "data",
      "severity": "high",
      "evidence": "实时上传失败后重试三次，仍失败则进入批量队列；旧客户端没有生成 event_id。",
      "why_it_matters": "实时尝试与批量回落之间缺少稳定标识时，同一事件可能被重复处理。",
      "confidence": 0.95
    },
    {
      "title": "缺少实时模式观测和回滚边界",
      "type": "observability",
      "severity": "high",
      "evidence": "验收只检查开发环境请求立即发出，方案没有实时成功率、延迟、回退次数或关闭实时模式的方式。",
      "why_it_matters": "上线后无法判断实时路径是否有效，也缺少不重新发版的止损边界。",
      "confidence": 0.9
    },
    {
      "title": "is_realtime 放在顶层只是低优先级偏好",
      "type": "preference",
      "severity": "low",
      "evidence": "字段放在 payload 也能工作。",
      "why_it_matters": "顶层位置只影响风格，不影响协议工作。",
      "confidence": 0.7
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
      "issue_id": "Architecture-Reviewer-001",
      "source": "Architecture Reviewer",
      "issue_title": "实时标记字段层级不一致",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划明确写入 payload.is_realtime、从事件顶层读取 is_realtime，字段路径不一致及实时分支无法按约定触发均有直接证据。",
      "checked_files": []
    },
    {
      "issue_id": "Architecture-Reviewer-002",
      "source": "Architecture Reviewer",
      "issue_title": "实时与批量上报应拆分为两个公开 API",
      "status": "unsupported",
      "scope_status": "out_of_scope",
      "evidence_status": "plan_only",
      "claim_support": "none",
      "reason": "需求明确要求继续复用 reportEvent 且不新增平行 API；没有证据证明拆分是满足需求的必要条件。",
      "checked_files": []
    },
    {
      "issue_id": "Architecture-Reviewer-003",
      "source": "Architecture Reviewer",
      "issue_title": "同窗口发布形成跨版本耦合",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "线上存在旧客户端和两个服务端版本，而方案仅要求同窗口发布，没有定义兼容组合和发布顺序。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-001",
      "source": "Execution Reviewer",
      "issue_title": "缺少跨层修改清单、发布顺序和兼容矩阵",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "方案没有给出三个发布单元的接口契约、依赖顺序和新旧版本验收组合。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-002",
      "source": "Execution Reviewer",
      "issue_title": "支付结果页等待遥测网络请求",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "方案明确在展示支付结果前 await reportEvent，直接违反失败不能阻塞支付成功页的硬约束。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-003",
      "source": "Execution Reviewer",
      "issue_title": "需要 Kafka 和独立事件数据库保证可靠送达",
      "status": "unsupported",
      "scope_status": "out_of_scope",
      "evidence_status": "plan_only",
      "claim_support": "none",
      "reason": "需求明确排除新消息平台和数据库，也未要求零丢失或最终必达。",
      "checked_files": []
    },
    {
      "issue_id": "Risk-Reviewer-001",
      "source": "Risk Reviewer",
      "issue_title": "实时重试回落批量队列可能重复上报",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划存在实时重试和批量回落两条发送路径，服务端仅按 event_id 去重且旧客户端没有 event_id，重复风险有直接依据。",
      "checked_files": []
    },
    {
      "issue_id": "Risk-Reviewer-002",
      "source": "Risk Reviewer",
      "issue_title": "缺少实时模式观测和回滚边界",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划只给出开发环境立即发请求的验收，没有生产指标、回退可见性或关闭实时路径的边界。",
      "checked_files": []
    },
    {
      "issue_id": "Risk-Reviewer-003",
      "source": "Risk Reviewer",
      "issue_title": "is_realtime 放在顶层只是低优先级偏好",
      "status": "contradicted",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "contradicted",
      "reason": "当前方案写入 payload、读取顶层，放在 payload 并不能按当前读取契约工作，因此不是单纯风格偏好。",
      "checked_files": []
    }
  ],
  "source_summaries": [
    {
      "source": "Architecture Reviewer",
      "total_issues": 3,
      "verified": 2,
      "partially_verified": 0,
      "unsupported": 1,
      "contradicted": 0,
      "unverifiable": 0
    },
    {
      "source": "Execution Reviewer",
      "total_issues": 3,
      "verified": 2,
      "partially_verified": 0,
      "unsupported": 1,
      "contradicted": 0,
      "unverifiable": 0
    },
    {
      "source": "Risk Reviewer",
      "total_issues": 3,
      "verified": 2,
      "partially_verified": 0,
      "unsupported": 0,
      "contradicted": 1,
      "unverifiable": 0
    }
  ],
  "limits": []
}
```

# 合成任务

逐条使用 Fact Check 中的 `issue_id` 记录来源意见。合并重复问题，按需求直接丢弃超范围意见，识别真正的方向分歧，并给出与 Fact Check 状态一致的修订指令。
