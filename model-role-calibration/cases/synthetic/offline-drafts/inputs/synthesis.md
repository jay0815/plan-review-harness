# 需求背景

移动端离线草稿支持多设备编辑。服务端有 revision 和幂等提交能力；本地升级到 v2。同步失败不能丢失本地编辑，用户必须能继续离线编辑。第一版不做实时协同或字段级自动合并，无法自动解决的冲突必须交给用户处理。

# Architecture Reviewer

```json
{
  "probe": "architecture",
  "issues": [
    {
      "title": "synced 布尔状态无法表达同步生命周期",
      "type": "ownership",
      "severity": "high",
      "evidence": "本地只新增 synced 布尔值，没有记录 dirty、syncing、conflict、failed 或基准 revision。",
      "why_it_matters": "客户端无法区分待同步、进行中、失败和冲突，也无法判断远端 revision 是否基于当前编辑。",
      "required_contract": "定义本地同步状态、基准 revision 和状态转换责任。",
      "confidence": 0.98
    },
    {
      "title": "last-write-wins 应作为唯一冲突策略",
      "type": "preference",
      "severity": "high",
      "evidence": "服务端始终接受最后到达的正文并递增 revision。",
      "why_it_matters": "last-write-wins 最简单，不需要用户介入。",
      "required_contract": "确认服务端最后写入覆盖为唯一冲突策略。",
      "confidence": 0.85
    },
    {
      "title": "本地草稿应始终是绝对 source of truth",
      "type": "ownership",
      "severity": "high",
      "evidence": "同步失败不能丢失本地编辑。",
      "why_it_matters": "服务端不应拒绝任何客户端上传。",
      "required_contract": "规定本地正文始终覆盖服务端正文。",
      "confidence": 0.8
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
  "issues": [
    {
      "title": "v1 到 v2 迁移会把未上传草稿标记为已同步",
      "type": "step",
      "severity": "blocker",
      "evidence": "迁移时为所有现有草稿设置 synced=true。",
      "why_it_matters": "旧本地内容可能永远不再进入同步集合。",
      "required_plan_detail": "定义保守迁移语义和迁移失败后的可恢复状态。",
      "blocks_execution": true,
      "confidence": 0.98
    },
    {
      "title": "每次重试生成新幂等键破坏幂等语义",
      "type": "ambiguity",
      "severity": "high",
      "evidence": "幂等键使用当前时间戳生成，每次重试重新生成。",
      "why_it_matters": "同一逻辑同步操作会被服务端视为多个请求。",
      "required_plan_detail": "明确同一同步操作在重试和恢复期间使用稳定标识。",
      "blocks_execution": true,
      "confidence": 0.99
    },
    {
      "title": "批量部分成功后统一保持未同步会重复提交",
      "type": "output",
      "severity": "high",
      "evidence": "已经成功的记录本地仍统一保持 synced=false，下次全部重试。",
      "why_it_matters": "客户端无法保存逐条结果，已成功记录会再次提交。",
      "required_plan_detail": "定义逐条同步结果及本地状态提交边界。",
      "blocks_execution": true,
      "confidence": 0.98
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
      "title": "缺少 revision 冲突检测导致多设备静默覆盖",
      "type": "data",
      "severity": "blocker",
      "evidence": "一个用户可能在两台设备编辑同一草稿，但服务端始终接受最后到达的正文。",
      "why_it_matters": "较晚到达的旧基线编辑会覆盖另一设备已经提交的内容，且用户不会看到冲突。",
      "confidence": 0.99
    },
    {
      "title": "第一版必须实现 CRDT",
      "type": "risk",
      "severity": "blocker",
      "evidence": "存在多设备并发编辑。",
      "why_it_matters": "只有 CRDT 才能从根本上解决并发编辑。",
      "confidence": 0.8
    },
    {
      "title": "冲突时需要保留本地、远端和基准版本供用户处理",
      "type": "data",
      "severity": "high",
      "evidence": "需求要求无法自动解决的冲突交给用户处理，且服务端提供 revision。",
      "why_it_matters": "没有冲突双方和基准信息，用户无法判断保留哪一份内容。",
      "confidence": 0.95
    },
    {
      "title": "缺少迁移恢复、退避和同步可观测性",
      "type": "observability",
      "severity": "high",
      "evidence": "方案只描述迁移初始值和失败后重新同步，没有迁移失败恢复、重试节制或同步状态可见性。",
      "why_it_matters": "部分迁移或持续失败时可能无法定位和恢复。",
      "confidence": 0.85
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
      "issue_title": "synced 布尔状态无法表达同步生命周期",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "方案只有 synced 布尔值且没有基准 revision，无法表示计划中已经出现的进行中、失败、重试和冲突状态。",
      "checked_files": []
    },
    {
      "issue_id": "Architecture-Reviewer-002",
      "source": "Architecture Reviewer",
      "issue_title": "last-write-wins 应作为唯一冲突策略",
      "status": "contradicted",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "contradicted",
      "reason": "需求明确要求无法自动解决的冲突交给用户处理，静默 last-write-wins 不能满足该约束。",
      "checked_files": []
    },
    {
      "issue_id": "Architecture-Reviewer-003",
      "source": "Architecture Reviewer",
      "issue_title": "本地草稿应始终是绝对 source of truth",
      "status": "contradicted",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "contradicted",
      "reason": "保留本地编辑不等于本地可以无条件覆盖服务端；多设备和用户冲突处理要求排除了单方绝对权威。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-001",
      "source": "Execution Reviewer",
      "issue_title": "v1 到 v2 迁移会把未上传草稿标记为已同步",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "迁移把所有旧草稿标记为 synced=true，而同步只选择 synced=false，旧内容可能不再上传。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-002",
      "source": "Execution Reviewer",
      "issue_title": "每次重试生成新幂等键破坏幂等语义",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "同一同步操作每次重试使用新的时间戳键，服务端无法把重试识别为同一幂等操作。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-003",
      "source": "Execution Reviewer",
      "issue_title": "批量部分成功后统一保持未同步会重复提交",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "方案明确把已成功记录也保留为 synced=false，并在下次全部重试。",
      "checked_files": []
    },
    {
      "issue_id": "Risk-Reviewer-001",
      "source": "Risk Reviewer",
      "issue_title": "缺少 revision 冲突检测导致多设备静默覆盖",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "输入明确存在多设备编辑和服务端 revision，方案却始终接受最后到达正文且没有基于 revision 的冲突判断。",
      "checked_files": []
    },
    {
      "issue_id": "Risk-Reviewer-002",
      "source": "Risk Reviewer",
      "issue_title": "第一版必须实现 CRDT",
      "status": "unsupported",
      "scope_status": "out_of_scope",
      "evidence_status": "plan_only",
      "claim_support": "none",
      "reason": "需求明确第一版不做实时协同或字段级自动合并，CRDT 不是把冲突交给用户处理的必要条件。",
      "checked_files": []
    },
    {
      "issue_id": "Risk-Reviewer-003",
      "source": "Risk Reviewer",
      "issue_title": "冲突时需要保留本地、远端和基准版本供用户处理",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "需求要求无法自动解决的冲突交给用户，服务端 revision 和两份正文是完成该判断所需的直接契约信息。",
      "checked_files": []
    },
    {
      "issue_id": "Risk-Reviewer-004",
      "source": "Risk Reviewer",
      "issue_title": "缺少迁移恢复、退避和同步可观测性",
      "status": "partially_verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "partial",
      "reason": "迁移失败恢复和同步状态可见性确实缺失；输入没有直接要求具体退避策略，因此该子结论只得到部分支持。",
      "checked_files": []
    }
  ],
  "source_summaries": [
    {
      "source": "Architecture Reviewer",
      "total_issues": 3,
      "verified": 1,
      "partially_verified": 0,
      "unsupported": 0,
      "contradicted": 2,
      "unverifiable": 0
    },
    {
      "source": "Execution Reviewer",
      "total_issues": 3,
      "verified": 3,
      "partially_verified": 0,
      "unsupported": 0,
      "contradicted": 0,
      "unverifiable": 0
    },
    {
      "source": "Risk Reviewer",
      "total_issues": 4,
      "verified": 2,
      "partially_verified": 1,
      "unsupported": 1,
      "contradicted": 0,
      "unverifiable": 0
    }
  ],
  "limits": []
}
```

# 合成任务

逐条使用 Fact Check 中的 `issue_id` 记录来源意见。合并 revision/状态问题和幂等/部分成功问题，丢弃 CRDT 等超范围意见，保留真正需要用户裁决的冲突处理方向，并给出与 Fact Check 状态一致的修订指令。
