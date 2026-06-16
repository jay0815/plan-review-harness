#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ROOT, parseArgs } = require("./lib");

const PACKAGE_NAME = "plan-review-harness-claude-code";
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "dist");
const RUNTIME_FILES = [
  "scripts/lib.js",
  "scripts/run-model.js",
  "scripts/workspace-review-lib.js",
  "scripts/run-workspace-review.js",
  "scripts/plan-review-mcp.js",
  "scripts/inspect-workspace-run.js",
  "scripts/verify-workspace-review-run.js",
  "prompts/probe-risk.md",
  "prompts/probe-architecture.md",
  "prompts/probe-execution.md",
  "prompts/probe-rebuttal.md",
  "prompts/probe-fact_check.md",
  "prompts/probe-synthesis.md",
  "schemas/risk-output.schema.json",
  "schemas/model-output.schema.json",
  "schemas/fact-check-output.schema.json",
  "schemas/synthesis-output.schema.json"
];
const SKILL_SOURCE = "claude-code/skills/plan-review/SKILL.md";

function installScript() {
  return `#!/bin/sh
set -eu

PACKAGE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SETTINGS_INPUT=\${1:-}
CLAUDE_ROOT=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}
CLAUDE_BIN=\${CLAUDE_BIN:-claude}
NODE_BIN=\${NODE_BIN:-node}
MCP_TARGET="$CLAUDE_ROOT/plan-review-harness/mcp"
SKILL_TARGET="$CLAUDE_ROOT/skills/plan-review"
OWNER_MARKER=".plan-review-harness-owned"
STAGING_ROOT="$CLAUDE_ROOT/.plan-review-harness-install-$$"

fail() {
  printf '安装失败：%s\\n' "$1" >&2
  exit 1
}

owned_or_absent() {
  target=$1
  if [ -e "$target" ] && [ ! -f "$target/$OWNER_MARKER" ]; then
    fail "目标目录已存在且不属于本安装器：$target"
  fi
}

[ -n "$SETTINGS_INPUT" ] || fail "用法：./install.sh /absolute/path/to/claude-settings"
[ -d "$SETTINGS_INPUT" ] || fail "settings 目录不存在：$SETTINGS_INPUT"
SETTINGS_DIR=$(CDPATH= cd -- "$SETTINGS_INPUT" && pwd -P)

for model in kimi deepseek glm qwen; do
  [ -f "$SETTINGS_DIR/$model.json" ] || fail "缺少 settings 文件：$SETTINGS_DIR/$model.json"
done

command -v "$NODE_BIN" >/dev/null 2>&1 || fail "找不到 Node.js：$NODE_BIN"
command -v "$CLAUDE_BIN" >/dev/null 2>&1 || fail "找不到 Claude Code CLI：$CLAUDE_BIN"

"$NODE_BIN" "$PACKAGE_ROOT/mcp/scripts/plan-review-mcp.js" \\
  --settings-dir "$SETTINGS_DIR" \\
  --claude-bin "$CLAUDE_BIN" \\
  --validate-only >/dev/null

owned_or_absent "$MCP_TARGET"
owned_or_absent "$SKILL_TARGET"

trap 'rm -rf "$STAGING_ROOT"' EXIT HUP INT TERM
mkdir -p "$STAGING_ROOT/mcp" "$STAGING_ROOT/skill"
cp -R "$PACKAGE_ROOT/mcp/." "$STAGING_ROOT/mcp/"
cp -R "$PACKAGE_ROOT/skill/plan-review/." "$STAGING_ROOT/skill/"
printf '%s\\n' "由 plan-review-harness install.sh 管理" > "$STAGING_ROOT/mcp/$OWNER_MARKER"
printf '%s\\n' "由 plan-review-harness install.sh 管理" > "$STAGING_ROOT/skill/$OWNER_MARKER"

mkdir -p "$(dirname -- "$MCP_TARGET")" "$(dirname -- "$SKILL_TARGET")"
if [ -d "$MCP_TARGET" ]; then
  rm -rf "$MCP_TARGET"
fi
if [ -d "$SKILL_TARGET" ]; then
  rm -rf "$SKILL_TARGET"
fi
mv "$STAGING_ROOT/mcp" "$MCP_TARGET"
mv "$STAGING_ROOT/skill" "$SKILL_TARGET"

"$NODE_BIN" "$MCP_TARGET/scripts/plan-review-mcp.js" \\
  --settings-dir "$SETTINGS_DIR" \\
  --claude-bin "$CLAUDE_BIN" \\
  --validate-only >/dev/null

if "$CLAUDE_BIN" mcp get plan-review-harness >/dev/null 2>&1; then
  "$CLAUDE_BIN" mcp remove --scope user plan-review-harness >/dev/null
fi

"$CLAUDE_BIN" mcp add --scope user plan-review-harness -- \\
  "$NODE_BIN" "$MCP_TARGET/scripts/plan-review-mcp.js" \\
  --settings-dir "$SETTINGS_DIR" \\
  --claude-bin "$CLAUDE_BIN"

printf '\\n安装完成。\\n'
printf 'MCP runtime：%s\\n' "$MCP_TARGET"
printf 'Skill：%s\\n' "$SKILL_TARGET"
printf 'Settings：%s\\n' "$SETTINGS_DIR"
printf '请重启 Claude Code，然后执行：/plan-review [计划文件路径]\\n'
`;
}

function uninstallScript() {
  return `#!/bin/sh
set -eu

CLAUDE_ROOT=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}
CLAUDE_BIN=\${CLAUDE_BIN:-claude}
MCP_TARGET="$CLAUDE_ROOT/plan-review-harness/mcp"
SKILL_TARGET="$CLAUDE_ROOT/skills/plan-review"
OWNER_MARKER=".plan-review-harness-owned"

if command -v "$CLAUDE_BIN" >/dev/null 2>&1 &&
  "$CLAUDE_BIN" mcp get plan-review-harness >/dev/null 2>&1; then
  "$CLAUDE_BIN" mcp remove --scope user plan-review-harness
fi

for target in "$MCP_TARGET" "$SKILL_TARGET"; do
  if [ -e "$target" ]; then
    if [ ! -f "$target/$OWNER_MARKER" ]; then
      printf '跳过非本安装器管理的目录：%s\\n' "$target" >&2
      continue
    fi
    rm -rf "$target"
    printf '已删除：%s\\n' "$target"
  fi
done
`;
}

function packageReadme() {
  return `# Plan Review Harness Claude Code 分发包

本包不使用 marketplace。

## 安装

\`\`\`bash
./install.sh /absolute/path/to/claude-settings
\`\`\`

settings 目录必须包含：

\`\`\`text
kimi.json
deepseek.json
glm.json
qwen.json
\`\`\`

安装器会：

1. 校验四份 settings 和 Claude Code CLI。
2. 将 MCP runtime 安装到 \`~/.claude/plan-review-harness/mcp\`。
3. 将 Skill 直接安装到 \`~/.claude/skills/plan-review\`。
4. 使用 \`claude mcp add --scope user\` 注册 \`plan-review-harness\`。

明确禁止在 settings 中配置 \`ANTHROPIC_API_KEY\`，只允许使用
\`ANTHROPIC_AUTH_TOKEN\`。

安装完成后重启 Claude Code，执行：

\`\`\`bash
cd /absolute/path/to/project
claude
\`\`\`

## 使用流程

1. 先让 Claude Code 根据需求和工程代码规划实施方案。
2. 确认实施计划内容。
3. 已保存为 Markdown 文件时，调用 \`/plan-review <文件路径>\`。
4. 未保存为文件时，调用空参数 \`/plan-review\`，再按提示粘贴完整计划正文。
5. 等待多角色审查、事实校验和合成结果。
6. 根据审查结果修订计划，通过后再进入代码实现。

Plan Review 只审查计划，不负责替代 Claude Code 生成计划，也不会修改工程文件。带参数模式始终把参数作为文件路径。
文件模式只向 MCP 传递 \`plan_file\` 路径，由 MCP 读取文件，避免 Claude Code 在调用前读取和渲染整份长计划。

执行流程为：Reviewer 先并发只读审查工程；Fact Check 随后只校验
Reviewer 已给出的 evidence；Synthesizer 最后只读取计划、Reviewer JSON
和 Fact Check 报告，不读取工程目录。

### 已有计划文档

\`\`\`text
/plan-review /absolute/path/to/plan.md
\`\`\`

路径包含空格时使用引号：

\`\`\`text
/plan-review "/absolute/path/to/implementation plan.md"
\`\`\`

Skill 不会先读取文件全文，而是直接把路径传给 MCP。

### 没有现成计划文档

先让 Claude Code 在当前会话生成计划，但不要求写入文件：

\`\`\`text
请结合当前需求和工程代码制定实施计划。
只生成计划，不修改代码。
\`\`\`

计划生成后执行：

\`\`\`text
/plan-review
\`\`\`

Skill 会询问：

\`\`\`text
请粘贴需要审查的完整计划正文。
\`\`\`

粘贴完整计划后，Skill 会直接使用正文启动审查，不需要创建临时文件。
不要把计划正文直接追加在 \`/plan-review\` 后面，因为带参数模式会将其解释为文件路径。

## 标准验证流程

1. 在目标项目的 Claude Code 中执行 \`/plan-review <计划文件路径>\`，或执行
   \`/plan-review\` 后粘贴计划正文。
2. 记录 \`start_plan_review\` 返回的 \`run_id\`。
3. 按 MCP 返回的 \`next_action\` 等待 \`get_plan_review\`，直到 \`status=completed\`。
4. 回到任意终端执行：

\`\`\`bash
node ~/.claude/plan-review-harness/mcp/scripts/verify-workspace-review-run.js \\
  --run-id <run-id>
\`\`\`

这一步不会调用模型，只读取本机已归档的运行产物并输出标准化检查报告。

## 诊断与提速

查看某次评审中各模型实际读取了哪些文件、调用了哪些工具：

\`\`\`bash
node ~/.claude/plan-review-harness/mcp/scripts/inspect-workspace-run.js \\
  --run-dir ~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>
\`\`\`

生成标准化验证报告：

\`\`\`bash
node ~/.claude/plan-review-harness/mcp/scripts/verify-workspace-review-run.js \\
  --run-id <run-id>
\`\`\`

机器可读 JSON：

\`\`\`bash
node ~/.claude/plan-review-harness/mcp/scripts/verify-workspace-review-run.js \\
  --run-id <run-id> \\
  --json
\`\`\`

默认日志和运行产物在 \`~/.claude/plan-review-harness/mcp/workspace-runs/<run-id>\`。
\`state.json\` 会记录启动评审时的 \`project_root\`，所以标准验证只需要 \`run_id\`。
只有评审产物被移动到非默认目录时，才使用 \`--run-dir /path/to/workspace-runs/<run-id>\`。
验证脚本退出码：\`0\` 表示 PASS，\`1\` 表示 FAIL，\`2\` 表示 NOT_READY。
新版本运行产物必须包含 \`report.json.outcome\`。如果报告出现 \`infra_errors\`，
表示 Reviewer/模型输出或 harness 解析问题，不是计划本身的阻塞结论。

Reviewer 和 Fact Check 默认使用 scoped mirror 硬隔离：runner 只复制计划或
evidence 明确引用的相对文件，以及少量项目配置文件到临时工程副本，并把该副本作为
Claude Code 的 \`--add-dir\`。每个角色会写入 \`roles/<role>/read-scope.json\`，
inspect 输出会标记 \`out_of_boundary_read_files\`。

Fact Check 会额外生成 \`roles/fact_check/fact-check-summary.json\`，其中包含
\`strictness_signal\`、\`status_counts\`、\`evidence_status_counts\` 和
\`claim_support_counts\`。如果长期都是 \`all_verified\`，说明裁判可能偏宽。

每次运行会生成：

\`\`\`text
review-plan.md
plan-compaction.json
\`\`\`

原始计划保存在 \`request.json\`。Reviewer、Fact Check 和 Synthesizer 使用 \`review-plan.md\`。
长代码块会被压缩为 \`pseudo\` 摘要，减少模型读取成本；命令和 Mermaid
代码块默认保留。

## 卸载

\`\`\`bash
./uninstall.sh
\`\`\`

卸载器只删除带本安装器所有权标记的目录。
`;
}

function copyFile(source, destination) {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Distribution source file does not exist: ${source}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function writeExecutable(file, content) {
  fs.writeFileSync(file, content, "utf8");
  fs.chmodSync(file, 0o755);
}

function createArchive(outputDir, packageDir) {
  const archiveFile = path.join(outputDir, `${PACKAGE_NAME}.tar.gz`);
  if (fs.existsSync(archiveFile)) {
    fs.rmSync(archiveFile);
  }
  const result = spawnSync("tar", [
    "-czf",
    archiveFile,
    "-C",
    outputDir,
    path.basename(packageDir)
  ], {
    encoding: "utf8"
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message || result.stderr.trim() || `exit ${result.status}`;
    throw new Error(`Unable to create distribution archive: ${reason}`);
  }
  return archiveFile;
}

function buildDistribution(options = {}) {
  const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT_DIR);
  const packageDir = path.join(outputDir, PACKAGE_NAME);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: false });

  for (const relativeFile of RUNTIME_FILES) {
    copyFile(
      path.join(ROOT, relativeFile),
      path.join(packageDir, "mcp", relativeFile)
    );
  }
  copyFile(
    path.join(ROOT, SKILL_SOURCE),
    path.join(packageDir, "skill", "plan-review", "SKILL.md")
  );
  fs.mkdirSync(path.join(packageDir, "mcp", "workspace-runs"), { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "mcp", "workspace-runs", ".gitkeep"),
    "",
    "utf8"
  );
  writeExecutable(path.join(packageDir, "install.sh"), installScript());
  writeExecutable(path.join(packageDir, "uninstall.sh"), uninstallScript());
  fs.writeFileSync(path.join(packageDir, "README.md"), packageReadme(), "utf8");

  const manifest = {
    name: PACKAGE_NAME,
    format_version: 1,
    generated_at: new Date().toISOString(),
    install_mode: {
      mcp: "claude mcp add --scope user",
      skill: "direct-copy"
    },
    files: [
      ...RUNTIME_FILES.map((file) => `mcp/${file}`),
      "mcp/workspace-runs/.gitkeep",
      "skill/plan-review/SKILL.md",
      "install.sh",
      "uninstall.sh",
      "README.md"
    ]
  };
  fs.writeFileSync(
    path.join(packageDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );

  return {
    outputDir,
    packageDir,
    archiveFile: options.createArchive === false
      ? null
      : createArchive(outputDir, packageDir)
  };
}

function main() {
  const args = parseArgs(process.argv);
  const result = buildDistribution({
    outputDir: args["output-dir"] && args["output-dir"] !== true
      ? String(args["output-dir"])
      : undefined,
    createArchive: args["no-archive"] !== true
  });
  console.log(`Distribution directory: ${result.packageDir}`);
  if (result.archiveFile) {
    console.log(`Distribution archive: ${result.archiveFile}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  PACKAGE_NAME,
  RUNTIME_FILES,
  SKILL_SOURCE,
  buildDistribution
};
