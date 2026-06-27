# Plan Review Harness 接入 Claude Code

## 目标

本文供团队成员在本机完成以下配置：

1. 准备一个包含四份 Claude Code settings 的目录。
2. 将该目录传给 Plan Review Harness MCP。
3. 由 Claude Code 提交计划和项目目录，后台调用不同模型进行只读工程审查。

MCP 启动时会校验所有角色依赖的模型 settings。任一文件缺失、JSON 非法、字段不完整或出现禁用字段时，server 会直接退出，不会带着部分模型配置继续运行。

## 安全硬约束

### 禁止 `ANTHROPIC_API_KEY`

本集成只允许：

```text
ANTHROPIC_AUTH_TOKEN
```

明确禁止：

```text
ANTHROPIC_API_KEY
```

执行边界：

- settings 文件出现 `ANTHROPIC_API_KEY` 键时，MCP 在解析 JSON 前直接拒绝启动。
- 各模型认证信息只配置在对应的 settings 文件中，MCP 启动命令不承载认证配置。
- MCP 启动 runner、runner 启动 Claude Code 时会自动忽略宿主环境中的 `ANTHROPIC_API_KEY`，过滤过程只判断键名，不读取变量值。
- 状态接口和日志只返回认证字段名，不返回 token 内容。

### 工程目录只读

每个 Reviewer 都在临时空目录中启动，并通过以下参数访问指定工程：

```text
--bare
--add-dir <project_root>
--tools Read,Glob,Grep
--allowed-tools Read,Glob,Grep
--permission-mode dontAsk
```

不提供 `Bash`、`Edit`、`Write`、`NotebookEdit`。模型 settings 中即使存在 Bash 权限规则，也不会获得 Bash 工具。

## 1. 准备 Settings 目录

同事只需要提供一个目录，目录内固定包含以下四个文件：

```text
<settings-dir>/
├── kimi.json
├── deepseek.json
├── glm.json
└── qwen.json
```

文件名用于识别模型，不需要额外创建 Harness 配置文件。

每个文件应包含对应模型的网关地址、模型名和 `ANTHROPIC_AUTH_TOKEN`。

Kimi 示例：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.kimi.com/coding/",
    "ANTHROPIC_AUTH_TOKEN": "实际 token"
  }
}
```

其他兼容网关示例：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://实际网关地址",
    "ANTHROPIC_MODEL": "实际模型名",
    "ANTHROPIC_AUTH_TOKEN": "实际 token"
  }
}
```

限制 settings 文件权限：

```bash
chmod 600 <settings-dir>/*.json
```

不要把实际 settings 文件或 token 提交到 Git。

## 2. 默认角色路由

目录模式使用内置路由：

| 角色 | 模型 |
|---|---|
| Risk Reviewer | Kimi |
| Architecture Reviewer | Kimi |
| Execution Reviewer | Kimi |
| Rebuttal Reviewer | GLM |
| Fact Judge / Evidence Verifier | GLM |
| Synthesizer | GLM |
| Planner 备选 | Kimi |

`fact_check` 在四个 Reviewer 完成后执行，只校验 Reviewer 输出中的
evidence 是否支持 claim，不新增问题、不合成、不提供修复建议。`planner`
当前不参与默认 Plan Review，因为计划由当前 Claude Code 会话提供。该映射保留给后续独立 Planner 流程。默认路由来自 `offline-drafts-full-20260622T120035Z` 的 `manual-v4` 角色映射。

## 3. 启动前校验

执行时只需要提供 settings 目录：

```bash
node --import tsx model-role-calibration/scripts/plan-review-mcp.ts \
  --settings-dir /ABSOLUTE/PATH/TO/claude-settings \
  --validate-only
```

成功时输出：

```json
{
  "valid": true,
  "roles": {},
  "models": {}
}
```

输出不会包含 token。

启动校验包括：

- settings 目录存在、可读且是普通目录。
- `kimi.json`、`deepseek.json`、`glm.json`、`qwen.json` 全部存在。
- 每个模型的 settings 文件存在、可读且是普通文件。
- settings 是合法 JSON object，并包含 `env`。
- 存在有效的 `ANTHROPIC_BASE_URL`。
- 配置要求时存在有效的 `ANTHROPIC_MODEL`。
- 存在非占位符的 `ANTHROPIC_AUTH_TOKEN`。
- 不存在 `ANTHROPIC_API_KEY`。
- 本机能够执行配置中的 `claude_bin`。

## 4. 生成无 Marketplace 分发包

在 Harness 仓库执行：

```bash
npm run plan-review:package
```

生成：

```text
model-role-calibration/dist/plan-review-harness-claude-code/
model-role-calibration/dist/plan-review-harness-claude-code.tar.gz
```

分发包使用显式文件白名单，只包含 MCP runtime、角色 prompt、输出
schema、Skill、安装器和卸载器，不包含真实 settings、历史运行结果、评分归档
或 token。

将压缩包交给同事后，对方执行：

```bash
tar -xzf plan-review-harness-claude-code.tar.gz
cd plan-review-harness-claude-code
./install.sh /ABSOLUTE/PATH/TO/claude-settings
```

安装器不使用 marketplace，也不调用 `claude plugin install`：

- MCP runtime 复制到
  `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plan-review-harness/mcp`。
- Skill 直接复制到
  `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/plan-review`。
- MCP 使用 `claude mcp add --scope user` 注册。
- 安装前后都会执行无模型调用的 settings 校验。
- 已存在但没有本安装器所有权标记的目标目录不会被覆盖。

卸载：

```bash
./uninstall.sh
```

卸载器只删除带本安装器所有权标记的目录。

## 5. 手工注册 Claude Code MCP

注册为用户级 MCP。只需要提供 Harness 路径和 settings 目录：

```bash
claude mcp add --scope user plan-review-harness -- \
  node --import tsx /ABSOLUTE/PATH/plan-review-harness/model-role-calibration/scripts/plan-review-mcp.ts \
  --settings-dir /ABSOLUTE/PATH/TO/claude-settings
```

也可以创建项目级 `.mcp.json`：

```json
{
  "mcpServers": {
    "plan-review-harness": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--import",
        "tsx",
        "/ABSOLUTE/PATH/plan-review-harness/model-role-calibration/scripts/plan-review-mcp.ts",
        "--settings-dir",
        "/ABSOLUTE/PATH/TO/claude-settings"
      ]
    }
  }
}
```

不要在 `.mcp.json` 中放 token。

需要自定义角色路由、并发数或运行目录时，仍可使用高级 `--config` 模式；`--settings-dir` 与 `--config` 不能同时使用。

## 6. 在 Claude Code 中使用

MCP 提供三个工具：

### `configuration_status`

检查当前角色路由和 settings 路径。只返回脱敏信息。

### `start_plan_review`

参数示例：

```json
{
  "project_root": "/absolute/path/to/project",
  "plan_file": "/absolute/path/to/plan.md",
  "context": "本次只修改移动端 JS 层，不修改原生层",
  "roles": [
    "risk",
    "architecture",
    "execution",
    "rebuttal"
  ]
}
```

`plan_file` 和 `plan` 必须且只能提供一个：

- 有 Markdown 文件时使用 `plan_file`。CC 不应先读取文件并把全文放入工具参数。
- 没有文件、用户直接粘贴正文时使用 `plan`。
- `plan_file` 必须是可读的绝对路径，文件最大为 2 MiB。

工具立即返回 `run_id`，评审在后台执行，不会让一次 MCP 调用持续等待全部模型完成。
返回结果同时包含 `execution_log` 的绝对路径。
返回的 `next_action` 会明确要求 Claude Code 立即调用 `get_plan_review`。同一计划不应重复调用 `start_plan_review`。

在另一个终端实时观察：

```bash
tail -f <start_plan_review 返回的 execution_log>
```

日志示例：

```text
[2026-06-15T12:00:00.000Z] run_queued run_id="workspace-review-..." roles=["risk","architecture","execution","rebuttal"]
[2026-06-15T12:00:00.100Z] run_started run_id="workspace-review-..." pid=12345 roles=["risk","architecture","execution","rebuttal"] max_concurrency=4
[2026-06-15T12:00:00.200Z] agent_started role="risk" model="kimi"
[2026-06-15T12:00:00.210Z] agent_started role="architecture" model="kimi"
[2026-06-15T12:00:00.220Z] agent_started role="execution" model="kimi"
[2026-06-15T12:00:00.230Z] agent_started role="rebuttal" model="glm"
[2026-06-15T12:01:00.000Z] agent_completed role="risk" model="kimi" elapsed_ms=59800
[2026-06-15T12:02:00.000Z] synthesis_started role="synthesis" model="glm" reviewer_count=4
[2026-06-15T12:03:00.000Z] run_completed run_id="workspace-review-..." reviewer_count=4
```

该日志不记录计划正文、模型输出、settings 内容或认证信息。

### `get_plan_review`

参数示例：

```json
{
  "run_id": "workspace-review-20260615T120000Z",
  "include_report": true,
  "wait_ms": 60000
}
```

该工具是 Claude Code 等待评审完成的唯一状态入口。调用期间：

- MCP 保持本次工具请求打开，默认最多等待 60 秒。
- CC 提供 `progressToken` 时，MCP 通过标准 `notifications/progress` 返回当前运行角色、模型和完成数量。
- 收到 progress 表示 Agent 正常执行，CC 应继续等待当前工具调用。
- 禁止 CC 使用 Bash、`sleep`、Monitor、`execution.log` 或 `claude mcp call` 观察状态。
- 只有工具返回 `status: "running"` 和 `next_action` 时，CC 才按 `next_action` 再次调用。
- `wait_ms: 0` 仅供人工即时诊断，不应作为 CC 主动轮询方式。

状态可能为：

```text
queued
running
completed
failed
```

`completed` 时返回各 Reviewer 输出和 Synthesizer 结果。

## 7. 手工安装 Plan Review Skill

MCP 负责执行，Skill 负责读取计划文件、调用顺序、等待规则和结果展示。安装后不需要重复粘贴固定 prompt。
分发包的 `install.sh` 已自动完成此步骤；只有不使用分发包时才需要手工复制。

```bash
mkdir -p ~/.claude/skills/plan-review

cp \
  /ABSOLUTE/PATH/plan-review-harness/model-role-calibration/claude-code/skills/plan-review/SKILL.md \
  ~/.claude/skills/plan-review/SKILL.md
```

如果当前 Claude Code 会话启动时 `~/.claude/skills/` 已存在，Skill 文件修改会被实时发现；首次创建顶层目录时应重启 Claude Code。

在待评审工程目录启动 Claude Code：

```bash
cd /ABSOLUTE/PATH/TO/PROJECT
claude
```

### 标准使用流程

1. 先让 Claude Code 根据需求和当前工程规划实施计划。
2. 确认计划内容。
3. 已保存为 Markdown 文件时，调用 `/plan-review <文件路径>`。
4. 未保存为文件时，调用空参数 `/plan-review`，再按提示粘贴完整计划正文。
5. 等待四个 Reviewer 和 Synthesizer 完成只读审查。
6. 根据流程图、节点问题、人工决策和修订清单更新计划。
7. 计划通过审查后，再进入代码实现阶段。

Plan Review 只审查已经形成的计划，不负责替代 Claude Code 生成实施计划，也不会修改工程文件。带参数模式始终把参数作为文件路径。
文件模式只向 MCP 传递 `plan_file` 路径，由 MCP 读取文件，避免 CC 在调用前读取和渲染整份长计划。

### 使用案例一：已有计划文档

计划已经存在：

```text
/plan-review /ABSOLUTE/PATH/TO/plan.md
```

例如：

```text
/plan-review /Users/guanchengqian/.claude/plans/twinkly-sauteeing-matsumoto.md
```

路径包含空格时使用引号：

```text
/plan-review "/Users/name/Documents/collector implementation plan.md"
```

### 使用案例二：没有现成计划文档

先在 Claude Code 中要求生成实施计划，但不要求保存文件：

```text
请结合当前需求和工程代码制定实施计划。
只生成计划，不修改代码。
```

计划生成后执行：

```text
/plan-review
```

未传参数时，Skill 会询问：

```text
请粘贴需要审查的完整计划正文。
```

粘贴刚才生成的完整计划。Skill 会直接使用正文启动审查，不需要创建临时文件。

不要把计划正文直接追加到命令后。以下内容会被解释为文件路径：

```text
/plan-review 修改 config.ts 并更新测试
```

Skill 会自动：

1. 读取计划文件全文，或接收用户粘贴的计划正文。
2. 使用当前 Claude Code 工程目录作为 `project_root`。
3. 启动默认全部 Reviewer。
4. Reviewer 完成后启动 Fact Check，只校验已给出的 evidence。
5. Fact Check 完成后启动 Synthesizer。Synthesizer 不读取工程目录，只基于计划、Reviewer JSON 和 Fact Check 报告合成。
6. 按 `next_action` 等待 MCP progress。
7. 输出 Mermaid 主流程图。
8. 按流程节点展示问题、人工决策、可能误报和修订清单。

不要把 token 或 settings 内容写入 Skill。

## 8. 运行产物

默认写入：

```text
model-role-calibration/workspace-runs/<run-id>/
```

主要文件：

```text
request.json
run-manifest.json
review-plan.md
plan-compaction.json
state.json
report.json
execution.log
runner.stdout.log
runner.stderr.log
roles/<role>/prompt.md
roles/<role>/read-scope.json
roles/<role>/output.json
roles/<role>/metadata.json
roles/fact_check/fact-check-summary.json
```

`request.json` 包含计划全文，可能涉及内部信息。`run-manifest.json` 记录本次运行的 declared runtime、workspace/input snapshot 和 resolved execution，用于复查“基于什么执行”和“实际发生了什么”。`workspace-runs/` 已被 Git 忽略，不要手工提交。

`review-plan.md` 是实际传给 Reviewer、Fact Check 和 Synthesizer 的审查版计划。runner 会把长代码块压缩为 `pseudo` 摘要，保留接口、测试意图、关键流程和显式 TODO。`plan-compaction.json` 记录压缩前后字符数、压缩代码块数量和节省字符数。原始计划仍保存在 `request.json`。

分析某次 `cc -p` 执行行为：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/inspect-workspace-run.js \
  --run-dir ~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>
```

生成标准化验证报告：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/verify-workspace-review-run.js \
  --run-id <run-id>
```

生成聚合诊断和下一步建议：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/doctor-workspace-review-run.js \
  --run-id <run-id>
```

需要机器读取 doctor 输出时加 `--json`。脚本默认读取
`~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>`。退出码 `0` 表示已完成且通过，`1` 表示已完成但检查失败或 run failed，`2` 表示 queued/running 尚未完成。
只有评审产物被移动到非默认目录时，才使用 `--run-dir /path/to/workspace-runs/<run-id>`。

旧版 runner 生成的历史 run 如果缺少 `run-manifest.json`，先显式补写 manifest：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/backfill-workspace-run-manifest.js \
  --run-id <run-id>
```

`workspace-runs/<run-id>/state.json` 会记录启动评审时 CC 所在项目的
`project_root`，所以标准验证流程只需要 `run_id`。做跨项目效果分析时，可以额外记录项目路径，方便人工解释业务上下文。

新版本运行产物必须在 `report.json` 中包含 `outcome`。如果报告出现
`infra_errors`，表示 Reviewer/模型输出或 harness 解析问题，不应解释为计划本身的阻塞结论。

Reviewer 和 Fact Check 默认使用 scoped mirror 硬隔离：runner 从计划或
Reviewer evidence 中提取相对文件，只复制这些文件和少量项目配置文件到临时工程副本，并将该副本作为 Claude Code 的 `--add-dir`。每个角色的边界保存在 `roles/<role>/read-scope.json`。

该脚本读取 `roles/<role>/stdout.jsonl`，输出每个角色的模型、耗时、prompt/output/stdout 大小、工具调用次数、最大输入 token、读取边界、越界读取文件和读取文件列表。Fact Check 会额外输出 `fact-check-summary.json`，用于观察 `verified`、`unsupported`、`contradicted`、`unverifiable` 等状态分布。

## 9. 故障处理

MCP 无法启动时，先运行 `--validate-only`。错误会明确指出模型和文件，例如：

```text
Missing settings file for model "qwen"
```

或者：

```text
ANTHROPIC_API_KEY is forbidden; use ANTHROPIC_AUTH_TOKEN only
```

后台评审失败时查看：

```text
workspace-runs/<run-id>/state.json
workspace-runs/<run-id>/runner.stderr.log
workspace-runs/<run-id>/roles/<role>/metadata.json
```

修复 settings 后重新提交新的 Plan Review，不复用失败 run。
