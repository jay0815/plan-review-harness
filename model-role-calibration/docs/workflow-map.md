# Plan Review Harness 使用方式与流程图

本文用于对齐当前工程的功能关系、运行流程和下一步架构边界。它不是详细安装手册；安装细节以仓库根目录的 `install.md` 为准。

当前拆分为 `1 + 9` 个图：

- `1` 个工程功能关系图。
- `9` 个具体功能流程图：核心运行时、安装升级、实际 Plan Review、内部审查管线、诊断重试、Route Promotion、Role Calibration、Fact Check Calibration、日常最短路径。

图中关系语义按用途区分：

- `calls`：运行时调用关系。
- `loads`：读取配置或契约。
- `writes`：写入运行产物。
- `validates`：测试、verify、doctor 的审计关系。
- `builds`：构建和安装关系。
- `promotes`：候选配置晋升为已批准配置。

## 图 1：工程功能关系图

```mermaid
flowchart TD
  User["使用者 / 目标工程 Claude Code"]

  subgraph Product["运行产品面"]
    Skill["Claude Code Skill"]
    Runtime["MCP Runtime"]
    Engine["Workspace Plan Review Engine"]
  end

  subgraph RuntimeConfig["运行时配置与契约"]
    Policy["Policy Pack"]
    Prompts["Prompt Registry"]
    Schemas["Schema Registry"]
    ApprovedRoutes["Approved Route Profile"]
    Resolver["Route Resolver"]
  end

  subgraph Execution["模型执行边界"]
    Adapter["Model Command Adapter"]
    Provider["Claude Code Wrapper / Provider"]
  end

  subgraph Evidence["证据与诊断"]
    Manifest["Run Manifest"]
    Bundle["Immutable Run Bundle"]
    Doctor["Doctor"]
    Verify["Verify"]
    Inspect["Inspect"]
  end

  subgraph Calibration["校准与晋升"]
    RoleCalib["Role Calibration"]
    FCCalib["Fact Check Calibration"]
    Candidate["Candidate Route Profile"]
    Gate["Promotion Gate"]
  end

  subgraph Delivery["构建交付"]
    RuntimeSource["Runtime Source"]
    SkillSource["Skill Source"]
    Builder["Package Builder"]
    Dist["Distribution Package"]
    Installed["Installed Runtime / Skill"]
  end

  Tests["Tests / Contract Checks"]

  User -- calls --> Skill
  Skill -- calls --> Runtime
  Runtime -- calls --> Engine

  Engine -- loads --> Policy
  Engine -- loads --> Prompts
  Engine -- loads --> Schemas
  Engine -- loads --> Resolver
  Resolver -- loads --> ApprovedRoutes
  Resolver -- calls --> Adapter
  Adapter -- calls --> Provider

  Engine -- writes declared/resolved --> Manifest
  Engine -- writes artifacts --> Bundle
  Provider -- writes execution evidence --> Bundle
  Manifest -- included in --> Bundle

  Bundle -- validates --> Doctor
  Bundle -- validates --> Verify
  Bundle -- inspect --> Inspect
  Doctor -- reports --> User
  Verify -- reports --> User
  Inspect -- reports --> User

  RoleCalib -- produces --> Candidate
  FCCalib -- produces --> Candidate
  Candidate -- promotes --> Gate
  Gate -- writes approved --> ApprovedRoutes

  RuntimeSource -- builds --> Builder
  SkillSource -- builds --> Builder
  Builder -- builds --> Dist
  Dist -- installs --> Installed
  Installed -- provides --> Runtime
  Installed -- provides --> Skill

  Tests -- validates --> Engine
  Tests -- validates --> Runtime
  Tests -- validates --> Policy
  Tests -- validates --> Prompts
  Tests -- validates --> Schemas
  Tests -- validates --> ApprovedRoutes
  Tests -- validates --> Dist
  Tests -- validates --> RoleCalib
  Tests -- validates --> FCCalib
```

核心判断：

- `Workspace Plan Review Engine` 是运行产品核心。
- `Role Calibration` 和 `Fact Check Calibration` 只产生候选决策，不能直接污染运行时路由。
- Runtime 只读取 `Approved Route Profile`。
- `Run Manifest` 和 `Immutable Run Bundle` 是可复现性基础。
- `Tests` 是横切验证层，不是生产调用链。
- `Distribution Package` 是构建产物，不是 Runtime / Skill 的源头。

## 图 2：核心运行时架构

```mermaid
flowchart TD
  User["Claude Code in Target Workspace"]
  Skill["Claude Code Skill"]
  Runtime["MCP Runtime"]
  Engine["Workspace Plan Review Engine"]

  Manifest["Run Manifest<br/>Declared + Resolved"]
  Snapshot["Workspace Snapshot / Input Snapshot"]
  Policy["Policy Pack"]
  Prompts["Prompt Registry"]
  Schemas["Schema Registry"]
  Resolver["Route Resolver"]
  Routes["Approved Route Profile"]
  Adapter["Model Command Adapter"]
  Provider["Claude Code Wrapper / Provider"]

  Bundle["Immutable Run Bundle"]
  Verify["Verify"]
  Inspect["Inspect"]
  Doctor["Doctor"]

  User --> Skill
  Skill --> Runtime
  Runtime --> Engine

  Engine --> Manifest
  Engine --> Snapshot
  Engine --> Policy
  Engine --> Prompts
  Engine --> Schemas
  Engine --> Resolver

  Resolver --> Routes
  Resolver --> Adapter
  Adapter --> Provider

  Provider --> Bundle
  Engine --> Bundle
  Manifest --> Bundle

  Bundle --> Verify
  Bundle --> Inspect
  Bundle --> Doctor

  Verify --> User
  Inspect --> User
  Doctor --> User
```

运行时原则：

- Engine 读取配置。
- Run Manifest 冻结 declared runtime 和 resolved execution。
- Provider / Adapter 负责实际模型执行。
- Verify 只审计已有证据，不重新解释历史。
- Doctor 把证据链翻译成下一步动作。

### Run Manifest 的最小语义

`run-manifest.json` 不应只在结束后汇总生成。它应在首次模型调用前创建，随后只允许状态迁移或追加已发生事实。

建议状态：

```text
created -> running -> completed / failed / aborted
```

建议拆成两类信息：

- `declared_runtime`：本次 run 打算基于什么执行。
- `resolved_execution`：本次 run 最终实际用了什么执行。

最小字段方向：

```json
{
  "run_id": "workspace-review-xxx",
  "status": "running",
  "created_at": "2026-06-26T10:00:00Z",
  "workspace": {
    "project_root": "/path/to/project",
    "git_head": "abc123",
    "dirty": true,
    "dirty_files": ["src/a.ts"],
    "dirty_patch_hash": "sha256:..."
  },
  "inputs": {
    "plan": {
      "path": "docs/plan.md",
      "hash": "sha256:..."
    },
    "review_plan": {
      "path": "review-plan.md",
      "hash": "sha256:..."
    },
    "review_plan_refs_hash": "sha256:..."
  },
  "declared_runtime": {
    "policy": {
      "path": "review-policy.json",
      "hash": "sha256:..."
    },
    "route_profile": {
      "path": "default-role-routes.json",
      "hash": "sha256:...",
      "approval_ref": "approval-xxx"
    },
    "prompt_set_hash": "sha256:...",
    "schema_set_hash": "sha256:..."
  },
  "resolved_execution": {
    "risk": {
      "adapter": "claude-code",
      "model": "kimi",
      "prompt_hash": "sha256:...",
      "schema_hash": "sha256:...",
      "attempts": 1,
      "fallback_from": null
    }
  }
}
```

## 图 3：安装 / 升级流程

```mermaid
flowchart TD
  A["修改 Runtime Source / Skill Source / Config"] --> B["本地验证"]
  B --> C["npm run plan-review:package"]
  C --> D["Package Builder"]
  D --> E["dist/plan-review-harness-claude-code"]
  E --> F["执行 install.sh /path/to/claude-settings"]
  F --> G["安装 MCP Runtime 到 ~/.claude/plan-review-harness/mcp"]
  F --> H["安装 Skill 到 ~/.claude/skills/plan-review"]
  F --> I["claude mcp add 注册 plan-review-harness"]
  I --> J["重启 Claude Code"]
  J --> K["/plan-review --check"]
  K --> L{"valid?"}
  L -->|yes| M["可以执行真实 plan review"]
  L -->|no| N["检查 settings / auth_env / route / Claude CLI"]
```

当前主要命令：

```bash
npm run plan-review:package
cd model-role-calibration/dist/plan-review-harness-claude-code
./install.sh /absolute/path/to/claude-settings
```

## 图 4：实际使用 Plan Review 流程

```mermaid
flowchart TD
  A["目标工程 Claude Code"] --> B{"是否已有计划文件?"}

  B -->|有| C["/plan-review /path/to/plan.md"]
  B -->|没有| D["/plan-review"]
  D --> E["粘贴完整计划正文"]

  C --> F["Skill 调用 MCP start_plan_review"]
  E --> F

  F --> G["创建 run 目录"]
  G --> H["创建 run-manifest.json: created"]
  H --> I["返回 run_id + next_action"]
  I --> J["继续调用 get_plan_review"]
  J --> K{"status"}

  K -->|queued / running| J
  K -->|completed| L["输出最终审查结果"]
  K -->|failed| M["进入诊断 / retry"]

  L --> N["记录 run_id"]
  N --> O["doctor / verify / inspect"]
```

使用约束：

- 同一个计划只调用一次 `start_plan_review`。
- 后续按 `next_action` 继续 `get_plan_review`。
- 真实模型执行发生在 MCP runner 中，不需要手工跑每个模型命令。
- Manifest 在首次模型调用前创建，不在结束后补写历史。

## 图 5：Workspace Review 内部审查管线

```mermaid
flowchart TD
  A["Plan 输入"] --> B["Input Snapshot"]
  B --> C["Run Manifest: declared_runtime"]

  A --> D["Plan Authoring Lint"]
  D --> E["plan-authoring-lint.json"]

  A --> F["Plan Compaction"]
  F --> G["review-plan.md"]
  G --> H["review-plan-refs.json"]

  C --> I["Policy Pack"]
  H --> J["构建 scoped mirror / read-scope"]
  I --> J

  J --> K1["Risk Reviewer"]
  J --> K2["Architecture Reviewer"]
  J --> K3["Execution Reviewer"]
  J --> K4["Rebuttal Reviewer"]

  K1 --> L["Reviewer Outputs"]
  K2 --> L
  K3 --> L
  K4 --> L

  L --> M["Fact Check Read Scope"]
  I --> M
  M --> N["Fact Check"]
  N --> O["fact-check-summary.json"]

  L --> P["Synthesis"]
  O --> P
  G --> P
  I --> P

  K1 --> Q["Run Manifest: resolved_execution"]
  K2 --> Q
  K3 --> Q
  K4 --> Q
  N --> Q
  P --> Q

  P --> R["report.json"]
  R --> S["Outcome Resolver"]
  E --> S
  I --> S
  S --> T{"plan_ready / needs_revision / infra_errors"}
```

关键边界：

- Reviewer 只能读 scoped mirror。
- Fact Check 只读 reviewer evidence 和允许补充的 Plan Existing Code Refs。
- Synthesis 不读工程目录，只基于计划、Reviewer JSON、Fact Check 结果合成。
- `plan-authoring-lint` error 会让 outcome 至少是 `needs_revision`。
- `resolved_execution` 记录实际 adapter、模型、prompt/schema hash、attempts、fallback。

### Policy 的执行位置

Policy 不能只被 Doctor / Verify / Report 读取。不同规则要由不同位置强制：

| Policy 示例 | 强制位置 |
| --- | --- |
| `required_roles` | Review Engine |
| `synthesis_may_read_workspace: false` | Executor / Tool Allowlist |
| `fact_check_tools: ["Read"]` | Fact Check Executor |
| `plan_lint_error_outcome` | Outcome Resolver |
| `max_executor_retries` | Retry Controller |
| `revision_instruction_requires_fact_check` | Workflow Orchestrator |
| 结果是否可发布 | Verify / Report |

原则：

```text
Prompt 负责引导行为。
Policy 负责限制能力。
Verify 负责审计结果。
```

## 图 6：诊断 / 重试流程

```mermaid
flowchart TD
  A["拿到 run_id"] --> B["plan-review:doctor"]
  B --> C{"Run health"}

  C -->|pending| D["等待 get_plan_review completed"]
  C -->|fail| E["查看 infra_errors / verify fail"]
  C -->|warn| F["看 Action level"]
  C -->|pass| G["可记录为稳定样本"]

  E --> H{"失败阶段"}
  H -->|reviewer 缺失或失败| I["retry stage reviewers"]
  H -->|fact_check 失败| J["retry stage fact_check"]
  H -->|synthesis 失败| K["retry stage synthesis"]

  I --> L["追加 resolved_execution / attempts"]
  J --> L
  K --> L
  L --> B

  F --> M{"Action level"}
  M -->|P0| N["先修计划结构或关键问题"]
  M -->|P1| O["人工确认证据链 / revision 指令"]
  M -->|P2| P["可追加 regression note"]
```

当前诊断入口：

```bash
npm run plan-review:doctor -- --run-id <run-id>
npm run plan-review:verify-run -- --run-id <run-id>
npm run plan-review:inspect -- --run-dir ~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>
```

入口分工：

- `doctor` 是日常首选，用于判断本次 run 是否健康以及下一步做什么。
- `verify-run` 用于检查运行产物、隔离、工具边界和阶段契约。
- `inspect` 用于查看模型实际读取文件、工具调用和 token 使用情况。

## 图 7：Route Promotion 流程

```mermaid
flowchart LR
  Runs["Calibration Runs"]
  Report["Calibration Report"]
  Candidate["Candidate Route Profile"]
  Coverage["Coverage Check"]
  Regression["Regression Check"]
  Safety["Safety Floor Check"]
  Gate["Promotion Gate"]
  Approved["Approved Route Profile"]
  Resolver["Runtime Route Resolver"]

  Runs --> Report
  Report --> Candidate
  Candidate --> Coverage
  Candidate --> Regression
  Candidate --> Safety
  Coverage --> Gate
  Regression --> Gate
  Safety --> Gate
  Gate --> Approved
  Approved --> Resolver
```

Route Promotion 规则：

- Calibration 只生成 candidate。
- Runtime 只读取 approved profile。
- Candidate 不能因为单次 calibration 得分最高就直接晋升。
- Promotion 至少要记录覆盖度、回归、安全底线三类检查。
- Approved profile 必须引用 candidate、approval note、approval time、commit hash 或等价人工确认记录。

Candidate 示例：

```json
{
  "candidate_id": "route-candidate-20260626-01",
  "base_profile_hash": "sha256:...",
  "source_calibration_runs": ["calib-run-001", "fc-calib-run-003"],
  "score_version": "manual-v4",
  "promotion_checks": {
    "coverage_passed": true,
    "regression_passed": true,
    "safety_floor_passed": true
  },
  "recommended_changes": [
    {
      "role": "fact_check",
      "from": "kimi",
      "to": "glm",
      "reason": "higher evidence-grounding score"
    }
  ]
}
```

Approved 示例：

```json
{
  "profile_id": "default-role-routes@18",
  "approved_from_candidate": "route-candidate-20260626-01",
  "approved_by": "human",
  "approved_at": "2026-06-26T10:00:00Z",
  "approval_note": "...",
  "commit_hash": "..."
}
```

## 图 8：Role Calibration 流程

```mermaid
flowchart TD
  A["Calibration Case"] --> B["generate-prompts"]
  B --> C["Prompts: planner / risk / architecture / execution / rebuttal / synthesis"]

  C --> D["run-calibration"]
  D --> E["run-agent-pool / run-model"]
  E --> F["agent-outputs"]

  F --> G["score-output"]
  G --> H["scores/versions/<score-version>"]

  H --> I["summarize-results"]
  I --> J["calibration-results.json"]
  I --> K["calibration-summary.md"]
  I --> L["model-role-map.md"]

  L --> M["Candidate Route Profile"]
  M --> N["Promotion Gate"]
```

典型命令链：

```bash
node model-role-calibration/scripts/run-calibration.js ...
node model-role-calibration/scripts/score-output.js ...
node model-role-calibration/scripts/summarize-results.js --run <run-id> --score-version <version>
```

当前原则：

- live model 执行通常由使用者手动跑。
- score version 不覆盖旧版本。
- 专项 regression case 不直接进入 primary case 推荐。
- 汇总结果是候选决策输入，不直接修改运行时路由。

## 图 9：Fact Check Calibration 流程

```mermaid
flowchart TD
  A["已完成 workspace review run"] --> B["create-fact-check-calibration-case"]
  B --> C["生成 fact-check case.json"]

  C --> D["人工补 expected_status / expected_evidence_status / expected_claim_support"]
  D --> E["generate-fact-check-prompts"]

  E --> F["候选模型执行 Fact Check"]
  F --> G["ingest-fact-check-output"]
  G --> H["score-fact-check-output"]

  H --> I["summarize-fact-check-calibration"]
  I --> J["Fact Check 模型推荐"]
  J --> K["Candidate Route Profile"]
  K --> L["Promotion Gate"]
```

Fact Check Calibration 和普通 Role Calibration 分开维护。前者校准的是证据核查能力，不要求候选模型重新发现问题或合成结论。

Fact Check Calibration 应关注的维度：

- unsupported claim detection rate
- false-positive rate
- evidence citation completeness
- contradiction detection rate
- unknown / insufficient evidence correctness
- fabricated evidence rate

## 图 10：日常最短路径

```mermaid
flowchart LR
  A["修改 / 生成计划"] --> B["/plan-review"]
  B --> C["get_plan_review 等到 completed"]
  C --> D["plan-review:doctor"]
  D --> E{"Action level"}
  E -->|P0| F["修计划或 retry"]
  E -->|P1| G["人工确认证据链"]
  E -->|P2 / none| H["记录样本 / 进入实现"]
```

## 后续工程化优先级

```text
P0：保持本文件中的架构边界与实际代码同步。
P1-A：补 run-manifest.json，冻结 declared + resolved execution。
P1-B：引入 candidate -> approval -> approved 的 route promotion 链。
P2-A：引入最小 Policy Pack，并让关键规则由 runtime 实际执行。
P2-B：定义薄 Model Command Adapter 边界。
P3：等边界稳定后，再考虑 apps/packages/configs/evals 的目录重组。
```
