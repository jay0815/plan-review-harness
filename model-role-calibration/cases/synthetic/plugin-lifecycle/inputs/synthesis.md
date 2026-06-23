# 需求背景

本地 CLI 管理插件文本资产，支持 user/project scope、dry-run、幂等更新和安全卸载。用户可能修改文件，目标目录也可能存在其他来源资产。CLI 只能管理能确认归属的资产；第一版不建设在线 marketplace、后台服务、灰度平台或远程 kill switch。

# Architecture Reviewer

```json
{
  "probe": "architecture",
  "issues": [
    {
      "title": "插件安装职责必须交给在线 marketplace",
      "type": "boundary",
      "severity": "blocker",
      "evidence": "安装和分发适合由 marketplace 管理。",
      "why_it_matters": "本地 CLI 不应承担插件安装职责。",
      "required_contract": "建设在线 marketplace 并移除 CLI 安装职责。",
      "confidence": 0.8
    },
    {
      "title": "整目录删除破坏资产所有权边界",
      "type": "ownership",
      "severity": "blocker",
      "evidence": "update 和 uninstall 都会删除整个目标目录，而目录中可能有其他工具或用户文件。",
      "why_it_matters": "CLI 会删除无法确认归属的资产。",
      "required_contract": "记录并只管理 CLI 自己安装的逐文件资产。",
      "confidence": 0.99
    },
    {
      "title": "user 和 project scope 应共享路径解析与生命周期逻辑",
      "type": "maintainability",
      "severity": "medium",
      "evidence": "两个 scope 执行相同生命周期命令，仅目标根目录不同。",
      "why_it_matters": "分叉实现会使所有权和恢复语义长期不一致。",
      "required_contract": "定义统一 scope 解析和生命周期状态机。",
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
      "title": "缺少 manifest 与文件 hash 契约",
      "type": "input",
      "severity": "blocker",
      "evidence": "方案只复制和删除目录，status 只检查目录存在，没有记录版本、受管文件或安装时 hash。",
      "why_it_matters": "无法判断文件归属、用户修改、版本状态或安全卸载范围。",
      "required_plan_detail": "定义 manifest 的受管文件、版本、hash 和提交时机。",
      "blocks_execution": true,
      "confidence": 0.98
    },
    {
      "title": "dry-run 不能预览逐文件变化",
      "type": "output",
      "severity": "high",
      "evidence": "dry-run 只打印一句将执行安装、更新或卸载。",
      "why_it_matters": "用户无法在破坏性操作前确认哪些文件会新增、覆盖、保留或删除。",
      "required_plan_detail": "定义逐文件动作和原因的预览输出。",
      "blocks_execution": true,
      "confidence": 0.95
    },
    {
      "title": "失败后重跑不能恢复部分写入",
      "type": "step",
      "severity": "blocker",
      "evidence": "失败时只打印错误退出，并假设用户重跑即可恢复。",
      "why_it_matters": "复制或删除中途失败会留下新旧资产混合状态。",
      "required_plan_detail": "定义临时写入、提交点和失败恢复边界。",
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
      "title": "覆盖和整目录删除会破坏用户及其他来源文件",
      "type": "data",
      "severity": "blocker",
      "evidence": "install 直接覆盖，update 和 uninstall 删除整个目标目录；用户可能修改文件且目录中可能有其他来源文件。",
      "why_it_matters": "会造成无法恢复的用户修改丢失和越权删除。",
      "confidence": 0.99
    },
    {
      "title": "必须建设灰度发布平台和远程 kill switch",
      "type": "rollback",
      "severity": "high",
      "evidence": "插件更新可能发生事故。",
      "why_it_matters": "没有线上止损平台无法控制更新风险。",
      "confidence": 0.75
    },
    {
      "title": "验收只覆盖空目录 happy path",
      "type": "risk",
      "severity": "high",
      "evidence": "验收只在空目录依次执行 install、update、uninstall 并检查退出码。",
      "why_it_matters": "没有验证重复执行、部分失败、用户修改、scope 隔离和未知文件保留。",
      "confidence": 0.96
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
      "issue_title": "插件安装职责必须交给在线 marketplace",
      "status": "unsupported",
      "scope_status": "out_of_scope",
      "evidence_status": "plan_only",
      "claim_support": "none",
      "reason": "需求明确要求本地 CLI 安装 bundled 文本资产，并明确第一版不建设在线 marketplace。",
      "checked_files": []
    },
    {
      "issue_id": "Architecture-Reviewer-002",
      "source": "Architecture Reviewer",
      "issue_title": "整目录删除破坏资产所有权边界",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "目标目录可能包含其他来源文件，而方案删除整个目录，直接违反只能管理已确认归属资产的约束。",
      "checked_files": []
    },
    {
      "issue_id": "Architecture-Reviewer-003",
      "source": "Architecture Reviewer",
      "issue_title": "user 和 project scope 应共享路径解析与生命周期逻辑",
      "status": "partially_verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "partial",
      "reason": "两个 scope 确实需要一致的生命周期语义，但输入没有证明必须采用同一内部实现或抽象。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-001",
      "source": "Execution Reviewer",
      "issue_title": "缺少 manifest 与文件 hash 契约",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "方案没有任何逐文件归属、版本或 hash 记录，无法实现安全更新、状态检查和卸载。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-002",
      "source": "Execution Reviewer",
      "issue_title": "dry-run 不能预览逐文件变化",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "dry-run 只输出命令级提示，没有列出文件动作，无法承担破坏性操作前的预检职责。",
      "checked_files": []
    },
    {
      "issue_id": "Execution-Reviewer-003",
      "source": "Execution Reviewer",
      "issue_title": "失败后重跑不能恢复部分写入",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "方案没有临时状态、提交点或回滚边界，单纯重跑不能证明部分复制和删除状态可恢复。",
      "checked_files": []
    },
    {
      "issue_id": "Risk-Reviewer-001",
      "source": "Risk Reviewer",
      "issue_title": "覆盖和整目录删除会破坏用户及其他来源文件",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "输入明确存在用户修改和其他来源文件，方案却无条件覆盖并删除整个目录。",
      "checked_files": []
    },
    {
      "issue_id": "Risk-Reviewer-002",
      "source": "Risk Reviewer",
      "issue_title": "必须建设灰度发布平台和远程 kill switch",
      "status": "unsupported",
      "scope_status": "out_of_scope",
      "evidence_status": "plan_only",
      "claim_support": "none",
      "reason": "需求明确排除后台服务和自动更新守护进程，本地文本资产生命周期不需要线上灰度平台才能满足恢复要求。",
      "checked_files": []
    },
    {
      "issue_id": "Risk-Reviewer-003",
      "source": "Risk Reviewer",
      "issue_title": "验收只覆盖空目录 happy path",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "验收只验证空目录和退出码，没有覆盖需求明确暴露的重复执行、失败恢复、用户修改、未知文件和 scope 隔离。",
      "checked_files": []
    }
  ],
  "source_summaries": [
    {
      "source": "Architecture Reviewer",
      "total_issues": 3,
      "verified": 1,
      "partially_verified": 1,
      "unsupported": 1,
      "contradicted": 0,
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
      "total_issues": 3,
      "verified": 2,
      "partially_verified": 0,
      "unsupported": 1,
      "contradicted": 0,
      "unverifiable": 0
    }
  ],
  "limits": []
}
```

# 合成任务

逐条使用 Fact Check 中的 `issue_id` 记录来源意见。合并所有权、manifest、恢复、dry-run 和验收问题，按需求丢弃 marketplace、灰度平台等超范围意见，并给出与 Fact Check 状态一致的最小修订指令。
