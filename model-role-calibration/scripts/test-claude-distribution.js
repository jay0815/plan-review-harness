#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const lib_js_1 = require("./lib.js");
const package_claude_distribution_js_1 = require("./package-claude-distribution.js");
function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function modelSettings(model) {
    return {
        env: {
            ANTHROPIC_BASE_URL: `https://${model}.example`,
            ...(model === 'kimi' ? {} : { ANTHROPIC_MODEL: `${model}-test` }),
            ANTHROPIC_AUTH_TOKEN: 'test-auth-token',
        },
    };
}
function main() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-dist-test-'));
    try {
        const installDoc = fs.readFileSync(path.resolve(__dirname, '..', '..', 'install.md'), 'utf8');
        (0, node_assert_1.default)(installDoc.includes('### 使用案例一：已有计划文档'));
        (0, node_assert_1.default)(installDoc.includes('### 使用案例二：没有计划文档'));
        (0, node_assert_1.default)(installDoc.includes('请粘贴需要审查的完整计划正文。'));
        (0, node_assert_1.default)(installDoc.includes('带参数模式会始终将参数解释为计划文件路径'));
        (0, node_assert_1.default)(installDoc.includes('## 七、标准验证流程'));
        (0, node_assert_1.default)(installDoc.includes('--run-id <run-id>'));
        (0, node_assert_1.default)(installDoc.includes('doctor-workspace-review-run.js'));
        (0, node_assert_1.default)(installDoc.includes('backfill-workspace-run-manifest.js'));
        (0, node_assert_1.default)(installDoc.includes('run-manifest.json'));
        (0, node_assert_1.default)(installDoc.includes('project_root'));
        (0, node_assert_1.default)(installDoc.includes('NOT_READY'));
        (0, node_assert_1.default)(installDoc.includes('outcome'));
        const outputDir = path.join(tempDir, 'dist');
        const result = (0, package_claude_distribution_js_1.buildDistribution)({
            outputDir,
            createArchive: false,
        });
        node_assert_1.default.equal(result.packageDir, path.join(outputDir, package_claude_distribution_js_1.PACKAGE_NAME));
        for (const file of package_claude_distribution_js_1.RUNTIME_FILES) {
            (0, node_assert_1.default)(fs.statSync(path.join(result.packageDir, 'mcp', file)).isFile());
        }
        (0, node_assert_1.default)(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'inspect-workspace-run.js')));
        (0, node_assert_1.default)(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'verify-workspace-review-run.js')));
        (0, node_assert_1.default)(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'doctor-workspace-review-run.js')));
        (0, node_assert_1.default)(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'backfill-workspace-run-manifest.js')));
        (0, node_assert_1.default)(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'retry-workspace-review-stage.js')));
        (0, node_assert_1.default)(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'json-validator-mcp.js')));
        (0, node_assert_1.default)(fs.existsSync(path.join(result.packageDir, 'mcp', 'claude-plan-authoring.md')));
        const packagedAuthoringContract = fs.readFileSync(path.join(result.packageDir, 'mcp', 'claude-plan-authoring.md'), 'utf8');
        (0, node_assert_1.default)(packagedAuthoringContract.includes('决策完备'));
        (0, node_assert_1.default)(packagedAuthoringContract.includes('Repo-aware 生成顺序'));
        (0, node_assert_1.default)(packagedAuthoringContract.includes('禁止强制创建 Proposed Code Artifacts'));
        (0, node_assert_1.default)(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'plan-authoring-lint.js')));
        (0, node_assert_1.default)(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'workspace-review-manifest.js')));
        (0, node_assert_1.default)(fs.statSync(path.join(result.packageDir, 'skill', 'plan-review', 'SKILL.md')).isFile());
        const packagedSkill = fs.readFileSync(path.join(result.packageDir, 'skill', 'plan-review', 'SKILL.md'), 'utf8');
        (0, node_assert_1.default)(packagedSkill.includes('始终将其作为计划文件路径'));
        (0, node_assert_1.default)(packagedSkill.includes('只传 `plan_file: $ARGUMENTS`'));
        (0, node_assert_1.default)(packagedSkill.includes('请粘贴需要审查的完整计划正文。'));
        (0, node_assert_1.default)(packagedSkill.includes('不要求用户创建文件'));
        (0, node_assert_1.default)(packagedSkill.includes('--check'));
        (0, node_assert_1.default)(packagedSkill.includes('configuration_status'));
        (0, node_assert_1.default)(packagedSkill.includes('ANTHROPIC_AUTH_TOKEN'));
        (0, node_assert_1.default)(packagedSkill.includes('risk:       kimi'));
        (0, node_assert_1.default)(packagedSkill.includes('synthesis:  glm'));
        (0, node_assert_1.default)(packagedSkill.includes('planner:    kimi'));
        (0, node_assert_1.default)(packagedSkill.includes('role_route_source.score_version = manual-v4'));
        (0, node_assert_1.default)(!packagedSkill.includes('risk:       qwen'));
        (0, node_assert_1.default)(!packagedSkill.includes('planner:    deepseek'));
        (0, node_assert_1.default)(!packagedSkill.includes('\n  - Read\n'));
        const packagedReadme = fs.readFileSync(path.join(result.packageDir, 'README.md'), 'utf8');
        (0, node_assert_1.default)(packagedReadme.includes('已有计划文档'));
        (0, node_assert_1.default)(packagedReadme.includes('没有现成计划文档'));
        (0, node_assert_1.default)(packagedReadme.includes('带参数模式始终把参数作为文件路径'));
        (0, node_assert_1.default)(packagedReadme.includes('请粘贴需要审查的完整计划正文。'));
        (0, node_assert_1.default)(packagedReadme.includes('## 标准验证流程'));
        (0, node_assert_1.default)(packagedReadme.includes('inspect-workspace-run.js'));
        (0, node_assert_1.default)(packagedReadme.includes('verify-workspace-review-run.js'));
        (0, node_assert_1.default)(packagedReadme.includes('doctor-workspace-review-run.js'));
        (0, node_assert_1.default)(packagedReadme.includes('backfill-workspace-run-manifest.js'));
        (0, node_assert_1.default)(packagedReadme.includes('--run-id <run-id>'));
        (0, node_assert_1.default)(packagedReadme.includes('state.json'));
        (0, node_assert_1.default)(packagedReadme.includes('project_root'));
        (0, node_assert_1.default)(packagedReadme.includes('NOT_READY'));
        (0, node_assert_1.default)(packagedReadme.includes('report.json.outcome'));
        (0, node_assert_1.default)(packagedReadme.includes('plan-compaction.json'));
        (0, node_assert_1.default)(packagedReadme.includes('run-manifest.json'));
        (0, node_assert_1.default)(packagedReadme.includes('Fact Check'));
        (0, node_assert_1.default)(packagedReadme.includes('Synthesizer 最后只读取计划、Reviewer JSON'));
        (0, node_assert_1.default)(packagedReadme.includes('scoped mirror'));
        (0, node_assert_1.default)(packagedReadme.includes('Existing Code Refs'));
        (0, node_assert_1.default)(packagedReadme.includes('不会默认加入'));
        (0, node_assert_1.default)(packagedReadme.includes('不自行搜索或扩展证据范围'));
        (0, node_assert_1.default)(packagedReadme.includes('fact-check-summary.json'));
        (0, node_assert_1.default)(fs.existsSync(path.join(result.packageDir, 'mcp', 'prompts', 'probe-fact_check.md')));
        (0, node_assert_1.default)(fs.existsSync(path.join(result.packageDir, 'mcp', 'schemas', 'fact-check-output.schema.json')));
        (0, node_assert_1.default)(fs.statSync(path.join(result.packageDir, 'install.sh')).mode & 0o100);
        (0, node_assert_1.default)(!fs.existsSync(path.join(result.packageDir, 'mcp', 'runs')));
        (0, node_assert_1.default)(!fs.existsSync(path.join(result.packageDir, 'mcp', 'archive')));
        (0, node_assert_1.default)(!fs.existsSync(path.join(result.packageDir, 'mcp', 'examples')));
        const settingsDir = path.join(tempDir, 'settings');
        for (const model of ['kimi', 'deepseek', 'glm', 'qwen']) {
            writeJson(path.join(settingsDir, `${model}.json`), modelSettings(model));
        }
        const fakeBinDir = path.join(tempDir, 'bin');
        const fakeClaude = path.join(fakeBinDir, 'claude');
        const fakeLog = path.join(tempDir, 'claude.log');
        const fakeState = path.join(tempDir, 'claude-mcp-installed');
        fs.mkdirSync(fakeBinDir, { recursive: true });
        fs.writeFileSync(fakeClaude, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_CLAUDE_LOG"
if [ "\${1:-}" = "--version" ]; then
  printf 'Claude Code test\\n'
  exit 0
fi
if [ "\${1:-}" = "mcp" ] && [ "\${2:-}" = "get" ]; then
  [ -f "$FAKE_CLAUDE_STATE" ]
  exit
fi
if [ "\${1:-}" = "mcp" ] && [ "\${2:-}" = "remove" ]; then
  rm -f "$FAKE_CLAUDE_STATE"
  exit 0
fi
if [ "\${1:-}" = "mcp" ] && [ "\${2:-}" = "add" ]; then
  : > "$FAKE_CLAUDE_STATE"
  exit 0
fi
exit 0
`, 'utf8');
        fs.chmodSync(fakeClaude, 0o755);
        const claudeRoot = path.join(tempDir, '.claude');
        const install = (0, node_child_process_1.spawnSync)(path.join(result.packageDir, 'install.sh'), [settingsDir], {
            encoding: 'utf8',
            env: {
                ...process.env,
                CLAUDE_CONFIG_DIR: claudeRoot,
                CLAUDE_BIN: fakeClaude,
                NODE_BIN: process.execPath,
                FAKE_CLAUDE_LOG: fakeLog,
                FAKE_CLAUDE_STATE: fakeState,
            },
        });
        node_assert_1.default.equal(install.status, 0, install.stderr || install.stdout);
        const installedMcp = path.join(claudeRoot, 'plan-review-harness', 'mcp');
        const installedSkill = path.join(claudeRoot, 'skills', 'plan-review');
        (0, node_assert_1.default)(fs.existsSync(path.join(installedMcp, '.plan-review-harness-owned')));
        (0, node_assert_1.default)(fs.existsSync(path.join(installedSkill, '.plan-review-harness-owned')));
        (0, node_assert_1.default)(fs.existsSync(path.join(installedSkill, 'SKILL.md')));
        (0, node_assert_1.default)(fs.existsSync(path.join(installedMcp, 'scripts', 'plan-review-mcp.js')));
        const preservedRun = path.join(installedMcp, 'workspace-runs', 'workspace-review-preserved');
        fs.mkdirSync(preservedRun, { recursive: true });
        fs.writeFileSync(path.join(preservedRun, 'state.json'), '{}\n', 'utf8');
        const reinstall = (0, node_child_process_1.spawnSync)(path.join(result.packageDir, 'install.sh'), [settingsDir], {
            encoding: 'utf8',
            env: {
                ...process.env,
                CLAUDE_CONFIG_DIR: claudeRoot,
                CLAUDE_BIN: fakeClaude,
                NODE_BIN: process.execPath,
                FAKE_CLAUDE_LOG: fakeLog,
                FAKE_CLAUDE_STATE: fakeState,
            },
        });
        node_assert_1.default.equal(reinstall.status, 0, reinstall.stderr || reinstall.stdout);
        (0, node_assert_1.default)(fs.existsSync(path.join(preservedRun, 'state.json')));
        const claudeLog = fs.readFileSync(fakeLog, 'utf8');
        const canonicalSettingsDir = fs.realpathSync(settingsDir);
        (0, node_assert_1.default)(claudeLog.includes('mcp add --scope user plan-review-harness'));
        (0, node_assert_1.default)(claudeLog.includes('mcp remove --scope user plan-review-harness'));
        (0, node_assert_1.default)(claudeLog.includes(`--settings-dir ${canonicalSettingsDir}`));
        (0, node_assert_1.default)(!claudeLog.includes('test-auth-token'));
        const validate = (0, node_child_process_1.spawnSync)(process.execPath, [
            path.join(installedMcp, 'scripts', 'plan-review-mcp.js'),
            '--settings-dir',
            settingsDir,
            '--claude-bin',
            fakeClaude,
            '--validate-only',
        ], {
            encoding: 'utf8',
            env: {
                ...process.env,
                FAKE_CLAUDE_LOG: fakeLog,
                FAKE_CLAUDE_STATE: fakeState,
            },
        });
        node_assert_1.default.equal(validate.status, 0, validate.stderr);
        const status = JSON.parse(validate.stdout);
        node_assert_1.default.equal(status.valid, true);
        node_assert_1.default.equal(status.roles.risk, 'kimi');
        node_assert_1.default.equal(status.roles.fact_check, 'glm');
        node_assert_1.default.equal(status.roles.synthesis, 'glm');
        node_assert_1.default.equal(status.roles.planner, 'kimi');
        node_assert_1.default.equal(status.role_route_source.score_version, 'manual-v4');
        node_assert_1.default.equal(status.role_route_source.route_file, 'model-role-calibration/default-role-routes.json');
        node_assert_1.default.equal(status.models.kimi.auth_env, 'ANTHROPIC_AUTH_TOKEN');
        (0, node_assert_1.default)(!validate.stdout.includes('test-auth-token'));
        const uninstall = (0, node_child_process_1.spawnSync)(path.join(result.packageDir, 'uninstall.sh'), [], {
            encoding: 'utf8',
            env: {
                ...process.env,
                CLAUDE_CONFIG_DIR: claudeRoot,
                CLAUDE_BIN: fakeClaude,
                FAKE_CLAUDE_LOG: fakeLog,
                FAKE_CLAUDE_STATE: fakeState,
            },
        });
        node_assert_1.default.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
        (0, node_assert_1.default)(!fs.existsSync(installedMcp));
        (0, node_assert_1.default)(!fs.existsSync(installedSkill));
        (0, node_assert_1.default)(!fs.existsSync(fakeState));
        console.log('Claude distribution tests passed.');
    }
    finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
if ((0, lib_js_1.isMainScript)(__filename)) {
    main();
}
