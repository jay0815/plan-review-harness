# 需求与计划边界

`normalizeName` 的输入契约扩展为 `string | null | undefined`，空值返回空字符串，非空字符串保持 trim。计划明确把测试文件路径、目录、命名和 helper 写法放入 `Implementation Discretion`，由实现者按现有项目惯例决定。该选择不改变业务语义、公共接口、失败语义或验收标准。

计划已经给出：

- 唯一生产代码接入点：`src/referenced.ts:1-3` 的 `normalizeName`。
- 输入、输出和空值行为。
- 实施顺序。
- 空值、普通字符串和前后空格字符串的可判定验收结果。
- 若不存在对应测试文件，则按现有项目惯例新建。

# Risk Reviewer

```json
{
  "probe": "risk",
  "issues": [],
  "missing_questions": [],
  "false_positive_risks": [
    "测试文件路径属于局部工程组织，不改变本次输入输出契约或失败语义。"
  ]
}
```

# Architecture Reviewer

```json
{
  "probe": "architecture",
  "issues": [],
  "missing_questions": [],
  "false_positive_risks": [
    "要求计划预先指定唯一测试文件名会把项目惯例错误升级为架构决策。"
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
        "boundary": "implementation_discretion",
        "status": "covered",
        "evidence_basis": "plan_text",
        "notes": "检查了测试文件路径、目录、命名和 helper 是否已被计划声明为实现自由。"
      },
      {
        "boundary": "tests",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "检查了测试场景和验收结果是否足以开始实现。"
      },
      {
        "boundary": "inputs",
        "status": "partially_covered",
        "evidence_basis": "plan_text",
        "notes": "检查了测试文件位置是否属于必须由计划给定的输入。"
      }
    ],
    "unverified_assumptions": [
      "未验证仓库中是否已有 normalizeName 测试文件。"
    ],
    "not_reviewed": [
      "未检查现有测试目录结构，因为输入没有 Existing Code Refs 之外的可读工程证据。"
    ]
  },
  "issues": [
    {
      "title": "缺少测试文件位置或新增测试的约定",
      "type": "input",
      "severity": "medium",
      "evidence": "计划没有给出具体测试文件路径，只写按现有项目测试惯例增加行为测试。",
      "why_it_matters": "实现者可能创建位置不符合项目惯例的测试文件。",
      "required_plan_detail": "补充唯一测试文件路径和命名规则。",
      "blocks_execution": false,
      "confidence": 0.8
    }
  ],
  "missing_questions": [
    "当前仓库中是否存在 normalizeName 的现有测试文件？"
  ],
  "false_positive_risks": [
    "未指定测试文件路径通常属于项目惯例，不影响函数实现、测试场景或验收启动。"
  ]
}
```

# Rebuttal Reviewer

```json
{
  "probe": "rebuttal",
  "issues": [
    {
      "title": "Execution 将实现自由误判为计划缺口",
      "type": "contradiction",
      "severity": "medium",
      "evidence": "Implementation Discretion 已明确测试路径和命名按项目惯例决定，并说明不存在对应测试文件时按惯例新建。",
      "why_it_matters": "要求补充唯一测试路径不会关闭任何业务、架构或公共契约决策，只会把计划扩写为局部文件组织说明。",
      "required_plan_change": "无需修改计划；测试文件位置保留为实现自由。",
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
      "issue_id": "Execution-Reviewer-001",
      "source": "Execution Reviewer",
      "issue_title": "缺少测试文件位置或新增测试的约定",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划确实没有指定唯一测试文件路径；但计划明确将测试路径、目录和命名交给实现者按现有项目惯例决定，且测试场景与验收结果已经确定。缺少唯一路径会阻塞执行或需要修订计划的后果没有证据支持。",
      "checked_files": []
    },
    {
      "issue_id": "Rebuttal-Reviewer-001",
      "source": "Rebuttal Reviewer",
      "issue_title": "Execution 将实现自由误判为计划缺口",
      "status": "verified",
      "scope_status": "in_scope",
      "evidence_status": "plan_only",
      "claim_support": "direct",
      "reason": "计划明确把测试文件路径、目录和命名列为 Implementation Discretion，且 Execution 自己标记 blocks_execution=false；该意见准确指出这不构成计划缺口。",
      "checked_files": []
    }
  ],
  "source_summaries": [
    {
      "source": "Execution Reviewer",
      "total_issues": 1,
      "verified": 1,
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

# 合成任务

逐条记录来源意见，区分“事实存在”与“该事实构成计划缺口”两个判断。只保留会阻塞关键业务、架构或公共契约决策的问题，并保证修订指令与 Fact Check 对阻塞性和因果链的判断一致。
