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

在 Claude Code 中输入：

调用 plan-review-harness 的 configuration_status。
只展示模型和角色路由，不要调用 start_plan_review。

预期结果应包含：

risk: qwen
architecture: kimi
execution: kimi
rebuttal: glm
synthesis: kimi
planner: deepseek

同时确认：
```
valid: true
auth_env: ANTHROPIC_AUTH_TOKEN
```
此步骤不会调用模型。

## 六、执行完整 Plan Review

### 标准使用流程

1. 先让 Claude Code 结合需求和当前工程规划实施计划。
2. 确认计划内容后，调用 `/plan-review` 进行只读审查。
3. 如果计划已经保存为 Markdown 文件，传入该文件的绝对路径。
4. 如果计划没有保存为文件，执行不带参数的 `/plan-review`，再按提示粘贴完整计划正文。
5. 等待四个 Reviewer 和 Synthesizer 完成审查。
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
5. 启动 Synthesizer。
6. 输出流程图、节点问题、人工决策、可能误报和修订清单。

不需要再粘贴固定的 MCP 调用 prompt。

## 七、运行过程

评审期间 Claude Code 应持续等待 get_plan_review，不需要手工执行：

sleep
Bash
Monitor
claude mcp call

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
最大输入 token，以及读取过的文件列表。

### 审查版 Plan 压缩

为降低长计划的评审成本，runner 会在启动 Reviewer 前生成审查版计划：

```text
~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>/review-plan.md
~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>/plan-compaction.json
```

规则：

- 原始计划仍保存在 `request.json`。
- 传给 Reviewer 和 Synthesizer 的是 `review-plan.md`。
- 长代码块会压缩为 `pseudo` 摘要，保留接口、测试意图、关键流程和显式 TODO。
- `bash`、`sh`、`zsh`、`shell`、`mermaid` 代码块默认保留。
- `plan-compaction.json` 记录原始字符数、压缩后字符数、压缩代码块数量和节省字符数。

## 八、更新安装

拿到新版压缩包后重新解压并执行：
```
./install.sh /Users/guanchengqian/gitlab/claude-settings
```
安装器会更新 MCP runtime 和 Skill，并重新注册 MCP。

更新后重启 Claude Code。

## 九、卸载

在解压后的分发包目录执行：
```
./uninstall.sh
```
它会：

- 移除用户级 plan-review-harness MCP。
- 删除受安装器管理的 MCP runtime。
- 删除受安装器管理的 plan-review Skill。
- 不删除 settings 目录。
