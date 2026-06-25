---
name: plan-review
description: 仅在用户显式调用 /plan-review 时，使用 plan-review-harness MCP 对计划文件或用户粘贴的计划正文执行多角色只读工程评审，并输出带问题节点映射的 Mermaid 流程图、分歧和修订清单；/plan-review --check 用于检查 MCP 配置与角色路由。
allowed-tools:
  - mcp__plan-review-harness__start_plan_review
  - mcp__plan-review-harness__retry_plan_review_stage
  - mcp__plan-review-harness__get_plan_review
  - mcp__plan-review-harness__configuration_status
---

# Plan Review

按以下流程执行，不要让用户重复提供固定调用说明。

## 参数解析

`$ARGUMENTS` 可能取值：

- `--check`：执行连接检查，调用 `configuration_status`。
- 非空且不是 `--check`：始终作为计划文件路径。
- 空：询问用户粘贴计划正文。

## 连接检查模式

当 `$ARGUMENTS` 等于 `--check` 时：

1. 调用 `plan-review-harness` 的 `configuration_status`。
2. 检查返回结果：
   - `valid` 必须为 `true`。
   - 每个已配置模型的 `auth_env` 必须为 `ANTHROPIC_AUTH_TOKEN`，不能是 `ANTHROPIC_API_KEY`。
3. 展示角色路由和模型配置摘要。
4. 如果检查失败，明确列出失败项和修复建议；如果全部通过，告诉用户可以开始 `/plan-review /path/to/plan.md`。

### 预期角色路由

默认应看到：

```text
risk:       kimi
architecture: kimi
execution:  kimi
rebuttal:   glm
fact_check: glm
synthesis:  glm
planner:    kimi
```

该预期来自 `role_route_source.score_version = manual-v4` 的默认路由。若 MCP 返回了其他
`role_route_source`，以 MCP 返回为准，并说明当前 Skill 预期与运行时来源不同。

### 输出格式

#### 检查结果

- `valid`: `true` / `false`
- 失败原因（如有）

#### 角色路由

以表格或列表形式展示 `roles`。

#### 模型配置

展示每个模型的 `settings_file`、`base_url`、`model`（如果有）、`auth_env`。不要展示任何 token 值。

#### 下一步

- 通过："连接检查通过，可以执行 `/plan-review [计划文件路径]`。"
- 失败："请先修复上述问题后再使用 `/plan-review`。"

## 评审模式

当 `$ARGUMENTS` 不是 `--check` 时，执行评审：

1. 根据 `$ARGUMENTS` 确定计划来源：
   - `$ARGUMENTS` 非空时，始终将其作为计划文件路径，不要把它解释为计划正文。不要使用 `Read` 读取文件；将路径直接传给 MCP 的 `plan_file`，由 MCP 完成文件校验和读取。
   - `$ARGUMENTS` 为空时，只询问：`请粘贴需要审查的完整计划正文。` 将用户下一条非空回复作为计划全文，不要求用户创建文件。
2. 计划内容为空时停止，不要调用 MCP。
3. 调用 `plan-review-harness` 的 `start_plan_review`：
   - 文件模式：只传 `plan_file: $ARGUMENTS`，不要传 `plan`。
   - 粘贴模式：只传 `plan`，不要传 `plan_file`。
   - `context`：`全角色计划评审。只评审计划，不修改工程文件。`
   - 不传 `roles`，使用默认全部 Reviewer。
   - 通常不传 `project_root`，让 MCP 使用当前 Claude Code 工程目录。
4. 同一计划只调用一次 `start_plan_review`。
5. 立即按返回的 `next_action` 调用 `get_plan_review`。
6. `get_plan_review` 运行期间保持等待 progress notification。禁止使用 Bash、`sleep`、Monitor、`execution_log`、`claude mcp call` 或其他外部方式查询状态。
7. 只有当 `get_plan_review` 返回 `status: running` 和新的 `next_action` 时，才按其参数再次调用。
8. `status: completed` 但任一 Reviewer 不是 `completed`，或返回了对应 Reviewer 的 `infra_errors` 时，先调用 `retry_plan_review_stage`，参数为 `{ run_id, stage: "reviewers" }`，不要直接展示不完整报告。
9. `status: failed` 时：
   - 如果任一 Reviewer 为 `failed` 或缺少结果，调用 `retry_plan_review_stage`，参数为 `{ run_id, stage: "reviewers" }`。该阶段只重跑失败或缺失的 Reviewer；成功后继续 Fact Check 和 Synthesis。
   - 如果全部 Reviewer 已完成但 Fact Check 为 `failed`，调用 `retry_plan_review_stage`，参数为 `{ run_id, stage: "fact_check" }`。该阶段复用 Reviewer，并继续 Synthesis。
   - 如果 Reviewer 与 Fact Check 均已完成但 Synthesis 为 `failed`，调用 `retry_plan_review_stage`，参数为 `{ run_id, stage: "synthesis" }`。
   - 每次重试后继续按 `next_action` 调用 `get_plan_review`。MCP 会维护 `retry_counts`；每个 Reviewer、Fact Check、Synthesis executor 最多重试 3 次。
   - MCP 返回 `Retry limit reached` 或不满足阶段前置条件时，输出失败阶段和错误，不再重试。
10. 全部 Reviewer、Fact Check 和 Synthesis 均完成后，按下述格式展示，不修改工程文件。

### 输出格式

#### 结论

输出 `run_id`、参与角色、完成状态，以及阻塞项数量和需要人工裁决的分歧数量。

#### Plan 结构检查

展示 `report.authoring_lint`：

- 复杂度和行数预算。
- `errors`：必须修订的结构、实现代码膨胀或 Existing Code Refs 错误。
- `warnings`：行数超限、待确认措辞位置或无法可靠分类的长代码块。

没有 error/warning 时写“通过”。warning 不自动阻塞；error 必须反映在 `outcome.status: needs_revision`。

#### 流程图

直接渲染 `report.synthesis.output.process_map.mermaid`：

```mermaid
<mermaid>
```

不得自行补画报告中不存在的节点或关系。
如果结果缺少 `process_map`，说明该任务使用旧版输出契约，提示用户重新发起评审，不要自行生成流程图。

#### 节点问题

按 `process_map.nodes` 的流程顺序分组。只展示 `status` 为 `affected` 或 `decision` 的节点：

- 节点名称和阶段。
- 关联问题标题、严重程度、来源和证据。
- 为什么影响该节点。
- 最小修订目标。

#### 人工决策

只列 `needs_human_decision: true` 的分歧，保留决策选项和影响。没有时写“无”。

#### Fact Check

展示 `report.fact_check.output.source_summaries`，并列出 `unsupported`、`contradicted`、`unverifiable` 的 issue 标题、来源和原因。没有时写“无”。

#### 可能误报

展示 `likely_false_positives[].reason`，可附带对应 `source_finding_ids`；不要混入修订清单。

#### 修订清单

按 `revision_instructions` 顺序输出每项 `instruction`。修订只补充关键决策和契约，不要求完整源码、Hook、props、JSX、mock 或测试实现。

#### Reviewer 附录

每个 Reviewer 只输出模型、问题数量和一行角色侧重点，不重复粘贴全部 issues。
