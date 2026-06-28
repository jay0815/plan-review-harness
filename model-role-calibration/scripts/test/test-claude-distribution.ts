#!/usr/bin/env node

import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { ROOT, isMainScript } from '../lib/lib.js'
import { PACKAGE_NAME, RUNTIME_FILES, buildDistribution } from '../cli/package-claude-distribution.js'

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function modelSettings(model: string) {
  return {
    env: {
      ANTHROPIC_BASE_URL: `https://${model}.example`,
      ...(model === 'kimi' ? {} : { ANTHROPIC_MODEL: `${model}-test` }),
      ANTHROPIC_AUTH_TOKEN: 'test-auth-token',
    },
  }
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-dist-test-'))
  try {
    const installDoc = fs.readFileSync(path.resolve(ROOT, '..', 'install.md'), 'utf8')
    assert(installDoc.includes('### 使用案例一：已有计划文档'))
    assert(installDoc.includes('### 使用案例二：没有计划文档'))
    assert(installDoc.includes('请粘贴需要审查的完整计划正文。'))
    assert(installDoc.includes('带参数模式会始终将参数解释为计划文件路径'))
    assert(installDoc.includes('## 七、标准验证流程'))
    assert(installDoc.includes('--run-id <run-id>'))
    assert(installDoc.includes('doctor-workspace-review-run.js'))
    assert(installDoc.includes('backfill-workspace-run-manifest.js'))
    assert(installDoc.includes('run-manifest.json'))
    assert(installDoc.includes('project_root'))
    assert(installDoc.includes('NOT_READY'))
    assert(installDoc.includes('outcome'))

    const outputDir = path.join(tempDir, 'dist')
    const result = buildDistribution({
      outputDir,
      createArchive: false,
    })
    assert.equal(result.packageDir, path.join(outputDir, PACKAGE_NAME))
    for (const file of RUNTIME_FILES) {
      assert(fs.statSync(path.join(result.packageDir, 'mcp', file)).isFile())
    }
    assert(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'workspace', 'inspect-workspace-run.js')))
    assert(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'workspace', 'verify-workspace-review-run.js')))
    assert(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'workspace', 'doctor-workspace-review-run.js')))
    assert(
      fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'workspace', 'backfill-workspace-run-manifest.js')),
    )
    assert(
      fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'workspace', 'retry-workspace-review-stage.js')),
    )
    assert(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'mcp', 'json-validator-mcp.js')))
    assert(fs.existsSync(path.join(result.packageDir, 'mcp', 'claude-plan-authoring.md')))
    const packagedAuthoringContract = fs.readFileSync(
      path.join(result.packageDir, 'mcp', 'claude-plan-authoring.md'),
      'utf8',
    )
    assert(packagedAuthoringContract.includes('决策完备'))
    assert(packagedAuthoringContract.includes('Repo-aware 生成顺序'))
    assert(packagedAuthoringContract.includes('禁止强制创建 Proposed Code Artifacts'))
    assert(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'workspace', 'plan-authoring-lint.js')))
    assert(fs.existsSync(path.join(result.packageDir, 'mcp', 'scripts', 'lib', 'workspace-review-manifest.js')))
    assert(fs.statSync(path.join(result.packageDir, 'skill', 'plan-review', 'SKILL.md')).isFile())
    const packagedSkill = fs.readFileSync(path.join(result.packageDir, 'skill', 'plan-review', 'SKILL.md'), 'utf8')
    assert(packagedSkill.includes('始终将其作为计划文件路径'))
    assert(packagedSkill.includes('只传 `plan_file: $ARGUMENTS`'))
    assert(packagedSkill.includes('请粘贴需要审查的完整计划正文。'))
    assert(packagedSkill.includes('不要求用户创建文件'))
    assert(packagedSkill.includes('--check'))
    assert(packagedSkill.includes('configuration_status'))
    assert(packagedSkill.includes('ANTHROPIC_AUTH_TOKEN'))
    assert(packagedSkill.includes('risk:       kimi'))
    assert(packagedSkill.includes('synthesis:  glm'))
    assert(packagedSkill.includes('planner:    kimi'))
    assert(packagedSkill.includes('role_route_source.score_version = manual-v4'))
    assert(!packagedSkill.includes('risk:       qwen'))
    assert(!packagedSkill.includes('planner:    deepseek'))
    assert(!packagedSkill.includes('\n  - Read\n'))
    const packagedReadme = fs.readFileSync(path.join(result.packageDir, 'README.md'), 'utf8')
    assert(packagedReadme.includes('已有计划文档'))
    assert(packagedReadme.includes('没有现成计划文档'))
    assert(packagedReadme.includes('带参数模式始终把参数作为文件路径'))
    assert(packagedReadme.includes('请粘贴需要审查的完整计划正文。'))
    assert(packagedReadme.includes('## 标准验证流程'))
    assert(packagedReadme.includes('inspect-workspace-run.js'))
    assert(packagedReadme.includes('verify-workspace-review-run.js'))
    assert(packagedReadme.includes('doctor-workspace-review-run.js'))
    assert(packagedReadme.includes('backfill-workspace-run-manifest.js'))
    assert(packagedReadme.includes('--run-id <run-id>'))
    assert(packagedReadme.includes('state.json'))
    assert(packagedReadme.includes('project_root'))
    assert(packagedReadme.includes('NOT_READY'))
    assert(packagedReadme.includes('report.json.outcome'))
    assert(packagedReadme.includes('plan-compaction.json'))
    assert(packagedReadme.includes('run-manifest.json'))
    assert(packagedReadme.includes('Fact Check'))
    assert(packagedReadme.includes('Synthesizer 最后只读取计划、Reviewer JSON'))
    assert(packagedReadme.includes('scoped mirror'))
    assert(packagedReadme.includes('Existing Code Refs'))
    assert(packagedReadme.includes('不会默认加入'))
    assert(packagedReadme.includes('不自行搜索或扩展证据范围'))
    assert(packagedReadme.includes('fact-check-summary.json'))
    assert(fs.existsSync(path.join(result.packageDir, 'mcp', 'prompts', 'probe-fact_check.md')))
    assert(fs.existsSync(path.join(result.packageDir, 'mcp', 'schemas', 'fact-check-output.schema.json')))
    assert(fs.statSync(path.join(result.packageDir, 'install.sh')).mode & 0o100)
    assert(!fs.existsSync(path.join(result.packageDir, 'mcp', 'runs')))
    assert(!fs.existsSync(path.join(result.packageDir, 'mcp', 'archive')))
    assert(!fs.existsSync(path.join(result.packageDir, 'mcp', 'examples')))

    const settingsDir = path.join(tempDir, 'settings')
    for (const model of ['kimi', 'deepseek', 'glm', 'qwen']) {
      writeJson(path.join(settingsDir, `${model}.json`), modelSettings(model))
    }

    const fakeBinDir = path.join(tempDir, 'bin')
    const fakeClaude = path.join(fakeBinDir, 'claude')
    const fakeLog = path.join(tempDir, 'claude.log')
    const fakeState = path.join(tempDir, 'claude-mcp-installed')
    fs.mkdirSync(fakeBinDir, { recursive: true })
    fs.writeFileSync(
      fakeClaude,
      `#!/bin/sh
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
`,
      'utf8',
    )
    fs.chmodSync(fakeClaude, 0o755)

    const claudeRoot = path.join(tempDir, '.claude')
    const install = spawnSync(path.join(result.packageDir, 'install.sh'), [settingsDir], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: claudeRoot,
        CLAUDE_BIN: fakeClaude,
        NODE_BIN: process.execPath,
        FAKE_CLAUDE_LOG: fakeLog,
        FAKE_CLAUDE_STATE: fakeState,
      },
    })
    assert.equal(install.status, 0, install.stderr || install.stdout)
    const installedMcp = path.join(claudeRoot, 'plan-review-harness', 'mcp')
    const installedSkill = path.join(claudeRoot, 'skills', 'plan-review')
    assert(fs.existsSync(path.join(installedMcp, '.plan-review-harness-owned')))
    assert(fs.existsSync(path.join(installedSkill, '.plan-review-harness-owned')))
    assert(fs.existsSync(path.join(installedSkill, 'SKILL.md')))
    assert(fs.existsSync(path.join(installedMcp, 'scripts', 'mcp', 'plan-review-mcp.js')))
    const preservedRun = path.join(installedMcp, 'workspace-runs', 'workspace-review-preserved')
    fs.mkdirSync(preservedRun, { recursive: true })
    fs.writeFileSync(path.join(preservedRun, 'state.json'), '{}\n', 'utf8')

    const reinstall = spawnSync(path.join(result.packageDir, 'install.sh'), [settingsDir], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: claudeRoot,
        CLAUDE_BIN: fakeClaude,
        NODE_BIN: process.execPath,
        FAKE_CLAUDE_LOG: fakeLog,
        FAKE_CLAUDE_STATE: fakeState,
      },
    })
    assert.equal(reinstall.status, 0, reinstall.stderr || reinstall.stdout)
    assert(fs.existsSync(path.join(preservedRun, 'state.json')))

    const claudeLog = fs.readFileSync(fakeLog, 'utf8')
    const canonicalSettingsDir = fs.realpathSync(settingsDir)
    assert(claudeLog.includes('mcp add --scope user plan-review-harness'))
    assert(claudeLog.includes('mcp remove --scope user plan-review-harness'))
    assert(claudeLog.includes(`--settings-dir ${canonicalSettingsDir}`))
    assert(!claudeLog.includes('test-auth-token'))

    const validate = spawnSync(
      process.execPath,
      [
        path.join(installedMcp, 'scripts', 'mcp', 'plan-review-mcp.js'),
        '--settings-dir',
        settingsDir,
        '--claude-bin',
        fakeClaude,
        '--validate-only',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          FAKE_CLAUDE_LOG: fakeLog,
          FAKE_CLAUDE_STATE: fakeState,
        },
      },
    )
    assert.equal(validate.status, 0, validate.stderr)
    const status = JSON.parse(validate.stdout)
    assert.equal(status.valid, true)
    assert.equal(status.roles.risk, 'kimi')
    assert.equal(status.roles.fact_check, 'glm')
    assert.equal(status.roles.synthesis, 'glm')
    assert.equal(status.roles.planner, 'kimi')
    assert.equal(status.role_route_source.score_version, 'manual-v4')
    assert.equal(status.role_route_source.model_role_map, 'model-role-calibration/outputs/model-role-map.md')
    assert.equal(status.models.kimi.auth_env, 'ANTHROPIC_AUTH_TOKEN')
    assert(!validate.stdout.includes('test-auth-token'))

    const uninstall = spawnSync(path.join(result.packageDir, 'uninstall.sh'), [], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: claudeRoot,
        CLAUDE_BIN: fakeClaude,
        FAKE_CLAUDE_LOG: fakeLog,
        FAKE_CLAUDE_STATE: fakeState,
      },
    })
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout)
    assert(!fs.existsSync(installedMcp))
    assert(!fs.existsSync(installedSkill))
    assert(!fs.existsSync(fakeState))

    console.log('Claude distribution tests passed.')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

if (isMainScript(__filename)) {
  main()
}
