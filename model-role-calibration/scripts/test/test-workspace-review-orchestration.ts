#!/usr/bin/env node

import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { ROOT, nodeScriptArgs, parseJsonFile, runtimeScript } from '../lib/lib.js'
import { createRunManifest } from '../workspace-review-manifest.js'

type JsonRecord = Record<string, unknown>

interface WorkspaceRequestFixture extends JsonRecord {
  run_id: string
  created_at: string
  project_root: string
  plan: string
  context: string
  roles: string[]
}

interface WorkspaceState extends JsonRecord {
  status?: string
  error?: string
  infra_errors?: Array<{
    role?: string
    model?: string
    type?: string
    message?: string
  }>
  report_file?: string | null
}

interface RunManifest extends JsonRecord {
  status?: string
  finished_at?: string
  infra_errors?: WorkspaceState['infra_errors']
  error?: string
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function runNode(script: string, args: string[], env: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, nodeScriptArgs(script, ...args), {
    cwd: path.resolve(ROOT, '..'),
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      ...env,
    },
  })
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-review-orchestration-'))
  const fakeClaude = path.join(tempDir, 'fake-claude.mjs')
  const settingsFile = path.join(tempDir, 'settings', 'fake.json')
  const configFile = path.join(tempDir, 'workspace-review.json')
  const projectRoot = path.join(tempDir, 'project')
  const runDir = path.join(tempDir, 'workspace-runs', 'reviewer-failure')
  const runWorkspaceReview = runtimeScript('workspace/run-workspace-review')
  const retryWorkspaceReview = runtimeScript('workspace/retry-workspace-review-stage')

  fs.writeFileSync(
    fakeClaude,
    `#!/usr/bin/env node
const configIndex = process.argv.indexOf("--mcp-config");
if (process.argv.includes("--version")) {
  process.stdout.write("fake-claude 1.0.0\\n");
  process.exit(0);
}
let role = "unknown";
if (configIndex >= 0) {
  const mcpConfig = JSON.parse(process.argv[configIndex + 1]);
  role = mcpConfig.mcpServers.json_validator.env.MODEL_ROLE_CALIBRATION_PROBE;
}
for await (const _chunk of process.stdin) {
  // Drain stdin so the parent never sees EPIPE on short fake runs.
}
if (role === "architecture" && process.env.FAKE_FAIL_ARCHITECTURE === "1") {
  process.stderr.write("simulated architecture reviewer failure\\n");
  process.exit(7);
}
const outputByRole = {
  risk: {
    probe: "risk",
    issues: [],
    missing_questions: [],
    false_positive_risks: []
  },
  architecture: {
    probe: "architecture",
    issues: [],
    missing_questions: [],
    false_positive_risks: []
  },
  fact_check: {
    probe: "fact_check",
    checked_issues: [],
    source_summaries: [],
    limits: []
  },
  synthesis: {
    probe: "synthesis",
    source_findings: [],
    process_map: {
      title: "retry test",
      mermaid: "flowchart TD\\n  A[Retry]",
      nodes: [
        {
          id: "A",
          label: "Retry",
          stage: "test",
          status: "normal",
          related_issue_titles: [],
          evidence: "No retained findings."
        }
      ]
    },
    consensus_issues: [],
    disagreements: [],
    likely_false_positives: [],
    revision_instructions: []
  }
};
const output = outputByRole[role] || {
  probe: role,
  issues: [],
  missing_questions: [],
  false_positive_risks: []
};
process.stdout.write(JSON.stringify({ type: "system", subtype: "init" }) + "\\n");
process.stdout.write(JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "ok",
  structured_output: output
}) + "\\n");
`,
    'utf8',
  )
  fs.chmodSync(fakeClaude, 0o755)

  try {
    fs.mkdirSync(projectRoot, { recursive: true })
    fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Test Project\n', 'utf8')
    writeJson(settingsFile, {
      env: {
        ANTHROPIC_BASE_URL: 'https://fake.example',
        ANTHROPIC_AUTH_TOKEN: 'test-token',
      },
    })
    writeJson(configFile, {
      version: 1,
      claude_bin: fakeClaude,
      workspace_runs_dir: path.join(tempDir, 'workspace-runs'),
      models: {
        fake: {
          settings_file: settingsFile,
          required_env: ['ANTHROPIC_BASE_URL'],
        },
      },
      roles: {
        risk: 'fake',
        architecture: 'fake',
        execution: 'fake',
        rebuttal: 'fake',
        fact_check: 'fake',
        synthesis: 'fake',
        planner: 'fake',
      },
      execution: {
        max_concurrency: 2,
        timeout_ms: 5000,
        max_buffer_bytes: 1024 * 1024,
        max_turns: 2,
        compact_plan: false,
        isolate_reviewers: false,
      },
    })

    const request: WorkspaceRequestFixture = {
      run_id: 'reviewer-failure',
      created_at: '2026-06-28T00:00:00.000Z',
      project_root: projectRoot,
      plan: ['# Test Plan', '', '## Goal', '', 'Review runner failure handling.'].join('\n'),
      context: '',
      roles: ['risk', 'architecture'],
    }
    fs.mkdirSync(runDir, { recursive: true })
    writeJson(path.join(runDir, 'request.json'), request)
    createRunManifest(parseJsonFile(configFile), request, runDir, {
      createdAt: request.created_at,
    })

    let result = runNode(runWorkspaceReview, ['--run-dir', runDir, '--config', configFile], {
      FAKE_FAIL_ARCHITECTURE: '1',
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Reviewer stage failed before fact_check/)
    assert.match(result.stderr, /architecture\/fake/)
    assert.match(result.stderr, /simulated architecture reviewer failure|exit 7/)

    const state = parseJsonFile<WorkspaceState>(path.join(runDir, 'state.json'))
    assert.equal(state.status, 'failed')
    assert.equal(state.report_file, null)
    assert.match(state.error || '', /Reviewer stage failed before fact_check/)
    assert.equal(state.infra_errors?.length, 1)
    assert.equal(state.infra_errors?.[0]?.role, 'architecture')
    assert.equal(state.infra_errors?.[0]?.model, 'fake')
    assert.equal(state.infra_errors?.[0]?.type, 'agent_failed')

    const manifest = parseJsonFile<RunManifest>(path.join(runDir, 'run-manifest.json'))
    assert.equal(manifest.status, 'failed')
    assert.match(manifest.error || '', /Reviewer stage failed before fact_check/)
    assert.equal(manifest.infra_errors?.[0]?.role, 'architecture')

    assert.equal(parseJsonFile<WorkspaceState>(path.join(runDir, 'roles', 'risk', 'metadata.json')).status, 'completed')
    assert.equal(
      parseJsonFile<WorkspaceState>(path.join(runDir, 'roles', 'architecture', 'metadata.json')).status,
      'failed',
    )
    assert(!fs.existsSync(path.join(runDir, 'roles', 'fact_check')))
    assert(!fs.existsSync(path.join(runDir, 'roles', 'synthesis')))
    assert(!fs.existsSync(path.join(runDir, 'report.json')))

    const executionLog = fs.readFileSync(path.join(runDir, 'execution.log'), 'utf8')
    assert.match(executionLog, /reviewers_failed/)
    assert.match(executionLog, /run_failed/)
    assert(!executionLog.includes('fact_check_started'))
    assert(!executionLog.includes('synthesis_started'))

    result = runNode(retryWorkspaceReview, ['--run-dir', runDir, '--config', configFile, '--stage', 'reviewers'])
    assert.equal(result.status, 0, result.stderr)
    const retryResult = JSON.parse(result.stdout) as {
      status: string
      retried_reviewers: string[]
      retry_counts: Record<string, number>
    }
    assert.equal(retryResult.status, 'completed')
    assert.deepEqual(retryResult.retried_reviewers, ['architecture'])
    assert.equal(retryResult.retry_counts.risk, 0)
    assert.equal(retryResult.retry_counts.architecture, 1)

    const retriedState = parseJsonFile<WorkspaceState>(path.join(runDir, 'state.json'))
    assert.equal(retriedState.status, 'completed')
    assert.equal(retriedState.report_file, 'report.json')
    assert.deepEqual(retriedState.infra_errors, [])

    const retriedManifest = parseJsonFile<RunManifest>(path.join(runDir, 'run-manifest.json'))
    assert.equal(retriedManifest.status, 'completed')
    assert.equal(retriedManifest.infra_errors?.length || 0, 0)

    assert(!fs.existsSync(path.join(runDir, 'roles', 'risk-attempts')))
    assert.equal(fs.readdirSync(path.join(runDir, 'roles', 'architecture-attempts')).length, 1)
    assert.equal(
      parseJsonFile<WorkspaceState>(path.join(runDir, 'roles', 'architecture', 'metadata.json')).status,
      'completed',
    )
    assert.equal(
      parseJsonFile<WorkspaceState>(path.join(runDir, 'roles', 'fact_check', 'metadata.json')).status,
      'completed',
    )
    assert.equal(
      parseJsonFile<WorkspaceState>(path.join(runDir, 'roles', 'synthesis', 'metadata.json')).status,
      'completed',
    )
    assert(fs.existsSync(path.join(runDir, 'report.json')))

    const retriedExecutionLog = fs.readFileSync(path.join(runDir, 'execution.log'), 'utf8')
    assert.match(retriedExecutionLog, /stage_retry_started/)
    assert.match(retriedExecutionLog, /stage_retry_completed/)

    console.log('Workspace review orchestration tests passed')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main()
