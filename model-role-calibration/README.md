# 模型角色校准工具

本目录是一个本地、半自动的模型角色校准工具，用于评估不同模型更适合承担哪些规划和审查角色。

第一版刻意不调用模型 API、不接 LangGraph、不实现多 agent 运行时。它只负责：

- 创建可编辑的校准 case。
- 生成标准化 probe prompt。
- 录入通过 CLI 手工跑出的模型输出。
- 创建人工评分文件。
- 汇总评分并生成草稿报告。

目标是先稳定校准协议，再考虑自动模型调用。

## 第一轮范围

初始 case：

- `reqa/case-001`
- `sdd/case-001`

初始候选模型：

- `Claude`
- `GLM`
- `Kimi`
- `DeepSeek`
- `GPT`

已知本地项目路径：

- reqa 旧方向：`/Users/guanchengqian/github/reqa`
- reqa 新方向：`/Users/guanchengqian/gitlab/tools/reqa`
- sdd preset 旧方向：`/Users/guanchengqian/gitlab/sdd-preset`
- sdd preset 新方向：`/Users/guanchengqian/gitlab/tools/sdd-preset`

脚本不会自动读取这些项目。只有在手工准备 `input.md`、`context.md` 和评分参考文件时，才需要使用这些路径。

## 目录结构

```text
model-role-calibration/
  cases/
  prompts/
  runs/
  schemas/
  scripts/
  outputs/
```

每个 case 包含：

```text
input.md
context.md
known-issues.md
expected-findings.md
expected-bad-findings.md
scoring-notes.md
```

只有 `input.md` 和 `context.md` 会注入到模型 prompt 中。其他文件只用于人工评分。

## 命令速查

创建 case：

```bash
node model-role-calibration/scripts/create-case.js --group reqa --id case-002
```

生成 prompt：

```bash
node model-role-calibration/scripts/generate-prompts.js \
  --case reqa/case-001 \
  --probes risk,architecture,execution,rebuttal,synthesis
```

命令会打印自动生成的 run id。prompt 会写入：

```text
model-role-calibration/runs/<run-id>/<case-id>/prompts/
```

模型调用在本工具外部完成。你可以用 Codex CLI、Claude Code wrapper 或其他 CLI 跑 prompt，然后把输出保存成本地文件。

录入模型输出：

```bash
node model-role-calibration/scripts/ingest-output.js \
  --run <run-id> \
  --case reqa/case-001 \
  --model Claude \
  --probe risk \
  --file ./claude-risk.json
```

如果输出是合法 JSON，会复制到 `outputs/normalized/`。如果不是合法 JSON，raw 文件仍会保存到 `outputs/raw/`，命令会报错，等待你手工修正。

创建人工评分文件：

```bash
node model-role-calibration/scripts/score-output.js \
  --run <run-id> \
  --case reqa/case-001 \
  --model Claude \
  --probe risk
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

### Step 0：准备 Case 文件

先编辑 case 文件：

```text
model-role-calibration/cases/reqa/case-001/input.md
model-role-calibration/cases/reqa/case-001/context.md
model-role-calibration/cases/reqa/case-001/known-issues.md
model-role-calibration/cases/reqa/case-001/expected-findings.md
model-role-calibration/cases/reqa/case-001/expected-bad-findings.md
model-role-calibration/cases/reqa/case-001/scoring-notes.md
```

`input.md` 和 `context.md` 会给被测试模型看。

其余四个文件是人工评分口径：

- `known-issues.md`：已经确认存在的问题。
- `expected-findings.md`：高质量模型回答中应该出现的好发现。
- `expected-bad-findings.md`：误报、错误方向、低价值发现。
- `scoring-notes.md`：本 case 如何打数值分。

### Step 1：生成 Prompt 和 Run ID

让工具自动生成 run id：

```bash
node model-role-calibration/scripts/generate-prompts.js \
  --case reqa/case-001 \
  --probes risk
```

命令会输出：

```text
Run ID: <run-id>
Generated prompts: model-role-calibration/runs/<run-id>/reqa/case-001/prompts
```

记录 `<run-id>`。后续这个 run 的所有命令都使用同一个 `<run-id>`。

如果要为一个 case 生成全部 probe：

```bash
node model-role-calibration/scripts/generate-prompts.js \
  --case reqa/case-001 \
  --probes risk,architecture,execution,rebuttal,synthesis
```

如果要把另一个 case 加入同一个 run：

```bash
node model-role-calibration/scripts/generate-prompts.js \
  --run <run-id> \
  --case sdd/case-001 \
  --probes risk,architecture,execution,rebuttal,synthesis
```

### Step 2：通过 CLI 跑一个模型

建议第一条先跑 `GPT + risk`。

Codex CLI：

```bash
codex exec \
  --cd /Users/guanchengqian/github/plan-review-harness \
  --sandbox read-only \
  --ephemeral \
  --output-schema model-role-calibration/schemas/model-output.schema.json \
  --output-last-message /tmp/gpt-risk.json \
  - < model-role-calibration/runs/<run-id>/reqa/case-001/prompts/risk.md
```

以下 probe 使用 `model-output.schema.json`：

```text
risk
architecture
execution
rebuttal
```

`synthesis` 使用 `synthesis-output.schema.json`：

```bash
codex exec \
  --cd /Users/guanchengqian/github/plan-review-harness \
  --sandbox read-only \
  --ephemeral \
  --output-schema model-role-calibration/schemas/synthesis-output.schema.json \
  --output-last-message /tmp/gpt-synthesis.json \
  - < model-role-calibration/runs/<run-id>/reqa/case-001/prompts/synthesis.md
```

Claude-Code-compatible wrapper 可以通过 pipe prompt 的方式运行：

```bash
cat model-role-calibration/runs/<run-id>/reqa/case-001/prompts/risk.md \
  | deepseek --bare -p "Return only the JSON object requested by the prompt. No markdown fences." \
  > /tmp/deepseek-risk.json
```

```bash
cat model-role-calibration/runs/<run-id>/reqa/case-001/prompts/risk.md \
  | glm --bare -p "Return only the JSON object requested by the prompt. No markdown fences." \
  > /tmp/glm-risk.json
```

```bash
cat model-role-calibration/runs/<run-id>/reqa/case-001/prompts/risk.md \
  | claude --bare -p "Return only the JSON object requested by the prompt. No markdown fences." \
  > /tmp/kimi-risk.json
```

录入时使用实际模型标签：

```text
GPT
DeepSeek
GLM
Kimi
Claude
```

### Step 3：录入模型输出

CLI 调用完成后，录入输出：

```bash
node model-role-calibration/scripts/ingest-output.js \
  --run <run-id> \
  --case reqa/case-001 \
  --model GPT \
  --probe risk \
  --file /tmp/gpt-risk.json
```

成功后会生成：

```text
model-role-calibration/runs/<run-id>/reqa/case-001/outputs/raw/GPT-risk.json
model-role-calibration/runs/<run-id>/reqa/case-001/outputs/normalized/GPT-risk.json
```

如果模型输出不是合法 JSON，raw 文件会保留，命令会报错。你需要手工修正输出，然后重新录入到一个新的 run，或明确清理坏的 run 产物后再录入。

### Step 4：创建评分文件

创建人工评分文件：

```bash
node model-role-calibration/scripts/score-output.js \
  --run <run-id> \
  --case reqa/case-001 \
  --model GPT \
  --probe risk
```

填写这个文件：

```text
model-role-calibration/runs/<run-id>/reqa/case-001/scores/GPT-risk.score.json
```

评分时参考 case rubric：

```text
model-role-calibration/cases/reqa/case-001/known-issues.md
model-role-calibration/cases/reqa/case-001/expected-findings.md
model-role-calibration/cases/reqa/case-001/expected-bad-findings.md
model-role-calibration/cases/reqa/case-001/scoring-notes.md
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

1. 先完成 `reqa/case-001 + GPT + risk`。
2. 再增加 `architecture`、`execution`、`rebuttal`。
3. 再用同一个 case 和 probe 增加其他模型。
4. 等已有多份 review 输出后，再跑 `synthesis`。
5. `reqa` 流程稳定后，再加入 `sdd/case-001`。

不要在评分口径稳定前一次性跑完全部 case、模型和 probe。

## 评分

每个维度 0 到 2 分：

- `hit_rate`
- `novel_value`
- `actionability`
- `evidence_discipline`
- `false_positive_cost`

总分 10 分。

`false_positive_cost` 分数越高，表示误报越少、误报成本越低。

## 角色映射规则

本工具不做全局模型排行榜，只为当前规划/审查任务域生成角色映射草稿。

Probe 到角色的映射：

- `risk` -> D Risk Reviewer
- `architecture` -> B Architecture Reviewer
- `execution` -> C Execution Reviewer
- `synthesis` -> S Synthesizer
- `rebuttal` -> 通用批判能力辅助信号

第一版没有独立 Planner probe，所以不要强行判断 Planner。

如果评分数据不足或不稳定，生成的 `model-role-map.md` 会写“数据不足”，不会强行推荐模型。
