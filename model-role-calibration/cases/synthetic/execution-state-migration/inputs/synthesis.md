# 需求与待审计划

移动端笔记应用从 v1 本地草稿表迁移到 v2 自动同步。v1 只有 `draft_id`、`body`、`updated_at`，没有同步状态和服务端 revision。部分用户可能有只在本地存在、从未上传服务端的草稿。v2 计划新增 `is_synced: boolean` 和 `last_sync_error`，用户编辑时设置 `is_synced=false`，网络恢复后上传，成功后设置 `is_synced=true`。v1 迁移时所有旧草稿都设为 `is_synced=true`，不回查服务端，也不触发迁移后首次同步。幂等键每次上传前用 `draft_id + Date.now()` 生成，失败重试时重新生成。

# Risk Reviewer

```json
{
  "probe": "risk",
  "issues": [
    {
      "title": "v1 迁移默认 is_synced=true 可能静默跳过本地未上传草稿",
      "type": "data",
      "severity": "high",
      "evidence": "计划写明 v1 升级到 v2 时，为所有 v1 草稿新增 is_synced=true，不回查服务端，也不触发迁移后的首次同步。",
      "why_it_matters": "v1 没有同步状态和服务端 revision，长期离线用户可能有只在本地存在的草稿；迁移后这些草稿会被同步 worker 排除，造成数据长期不上传或被误认为已同步。",
      "confidence": 0.95
    }
  ],
  "missing_questions": [],
  "false_positive_risks": [
    "不要求第一版实现 CRDT 或实时协同；风险集中在迁移默认值和状态生命周期。"
  ]
}
```

# Architecture Reviewer

```json
{
  "probe": "architecture",
  "issues": [
    {
      "title": "本地同步状态缺少 revision 和生命周期所有权",
      "type": "boundary",
      "severity": "high",
      "evidence": "计划只新增 is_synced 和 last_sync_error；v1 没有保存服务端 revision，服务端记录包含 server_revision，冲突仅写 last_sync_error=conflict。",
      "why_it_matters": "没有 base revision 或 last known server revision，本地层、同步 worker 和服务端之间无法判断本地编辑基于哪个服务端版本，也无法把冲突从普通失败中结构化区分。",
      "required_contract": "定义本地同步状态机、base/server revision 字段所有权、冲突态和失败态的状态转移，以及同步 worker 对这些状态的消费规则。",
      "confidence": 0.9
    }
  ],
  "missing_questions": [],
  "false_positive_risks": [
    "具体字段名和索引实现可留给实现者；需要关闭的是状态和 revision 契约。"
  ]
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
        "notes": "检查了 v1 迁移、用户编辑、网络恢复同步、成功/失败处理和冲突展示的主路径。"
      },
      {
        "boundary": "step_order",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "检查了迁移先标记已同步再启动同步 worker 会让旧草稿跳过核对。"
      },
      {
        "boundary": "dependencies",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "检查了本地 schema、同步 worker、上传接口和服务端 revision 的依赖边界。"
      },
      {
        "boundary": "inputs",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了 is_synced、last_sync_error、server_revision、幂等键和 v1 草稿初始状态等输入权威。"
      },
      {
        "boundary": "outputs",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "检查了同步成功、失败、冲突和迁移后的本地状态输出。"
      },
      {
        "boundary": "acceptance",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "检查了验收是否覆盖 v1 迁移、冲突、失败恢复和部分成功。"
      },
      {
        "boundary": "tests",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "检查了测试是否覆盖旧草稿迁移、重试幂等和冲突状态。"
      },
      {
        "boundary": "failure_semantics",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了上传失败、冲突、幂等重试和本地编辑保留语义。"
      },
      {
        "boundary": "rollback_or_recovery",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了迁移后恢复、失败重跑和长期离线草稿重新纳入同步的边界。"
      },
      {
        "boundary": "compatibility_or_release",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "检查了 v1 本地数据升级到 v2 的兼容行为；没有触发服务端多版本发布矩阵。"
      },
      {
        "boundary": "implementation_discretion",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了字段命名、索引、UI 文案和网络监听实现可留给实现者。"
      },
      {
        "boundary": "plan_bloat",
        "status": "not_applicable",
        "evidence_basis": "plan_text",
        "notes": "输入没有未来代码块或实现细节淹没关键决策。"
      }
    ],
    "unverified_assumptions": [],
    "not_reviewed": [
      "未检查真实数据库 schema 或服务端接口实现，因为输入没有 Existing Code Refs。"
    ]
  },
  "issues": [
    {
      "title": "is_synced 布尔状态无法表达迁移未知态、冲突态和同步中状态",
      "type": "ambiguity",
      "severity": "blocker",
      "evidence": "计划只新增 is_synced:boolean 和 last_sync_error；冲突仅写 last_sync_error=conflict。",
      "why_it_matters": "实现者无法仅凭 boolean 判断草稿是已确认服务端存在、等待上传、正在上传、上传失败、发生冲突，还是 v1 迁移后尚未核对；同步 worker 和 UI 会把不同生命周期混在一起处理。",
      "required_plan_detail": "定义最小同步状态机，例如 pending_upload、syncing、synced、failed、conflict、migrated_unknown，并说明每个状态的进入条件、退出条件和同步 worker 消费规则。",
      "blocks_execution": true,
      "confidence": 0.95
    },
    {
      "title": "v1 迁移把所有旧草稿标记为 is_synced=true 会跳过必要核对",
      "type": "step",
      "severity": "blocker",
      "evidence": "计划写明 v1 升级到 v2 时，为所有 v1 草稿新增 is_synced=true，不回查服务端，也不触发迁移后的首次同步。",
      "why_it_matters": "v1 没有同步状态和 server_revision，不能证明旧草稿已经存在于服务端；迁移后设置 true 会让同步 worker 永远不上传或核对这些记录。",
      "required_plan_detail": "关闭 v1 迁移策略：旧草稿应进入 migrated_unknown 或 pending_reconcile 等状态，定义是否上传、回查、用户确认或按本地优先进入首次同步，并说明失败恢复。",
      "blocks_execution": true,
      "confidence": 0.95
    },
    {
      "title": "缺少 base revision 使冲突检测不可执行",
      "type": "input",
      "severity": "high",
      "evidence": "服务端记录包含 server_revision，但计划没有保存本地草稿基于哪个 server_revision；只在服务端返回冲突时写 last_sync_error=conflict。",
      "why_it_matters": "没有 base revision，客户端无法构造可判定的提交契约，也无法在冲突后向用户展示本地版本和服务端版本的关系。",
      "required_plan_detail": "补充本地保存 last_known_server_revision/base_revision 的规则、上传请求如何携带该值，以及冲突响应后如何进入 conflict 状态。",
      "blocks_execution": true,
      "confidence": 0.9
    },
    {
      "title": "幂等键每次重试重新生成会破坏失败恢复",
      "type": "input",
      "severity": "high",
      "evidence": "计划写明每次上传前用 draft_id + Date.now() 生成幂等键，上传失败重试时重新生成幂等键。",
      "why_it_matters": "同一次本地编辑的重试如果使用不同幂等键，服务端无法识别重复提交，网络超时或部分成功时可能产生重复 revision。",
      "required_plan_detail": "定义稳定操作 id 或提交 id，并规定同一逻辑编辑在所有重试中复用同一幂等键，只有用户产生新编辑时才生成新键。",
      "blocks_execution": true,
      "confidence": 0.9
    },
    {
      "title": "验收没有覆盖 v1 迁移和冲突恢复",
      "type": "acceptance",
      "severity": "medium",
      "evidence": "验收只包含新建离线草稿联网后服务端可见、上传错误保留本地、再次联网重试、v1 草稿仍显示。",
      "why_it_matters": "当前验收无法证明迁移旧草稿不会被跳过，也无法证明两设备编辑同一草稿时冲突进入用户处理流程。",
      "required_plan_detail": "补充 v1 本地-only 草稿升级后进入待核对/待上传、冲突响应进入 conflict 状态、失败重试复用幂等键、用户继续离线编辑不丢失的可判定验收。",
      "blocks_execution": false,
      "confidence": 0.85
    }
  ],
  "missing_questions": [],
  "false_positive_risks": [
    "不要求第一版实现 CRDT、实时协同或字段级自动合并。",
    "具体枚举字段名、数据库索引和冲突 UI 布局属于实现自由。"
  ]
}
```

# Rebuttal Reviewer

```json
{
  "probe": "rebuttal",
  "issues": [
    {
      "title": "迁移默认值不是实现细节，计划已经选择了会改变同步生命周期的语义",
      "type": "contradiction",
      "severity": "high",
      "evidence": "计划明确将所有 v1 草稿设置为 is_synced=true，并说明不回查服务端、不触发迁移后首次同步。",
      "why_it_matters": "这不是命名或代码实现自由，而是决定旧数据是否会进入同步流程的执行契约；把它降为 missing question 会让实现者按错误默认值编码。",
      "required_plan_change": "计划必须把 v1 草稿迁移到可核对或待同步状态，并定义该状态如何被同步 worker 消费。",
      "confidence": 0.9
    }
  ],
  "missing_questions": [],
  "false_positive_risks": [
    "不需要把冲突 UI 的具体组件写成计划前置条件。"
  ]
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
      "issue_title": "v1 迁移默认 is_synced=true 可能静默跳过本地未上传草稿",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划明确 v1 没有同步状态和服务端 revision，又明确迁移时所有 v1 草稿设为 is_synced=true 且不回查服务端、不触发首次同步；跳过本地未上传草稿的风险由计划直接支持。",
      "checked_files": []
    },
    {
      "issue_id": "Architecture-Reviewer-001",
      "source": "Architecture Reviewer",
      "issue_title": "本地同步状态缺少 revision 和生命周期所有权",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划只新增 is_synced 和 last_sync_error，服务端包含 server_revision，但计划没有定义本地保存 base/server revision 的所有权或状态转移。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-001",
      "source": "Execution Reviewer",
      "issue_title": "is_synced 布尔状态无法表达迁移未知态、冲突态和同步中状态",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划确实只新增 is_synced:boolean 和 last_sync_error；同时需求包含迁移、失败、冲突和继续离线编辑，boolean 无法区分这些生命周期。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-002",
      "source": "Execution Reviewer",
      "issue_title": "v1 迁移把所有旧草稿标记为 is_synced=true 会跳过必要核对",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划明确迁移时设置 is_synced=true、不回查服务端、不触发首次同步；v1 又没有同步状态和 revision，因此不能证明这些草稿已同步。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-003",
      "source": "Execution Reviewer",
      "issue_title": "缺少 base revision 使冲突检测不可执行",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "需求提供 server_revision，计划没有定义本地保存或上传 base revision，只说服务端返回冲突后记录 last_sync_error=conflict。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-004",
      "source": "Execution Reviewer",
      "issue_title": "幂等键每次重试重新生成会破坏失败恢复",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划明确每次上传前用 draft_id + Date.now() 生成幂等键，失败重试时重新生成；这与同一逻辑提交重试应复用幂等键的执行语义冲突。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-005",
      "source": "Execution Reviewer",
      "issue_title": "验收没有覆盖 v1 迁移和冲突恢复",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划列出的验收只覆盖新建离线草稿、上传错误保留本地、再次联网重试和 v1 草稿仍显示，没有覆盖迁移旧草稿是否同步、冲突状态或 base revision。",
      "checked_files": []
    },
    {
      "issue_id": "Rebuttal-Reviewer-001",
      "source": "Rebuttal Reviewer",
      "issue_title": "迁移默认值不是实现细节，计划已经选择了会改变同步生命周期的语义",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划已经明确了迁移默认 is_synced=true 及不回查/不触发同步，这会直接决定旧数据是否被同步 worker 消费，因此不是实现细节。",
      "checked_files": []
    }
  ],
  "source_summaries": [
    {
      "source": "Risk Reviewer",
      "total_issues": 1,
      "verified": 1,
      "partially_verified": 0,
      "unsupported": 0,
      "contradicted": 0,
      "unverifiable": 0
    },
    {
      "source": "Architecture Reviewer",
      "total_issues": 1,
      "verified": 1,
      "partially_verified": 0,
      "unsupported": 0,
      "contradicted": 0,
      "unverifiable": 0
    },
    {
      "source": "Execution Reviewer",
      "total_issues": 5,
      "verified": 5,
      "partially_verified": 0,
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
