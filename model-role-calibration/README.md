# 模型角色校准工具

本目录是一个本地、半自动的模型角色校准工具，用于评估不同模型更适合承担哪些规划和审查角色。

将已校准角色作为 Claude Code MCP 使用的安装说明见：

```text
model-role-calibration/claude-code-mcp-integration.md
```

生成不依赖 marketplace 的 MCP + Skill 分发包：

```bash
npm run plan-review:package
```

Workspace Plan Review 的执行顺序是四个 Reviewer 并发审查，随后由
Fact Check 校验 Reviewer evidence，最后由 Synthesizer 在不读取工程目录的情况下合成结论。

当前版本不直接调用模型 API，也不接 LangGraph。模型通过本机 Claude Code wrapper CLI 运行：

- 创建可编辑的校准 case。
- 生成标准化 probe prompt。
- 通过固定容量为 3 的 Node.js 并发池运行角色 probe。
- 归档 CLI 原始返回和可录入的结构化输出。
- 创建人工评分文件。
- 汇总评分并生成草稿报告。

目标是先稳定校准协议和 CLI 运行流程，再考虑模型 API 或 LangGraph 自动化。

## 第一轮范围

首轮诊断 case：

- `synthetic/event-reporting`
- `synthetic/plugin-lifecycle`
- `synthetic/offline-drafts`

已有的 `reqa/case-001` 保留为后续真实场景对照，不参与首轮角色画像。`sdd/case-001` 仍是待完善草稿。

初始候选模型：

- `kimi`
- `deepseek`
- `glm`
- `qwen`

这些命令是交互式 zsh 中封装的 Claude Code wrapper，并分别通过显式 `--settings` 接入底层 LLM。本轮不把 Codex 作为被测 agent。
runner 会校验这四个名字在交互式 zsh 中确实定义为 alias，避免 `kimi` 等同名独立 CLI 被误调用。

## 目录结构

```text
model-role-calibration/
  archive/
  cases/
  prompts/
  runs/
  schemas/
  scripts/
  outputs/
```

新的诊断 case 包含：

```text
inputs/planner.md
inputs/review.md
inputs/synthesis.md
rubric.md
```

输入按 probe 隔离：

- `planner` 只读取 `inputs/planner.md`。
- `risk`、`architecture`、`execution`、`rebuttal` 读取 `inputs/review.md`。
- `synthesis` 只读取 `inputs/synthesis.md` 中固定的三组评审意见。
- `rubric.md` 只用于人工评分，不会注入模型 prompt。

旧 case 的 `input.md + context.md` 格式继续兼容。

## 命令速查

创建 case：

```bash
node model-role-calibration/scripts/create-case.js --group synthetic --id case-004
```

一键生成 run、生成全部 prompt 并启动三并发模型池：

```bash
node model-role-calibration/scripts/run-calibration.js
```

默认等价于：

```text
case: synthetic/event-reporting
models: kimi,deepseek,glm,qwen
probes: planner,risk,architecture,execution,rebuttal,synthesis
```

也可以显式覆盖：

```bash
node model-role-calibration/scripts/run-calibration.js \
  --run synthetic-event-reporting-manual-001 \
  --case synthetic/event-reporting \
  --models kimi,deepseek,glm,qwen \
  --probes planner,risk,architecture,execution,rebuttal,synthesis
```

不传 `--run` 时，脚本自动生成 `synthetic-event-reporting-<UTC 时间>`。传入已有 `--run` 时，脚本只补生成缺失的 prompt；模型池会跳过已有成功结果并重试未完成任务。

### synthetic-event-reporting v2

`synthetic/event-reporting` 的第一次完整校准已归档到：

```text
model-role-calibration/archive/synthetic-event-reporting/v1/
```

v2 已完成并归档到：

```text
model-role-calibration/archive/synthetic-event-reporting/v2/
```

v1/v2 对比报告：

```text
model-role-calibration/archive/synthetic-event-reporting/v2/analysis/v1-v2-comparison.md
```

v2 保持 case、rubric 和模型集合不变，主要调整六个角色的初始化 prompt。Risk 根据 v1 已确认的角色边界改用不含 `suggested_fix` 的独立 schema，其余角色 schema 不变。实验说明见：

```text
model-role-calibration/cases/synthetic/event-reporting/v2-experiment.md
```

使用新的 Run ID 批量运行四个模型和六个角色：

```bash
RUN_ID="synthetic-event-reporting-v2-$(date -u +%Y%m%dT%H%M%SZ)"

node model-role-calibration/scripts/run-calibration.js \
  --run "$RUN_ID" \
  --case synthetic/event-reporting \
  --models kimi,deepseek,glm,qwen \
  --probes planner,risk,architecture,execution,rebuttal,synthesis
```

该命令会生成 prompt 并启动三并发模型池。四个模型在同一 role 下读取同一份 `probe-<role>.md`，不得添加模型专属提示。

生成 prompt：

```bash
node model-role-calibration/scripts/generate-prompts.js \
  --case synthetic/event-reporting \
  --probes planner,risk,architecture,execution,rebuttal,synthesis
```

命令会打印自动生成的 run id。prompt 会写入：

```text
model-role-calibration/runs/<run-id>/<case-id>/prompts/
```

运行单个 agent：

```bash
node model-role-calibration/scripts/run-model.js \
  --run <run-id> \
  --case synthetic/event-reporting \
  --model kimi \
  --probe planner
```

单任务命令用于调试和定向补查。正式评估通过 pool 执行；不要在 pool 运行期间并行启动单任务命令。

使用固定三并发池运行候选队列：

```bash
node model-role-calibration/scripts/run-agent-pool.js \
  --run <run-id> \
  --cases synthetic/event-reporting \
  --models kimi,deepseek,glm,qwen \
  --probes planner
```

录入模型输出：

```bash
node model-role-calibration/scripts/ingest-output.js \
  --run <run-id> \
  --case synthetic/event-reporting \
  --model kimi \
  --probe planner \
  --file model-role-calibration/runs/<run-id>/synthetic/event-reporting/agent-outputs/kimi-planner.json
```

如果输出是合法 JSON，会复制到 `outputs/normalized/`。如果不是合法 JSON，raw 文件仍会保存到 `outputs/raw/`，命令会报错，等待你手工修正。

创建人工评分文件：

```bash
node model-role-calibration/scripts/score-output.js \
  --run <run-id> \
  --case synthetic/event-reporting \
  --model kimi \
  --probe planner
```

手工填写生成的评分文件：

```text
model-role-calibration/runs/<run-id>/<case-id>/scores/<model>-<probe>.score.json
```

汇总一次 run：

```bash
node model-role-calibration/scripts/summarize-results.js --run <run-id>
```

生成报告：

```text
model-role-calibration/outputs/calibration-results.json
model-role-calibration/outputs/calibration-summary.md
model-role-calibration/outputs/model-role-map.md
```

## 标准执行流程

每次校准 run 都按这个流程执行。先从一个 case、一个模型、一个 probe 开始，不要一开始就批量跑完。

当前可通过以下入口自动完成 Step 1 和 Step 2：

```bash
npm run calibration:run
```

该入口当前只执行 prompt 生成和角色 Agent 批跑。自动录入、Codex CLI 评分和汇总将在各 probe 的 evaluate prompt 稳定后接入。

### Step 0：准备 Case 文件

先编辑 case 文件：

```text
model-role-calibration/cases/synthetic/event-reporting/inputs/planner.md
model-role-calibration/cases/synthetic/event-reporting/inputs/review.md
model-role-calibration/cases/synthetic/event-reporting/inputs/synthesis.md
model-role-calibration/cases/synthetic/event-reporting/rubric.md
```

三个输入文件分别服务于 Planner、Reviewer 和 Synthesizer。`rubric.md` 集中记录确定问题、高质量输出、典型误报和五项评分锚点。

### Step 1：生成 Prompt 和 Run ID

让工具自动生成 run id：

```bash
node model-role-calibration/scripts/generate-prompts.js \
  --case synthetic/event-reporting \
  --probes planner
```

命令会输出：

```text
Run ID: <run-id>
Generated prompts: model-role-calibration/runs/<run-id>/synthetic/event-reporting/prompts
```

记录 `<run-id>`。后续这个 run 的所有命令都使用同一个 `<run-id>`。

如果要为一个 case 生成全部 probe：

```bash
node model-role-calibration/scripts/generate-prompts.js \
  --case synthetic/event-reporting \
  --probes planner,risk,architecture,execution,rebuttal,synthesis
```

如果要把另一个 case 加入同一个 run：

```bash
node model-role-calibration/scripts/generate-prompts.js \
  --run <run-id> \
  --case synthetic/plugin-lifecycle \
  --probes planner,risk,architecture,execution,rebuttal,synthesis
```

### Step 2：运行角色 Agent

本轮只使用 `kimi`、`deepseek`、`glm`、`qwen` 四个 Claude Code wrapper，不运行 Codex。

schema 对应关系：

```text
planner -> planner-output.schema.json
risk -> risk-output.schema.json
architecture, execution, rebuttal -> model-output.schema.json
synthesis -> synthesis-output.schema.json
```

单个任务：

```bash
node model-role-calibration/scripts/run-model.js \
  --run <run-id> \
  --case synthetic/event-reporting \
  --model kimi \
  --probe planner
```

runner 通过交互式 zsh 解析 wrapper 别名，并以 `-p --output-format stream-json` 非交互运行 Claude Code。逐行事件会在 runner 内解析为 JSON 数组后归档，避免由 CLI 生成单个聚合 JSON 时触发输出截断。每次调用还会强制：

- 交互式 zsh 只负责解析 alias；实际 Claude Code 由 Node 直接启动，`.zshrc` 的 stdout 不会混入模型 JSON。
- 在新建的空临时目录运行。
- 使用 `--bare`，跳过 hooks、项目规则、auto-memory、plugin sync 和 CLAUDE.md 自动发现。
- 使用 `--setting-sources ""`，不加载 user/project/local 配置；wrapper 显式提供的 provider `--settings` 仍保留。
- 使用 `--strict-mcp-config` 且不提供 MCP 配置。
- 使用 `--tools ""`、`--disallowed-tools "mcp__*"` 和 `--disable-slash-commands`，禁止文件、shell、skill、MCP 等工具访问。
- 使用 `--permission-mode default`，避免 wrapper settings 意外改变权限模式。
- 使用最小校准 `--system-prompt`，只要求被测 agent 遵守 probe prompt；JSON 输出契约写在 prompt 模板中。
- 使用 `--max-turns 1`，限制为单轮非交互输出。
- 默认使用 `--no-session-persistence`，不保存或恢复会话。
- 使用 probe 对应的 `--json-schema`。
- 使用 `calibration.config.json` 中的 `agent_execution.timeout_ms` 限制单次调用；也可通过 `--timeout-ms <毫秒>` 临时覆盖。

禁用内置工具是当前校准协议的一部分。这个阶段评估的是模型在同一份 prompt 下生成结构化规划/审查结果的能力，而不是评估 coding agent 读取仓库、执行命令或修改文件的能力。禁用 Bash、Read、Edit 等工具可以确保所有模型只使用 prompt 中显式提供的材料，避免工作区副作用，减少非交互权限卡住，并让 wrapper 之间的结果更可比。如果后续需要评估真实 coding-agent 执行能力，应另开模式并显式定义最小工具集。

单任务运行时，runner 会把自身进度日志输出到 stderr，包括 alias 解析、实际命令摘要、临时 cwd、每 30 秒 heartbeat、退出状态和 attempt 文件路径。Claude Code stdout 仍只用于归档和 JSON 解析，不直接透传到终端。

开启 JSON validator 时，heartbeat 还会显示 validator MCP 日志状态，例如 `validatorLog=1234B calls=1 last=tool_call:schema:2`。如果模型仍在等待 LLM API 首次返回，通常只会看到 MCP 启动/工具列表日志，还不会出现 `tool_call`。

调试真实 wrapper 时，如果需要保留 Claude Code 会话供人工 `--resume` 检查，可以加：

```bash
node model-role-calibration/scripts/run-model.js \
  --run <run-id> \
  --case synthetic/event-reporting \
  --model deepseek \
  --probe planner \
  --persist-session
```

此模式会移除 `--no-session-persistence`，并添加可识别的 `--name mrc-<run-id>-<model>-<probe>`。正式评估不要使用该模式，避免会话状态影响结果。

如果需要评估“agent + JSON 校验工具”的生产表现，而不是模型原生输出 JSON 的能力，可以开启本地 MCP 校验工具：

```bash
node model-role-calibration/scripts/run-model.js \
  --run <run-id> \
  --case synthetic/event-reporting \
  --model qwen \
  --probe planner \
  --with-json-validator
```

此模式会：

- 加载 `scripts/json-validator-mcp.js` 作为唯一 MCP server。
- 保持 `--tools ""`，仍禁用 Bash、Read、Edit 等内置工具。
- 保持 `--strict-mcp-config`，只允许本次显式传入的 MCP。
- 不再传 `--disallowed-tools "mcp__*"`，否则 validator 工具也会被禁用。
- 显式传 `--allowed-tools "mcp__json_validator__validate_json_output"`，避免非交互模式下 tool 调用等待人工授权。
- 为每个 attempt 写入独立的 MCP JSONL 日志：`agent-outputs/attempts/<model>-<probe>/attempt-XXX.validator.log`。
- 将 `--max-turns` 从 `1` 提高到 `4`，允许 agent 调用 validator、修正错误并输出最终结果。

该模式仍由 runner 做最终 JSON 解析和 schema 校验。validator 只能让被测 agent 在最终回答前自我修正，不能替代 runner 的拒收边界。

输出写入：

```text
model-role-calibration/runs/<run-id>/<case-id>/agent-outputs/<model>-<probe>.cli.json
model-role-calibration/runs/<run-id>/<case-id>/agent-outputs/<model>-<probe>.json
model-role-calibration/runs/<run-id>/<case-id>/agent-outputs/<model>-<probe>.meta.json
model-role-calibration/runs/<run-id>/<case-id>/agent-outputs/attempts/<model>-<probe>/attempt-001.validator.log
model-role-calibration/runs/<run-id>/<case-id>/agent-outputs/attempts/<model>-<probe>/attempt-001.meta.json
```

每次失败、超时或格式错误都会保留一个递增的 attempt 记录。再次执行相同任务会创建下一个 attempt；成功结果存在时再次执行会直接跳过，避免重复调用和重复计费。

批量角色扮演使用固定容量为 3 的池：

```bash
node model-role-calibration/scripts/run-agent-pool.js \
  --run <run-id> \
  --cases synthetic/event-reporting \
  --models kimi,deepseek,glm,qwen \
  --probes planner,risk
```

调度规则：

1. `模型 × case × probe` 组成候选队列。
2. 运行池最多同时存在 3 个 agent。
3. 任一 agent 完成后，如果候选队列非空，立即补入下一个。
4. 候选队列为空时不再补充；重跑时若剩余任务少于 3 个，只启动实际剩余任务，不等待凑满并发数。
5. 候选队列和运行池都为空后，角色扮演结束。
6. 只要有任务失败，其他任务继续运行；池排空后命令以非零状态结束。
7. 修复临时问题后，可以在同一个 run 中重跑相同 pool；已有成功结果会跳过，失败任务会创建新 attempt。
8. 整个 harness 同时只允许一个 pool 进程，即使使用不同 run，也不会突破全局并发 3。

每次 pool 调用都有独立 batch 记录，累计索引记录整个 run 的执行状态：

```text
model-role-calibration/runs/<run-id>/agent-pool.json
model-role-calibration/runs/<run-id>/agent-pools/batch-<timestamp>.json
```

因此可以在同一个 run 中先执行 `planner`，再执行其他 probe，不会覆盖前一批记录。只有累计索引中的 `ready_for_evaluation` 为 `true` 时，才表示该 run 已请求的角色任务全部有成功结果。

### Step 3：录入模型输出

当前批次完全排空，并确认累计索引没有 `unresolved_jobs` 后，逐个录入可评分输出：

```bash
node model-role-calibration/scripts/ingest-output.js \
  --run <run-id> \
  --case synthetic/event-reporting \
  --model kimi \
  --probe planner \
  --file model-role-calibration/runs/<run-id>/synthetic/event-reporting/agent-outputs/kimi-planner.json
```

成功后会生成：

```text
model-role-calibration/runs/<run-id>/synthetic/event-reporting/outputs/raw/kimi-planner.json
model-role-calibration/runs/<run-id>/synthetic/event-reporting/outputs/normalized/kimi-planner.json
```

如果模型输出不是合法 JSON，raw 文件会保留，命令会报错。你需要手工修正输出，然后重新录入到一个新的 run，或明确清理坏的 run 产物后再录入。

### Step 4：创建评分文件

创建人工评分文件：

```bash
node model-role-calibration/scripts/score-output.js \
  --run <run-id> \
  --case synthetic/event-reporting \
  --model kimi \
  --probe planner
```

填写这个文件：

```text
model-role-calibration/runs/<run-id>/synthetic/event-reporting/scores/kimi-planner.score.json
```

评分时参考 case rubric：

```text
model-role-calibration/cases/synthetic/event-reporting/rubric.md
```

### Step 5：汇总 Run

至少填写一个 score 文件后，执行：

```bash
node model-role-calibration/scripts/summarize-results.js --run <run-id>
```

报告会写入：

```text
model-role-calibration/outputs/calibration-results.json
model-role-calibration/outputs/calibration-summary.md
model-role-calibration/outputs/model-role-map.md
```

### Step 6：逐步扩展

推荐扩展顺序：

1. 先用四个模型完成 `synthetic/event-reporting + planner`。
2. 再增加 `risk`、`architecture`、`execution`、`rebuttal` 和 `synthesis`。
3. 扩展到 `plugin-lifecycle` 和 `offline-drafts`，所有模型保持完全相同的 case/probe 覆盖。
4. 三个合成案例形成初步角色画像后，再用 `reqa/case-001` 做真实场景验证。

不要在评分口径稳定前一次性跑完全部 case、模型和 probe。

## 评分

每个维度 0 到 5 分：

- `hit_rate`
- `contract_closure`
- `actionability`
- `evidence_discipline`
- `false_positive_cost`

总分 25 分。

`false_positive_cost` 分数越高，表示误报越少、误报成本越低。

## 角色映射规则

本工具不做全局模型排行榜，只为当前规划/审查任务域生成角色映射草稿。

Probe 到角色的映射：

- `planner` -> A Planner
- `risk` -> D Risk Reviewer
- `architecture` -> B Architecture Reviewer
- `execution` -> C Execution Reviewer
- `synthesis` -> S Synthesizer
- `rebuttal` -> 通用批判能力辅助信号

如果评分数据不足或不稳定，生成的 `model-role-map.md` 会写“数据不足”，不会强行推荐模型。

正式推荐还必须同时满足：

- 模型完成 `calibration.config.json` 中全部 `primary_cases` 的对应 probe。
- 至少两个模型完成完全相同的 primary case 覆盖，才允许比较。
- 推荐模型在相同 case 集上的平均分达到配置门槛。
