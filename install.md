# Plan Review Harness 完整安装与使用

## 一、生成分发包

在 Harness 工程执行：

```
cd /Users/{user}/{folder}/plan-review-harness

npm run plan-review:package
```

生成文件：

```
model-role-calibration/dist/plan-review-harness-claude-code.tar.gz
```

分发时只需要提供这个压缩包。

## 二、解压并安装

需要先准备四份 settings：
```
/{real-path-to}/claude-settings/
├── kimi.json
├── deepseek.json
├── glm.json
└── qwen.json
```

json 格式参考:
```
{

    "env": {
        "ANTHROPIC_AUTH_TOKEN": "公司提供的token",
        "ANTHROPIC_BASE_URL": "https://ai-gateway-oa.lexincloud.com/litellm",
        "ANTHROPIC_MODEL": "模型名称"
    }
}
```

* 模型名称: "qwen3.7-max[1m]" | "deepseek-v4-pro[1m]" | "kimi-k2.6" | "glm-5.1" 

每份 settings 使用：

ANTHROPIC_AUTH_TOKEN: {公司提供的token}
ANTHROPIC_MODEL: kimi.json\deepseek.json\glm.json\qwen.json 分别配置 "kimi-k2.6"\"deepseek-v4-pro[1m]"\"glm-5.1"\"qwen3.7-max[1m]"

解压并安装：
```
tar -xzf plan-review-harness-claude-code.tar.gz

cd plan-review-harness-claude-code

./install.sh /{real-path-to}/claude-settings
```
你的本机命令是：
```
cd /Users/{user}/{folder}/plan-review-harness/model-role-calibration/dist

tar -xzf plan-review-harness-claude-code.tar.gz

cd plan-review-harness-claude-code

./install.sh /Users/{user}/{folder}/claude-settings
```
安装器会自动：

1. 校验四份 settings。
2. 校验 Claude Code CLI。
3. 安装 MCP runtime。
4. 直接安装 Plan Review Skill。
5. 注册用户级 plan-review-harness MCP。
6. 全程不调用模型。
7. 重复安装或升级时保留 `mcp/workspace-runs` 中的历史运行产物。

默认安装位置：

```
~/.claude/plan-review-harness/mcp
~/.claude/skills/plan-review
```

## 三、检查 MCP 注册

```
claude mcp get plan-review-harness
```

应能看到类似配置：

```
node ~/.claude/plan-review-harness/mcp/scripts/plan-review-mcp.js \
--settings-dir /Users/{user}/{folder}/claude-settings
```

也可以列出全部 MCP：

claude mcp list

## 四、重启 Claude Code

安装完成后，退出已有 Claude Code 会话，然后进入需要评审的工程：

cd /Users/{user}/{folder}/{project}

claude

必须从待评审工程目录启动，这样 MCP 才能获得正确的项目目录。

## 五、连接检查

在 Claude Code 中执行：

```text
/plan-review --check
```

该 Skill 会自动调用 `plan-review-harness` 的 `configuration_status`，只展示模型和角色路由，不会调用 `start_plan_review`，也不会调用任何模型。

预期结果应包含：

```text
risk: kimi
architecture: kimi
execution: kimi
rebuttal: glm
fact_check: glm
synthesis: glm
planner: kimi
```

同时确认：

```text
valid: true
auth_env: ANTHROPIC_AUTH_TOKEN
role_route_source.score_version: manual-v4
```

此步骤不会调用模型。

## 六、执行完整 Plan Review

### 标准使用流程

1. 先让 Claude Code 结合需求和当前工程规划实施计划。
2. 确认计划内容后，调用 `/plan-review` 进行只读审查。
3. 如果计划已经保存为 Markdown 文件，传入该文件的绝对路径。
4. 如果计划没有保存为文件，执行不带参数的 `/plan-review`，再按提示粘贴完整计划正文。
5. 等待四个 Reviewer、Fact Check 和 Synthesizer 完成审查。
6. 根据流程图、节点问题、人工决策和修订清单更新计划。
7. 计划通过审查后，再进入代码实现阶段。

Plan Review 只审查计划，不修改工程文件。

### 使用案例一：已有计划文档

先让 Claude Code 生成计划并保存为 Markdown 文件：

```text
请结合当前需求和工程代码制定实施计划。
只生成计划，不修改代码。
将计划保存为 Markdown 文件，完成后告诉我计划文件的绝对路径。
```

然后传入计划文件：

```
/plan-review /Users/guanchengqian/.claude/plans/twinkly-sauteeing-matsumoto.md
```

路径包含空格时使用引号：

```text
/plan-review "/Users/name/Documents/collector implementation plan.md"
```

带参数模式会始终将参数解释为计划文件路径，不会把参数当作计划正文。
Skill 不会先读取文件并把全文放进工具参数，而是只把路径作为
`plan_file` 交给 MCP。MCP 会直接校验并读取文件，可以减少长计划在 Claude Code
中的准备和参数渲染时间。

### 使用案例二：没有计划文档

先让 Claude Code 在当前会话中生成实施计划，但不要求写入文件：

```text
请结合当前需求和工程代码制定实施计划。
只输出完整计划，不修改代码。
```

计划生成后执行：

```text
/plan-review
```

Skill 会询问：

```text
请粘贴需要审查的完整计划正文。
```

粘贴 Claude Code 刚生成的完整计划。Skill 会直接使用这段正文启动审查，不需要创建临时 Markdown 文件。

不要把计划正文直接写在 `/plan-review` 命令后面。以下写法会被当作文件路径：

```text
/plan-review 修改 config.ts 并更新测试
```

Skill 会自动：

1. 读取计划文件，或接收用户粘贴的计划正文。
2. 使用当前 Claude Code 工程作为 project_root。
3. 启动四个 Reviewer。
4. 等待 MCP progress notification。
5. 启动 Fact Check，只校验 Reviewer 已给出的 evidence。
6. 启动 Synthesizer。Synthesizer 不读取工程目录，只基于计划、Reviewer JSON 和 Fact Check 报告合成。

Reviewer、Fact Check 和 Synthesizer 都必须按各自 schema 输出 JSON。每个阶段会调用
`mcp__json_validator__validate_json_output` 自检，并写入
`roles/<role>/validator.log`；runner 接收后仍会执行最终 schema 校验。

评审失败，或以 `completed + infra_errors` 返回但存在失败 Reviewer 时，可以使用
`retry_plan_review_stage` 断点续跑：

- `stage: "reviewers"`：只重跑失败或缺失的 Reviewer，随后继续 Fact Check 和 Synthesis。
- `stage: "fact_check"`：复用全部 Reviewer，重跑 Fact Check 和 Synthesis。
- `stage: "synthesis"`：复用 Reviewer 与 Fact Check，只重跑 Synthesis。

每个 Reviewer、Fact Check、Synthesis executor 最多重试 3 次。重试次数记录在
`state.json` 的 `retry_counts` 中，达到上限后会在调用模型前拒绝继续执行。
7. 输出流程图、节点问题、人工决策、可能误报和修订清单。

不需要再粘贴固定的 MCP 调用 prompt。

## 七、标准验证流程

1. 在目标项目的 Claude Code 中执行 `/plan-review <计划文件路径>`，或执行
   `/plan-review` 后粘贴计划正文。
2. 记录 `start_plan_review` 返回的 `run_id`。
3. 按 MCP 返回的 `next_action` 等待 `get_plan_review`，直到 `status=completed`。
4. 回到任意终端执行：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/verify-workspace-review-run.js \
  --run-id <run-id>
```

这一步不会调用模型，只读取本机已归档的运行产物并输出标准化检查报告。
如果你只想看“本次是否健康、接下来该做什么”，使用聚合诊断：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/doctor-workspace-review-run.js \
  --run-id <run-id>
```

## 八、运行过程

评审期间 Claude Code 应持续等待 get_plan_review，不需要手工执行：

sleep
Bash
Monitor
claude mcp call

每次评审的运行产物固定记录在：

```text
~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>/
```

其中 `state.json` 会记录本次 CC 所在项目的 `project_root`。通常你不需要额外提供
CC 当前运行项目路径；只有做跨项目效果对比或解释具体业务上下文时，建议同时提供项目路径。

如果需要人工诊断，可以在另一个终端查看日志：
```
tail -f ~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>/execution.log
```
正常情况下不需要执行该命令。

### 分析模型执行行为

每个 `cc -p` 角色的事件流都会归档在：

```text
~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>/roles/<role>/stdout.jsonl
```

该文件包含 session id、模型、工具调用、读取文件和最终结构化输出。优先使用
Harness 归档的 `stdout.jsonl`；`~/.claude/projects/` 下也可能存在 Claude Code
临时 session 日志，但它依赖临时 cwd，不作为稳定接口。

安装包内置只读诊断脚本：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/inspect-workspace-run.js \
  --run-dir ~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>
```

输出会列出每个角色的模型、耗时、prompt/output/stdout 大小、工具调用次数、
最大输入 token、读取边界、越界读取文件，以及读取过的文件列表。

标准化验证报告使用：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/verify-workspace-review-run.js \
  --run-id <run-id>
```

聚合诊断和下一步建议使用：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/doctor-workspace-review-run.js \
  --run-id <run-id>
```

如果需要机器可读输出：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/doctor-workspace-review-run.js \
  --run-id <run-id> \
  --json
```

旧版 runner 生成的历史 run 如果缺少 `run-manifest.json`，先显式补写 manifest：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/backfill-workspace-run-manifest.js \
  --run-id <run-id>
```

如果评审产物被移动到了其他目录，才使用 `--run-dir`：

```bash
node ~/.claude/plan-review-harness/mcp/scripts/verify-workspace-review-run.js \
  --run-dir /path/to/workspace-runs/<run-id>
```

报告会检查：

- run 是否 completed。
- completed 后 `report.json` 是否包含 `outcome`。
- `review-plan.md` 压缩指标是否存在。
- 四个 Reviewer 是否使用 scoped mirror，且无越界读取。
- Fact Check 是否完成、只使用 Read、是否有 strictness summary。
- Synthesis 是否没有工具、没有读取工程文件。
- `report.json` 和 `execution.log` 是否包含关键观测字段。

验证脚本的退出码语义：

- `0`：`PASS`，运行已完成且结构检查通过。
- `1`：`FAIL`，运行已完成但结构检查失败，或运行状态为 failed。
- `2`：`NOT_READY`，运行仍是 queued/running，等待 `get_plan_review` 完成后再验证。

如果报告出现 `infra_errors`，表示 Reviewer/模型输出或 harness 解析问题；它不是计划本身的阻塞结论，但说明本轮不是全角色健康审查。

把结果发给协作者时，优先提供：

- `run_id`。
- `verify-workspace-review-run.js --run-id <run-id>` 的 Markdown 输出。
- 如果检查失败，再提供 `--json` 输出。
- 如果要评估审查质量，再提供计划文件路径、实际项目路径，以及最终 `report.json` 中的
  `fact_check.summary` 和 `synthesis` 结论。

Reviewer 和 Fact Check 默认使用临时 scoped mirror：

- Reviewer 只复制 Plan 的 `Existing Code Refs` 章节明确列出的现有工程文件。
- `Existing Code Refs` 缺失或内容为 `None` 时，Reviewer 不会获得任何现有工程文件；
  `package.json`、`tsconfig.json` 等项目配置也不会被默认加入。
- Plan 其他章节提到、但未列入 `Existing Code Refs` 的路径不会被复制。
- Fact Check 只复制 Reviewer evidence 明确引用的文件，不自行搜索或扩展证据范围。
- 兼容保留的 `proposed-code/` artifact 只表示 Plan 中的未来代码草案，不属于现有工程事实。
- Claude Code 只获得该临时副本的 `--add-dir`。
- 每个角色的边界写入 `roles/<role>/read-scope.json`。
- `inspect-workspace-run.js` 会显示 `out_of_boundary_read_files`，用于观察是否仍发生越界读取。

Fact Check 会额外生成：

```text
roles/fact_check/fact-check-summary.json
```

其中包含 `strictness_signal`、`status_counts`、`evidence_status_counts`
和 `claim_support_counts`。如果长期都是 `all_verified`，说明裁判可能偏宽，需要继续收紧 prompt 或 schema。

### 审查版 Plan 压缩

为降低长计划的评审成本，runner 会在启动 Reviewer 前生成审查版计划：

```text
~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>/review-plan.md
~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>/plan-compaction.json
~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>/run-manifest.json
```

规则：

- 原始计划仍保存在 `request.json`。
- `run-manifest.json` 记录 declared runtime、workspace/input snapshot 和 resolved execution，用于复查“基于什么执行”和“实际发生了什么”。
- 传给 Reviewer、Fact Check 和 Synthesizer 的是 `review-plan.md`。
- 长代码块会压缩为 `pseudo` 摘要，保留接口、测试意图、关键流程和显式 TODO。
- `bash`、`sh`、`zsh`、`shell`、`mermaid` 代码块默认保留。
- `plan-compaction.json` 记录原始字符数、压缩后字符数、压缩代码块数量和节省字符数。

## 九、更新安装

拿到新版压缩包后，建议先卸载旧版本，再重新安装：

```bash
# 在旧版解压目录执行卸载
./uninstall.sh

# 解压新版压缩包
cd /path/to/new-package
tar -xzf plan-review-harness-claude-code.tar.gz
cd plan-review-harness-claude-code

# 重新安装
./install.sh /Users/{real-path-to}/claude-settings
```

安装器会更新 MCP runtime 和 Skill、重新注册 MCP，并保留已有
`~/.claude/plan-review-harness/mcp/workspace-runs`。

更新后重启 Claude Code。

## 十、卸载

在解压后的分发包目录执行：
```
./uninstall.sh
```
它会：

- 移除用户级 plan-review-harness MCP。
- 删除受安装器管理的 MCP runtime。
- 删除受安装器管理的 plan-review Skill。
- 不删除 settings 目录。
