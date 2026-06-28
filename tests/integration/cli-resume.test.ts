import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/index.js'
import { LangGraphWorkflowRuntime } from '../../src/graph/LangGraphWorkflowRuntime.js'
import { MockAgentWorkerAdapter } from '../../src/workers/MockAgentWorkerAdapter.js'
import { DecisionQueueSchema } from '../../src/schemas/index.js'

const fixedTime = '2026-01-01T00:00:00.000Z'

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function cleanup(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value))
}

async function createPausedRun(runDir: string): Promise<{ runId: string; decisionsPath: string; inputDir: string }> {
  const fixtureDir = await tempRoot('cli-resume-fixtures-')
  const inputDir = await tempRoot('cli-resume-input-')

  // Write blocker fixture so run pauses at human_gate
  await writeJson(path.join(fixtureDir, 'review.architecture.json'), {
    reviewerId: 'architecture-reviewer',
    dimension: 'architecture',
    issues: [
      {
        id: 'ISSUE-L3',
        title: 'Blocker',
        dimension: 'architecture',
        type: 'risk',
        severity: 'blocker',
        confidence: 0.9,
        planRef: 'section:1',
        claim: 'Blocker claim',
        evidence: ['Evidence.'],
        impact: 'Impact.',
        suggestion: 'Fix.',
        createdAt: fixedTime,
      },
    ],
  })
  await writeJson(path.join(fixtureDir, 'review.execution.json'), {
    reviewerId: 'execution-reviewer',
    dimension: 'execution',
    issues: [],
  })
  await writeJson(path.join(fixtureDir, 'review.risk.json'), {
    reviewerId: 'risk-reviewer',
    dimension: 'risk',
    issues: [],
  })
  await writeJson(path.join(fixtureDir, 'revision.json'), {
    planMarkdown: '# Revised',
    revisionLog: { runId: 'x', round: 1, adopted: [], rejected: [], pendingDecision: [], createdAt: fixedTime },
  })
  await writeJson(path.join(fixtureDir, 'regression.round1.json'), {
    runId: 'x',
    round: 1,
    checkedIssueIds: [],
    results: [],
    blockerCount: 0,
    highCount: 0,
    newIssueCount: 0,
    createdAt: fixedTime,
  })

  const requirementPath = path.join(inputDir, 'requirement.md')
  const planPath = path.join(inputDir, 'plan.md')
  await writeFile(requirementPath, '# Requirement\n')
  await writeFile(planPath, '# Plan\n')

  const runtime = new LangGraphWorkflowRuntime({
    runDir,
    maxRounds: 2,
    workers: [
      new MockAgentWorkerAdapter({
        role: 'architecture-reviewer',
        fixtureName: 'review.architecture.json',
        fixtureDir,
      }),
      new MockAgentWorkerAdapter({ role: 'execution-reviewer', fixtureName: 'review.execution.json', fixtureDir }),
      new MockAgentWorkerAdapter({ role: 'risk-reviewer', fixtureName: 'review.risk.json', fixtureDir }),
      new MockAgentWorkerAdapter({ role: 'reviser', fixtureName: 'revision.json', fixtureDir }),
      new MockAgentWorkerAdapter({ role: 'regression', fixtureName: 'regression.round1.json', fixtureDir }),
    ],
  })

  const handle = await runtime.start({ requirementPath, initialPlanPath: planPath, maxRounds: 2 })
  expect(handle.status).toBe('waiting_for_decision')

  // Read decision queue to build valid decisions
  const queuePath = handle.state.artifacts.decisionQueue!.path
  const queue = DecisionQueueSchema.parse(JSON.parse(await readFile(queuePath, 'utf8')))
  const decisionsPath = path.join(inputDir, 'user-decisions.json')
  await writeJson(decisionsPath, {
    decisions: queue.items.map((item) => ({
      decisionId: `decision-${item.id}`,
      itemId: item.id,
      chosenKey: 'adopt',
      decidedAt: fixedTime,
      decidedBy: 'test',
    })),
  })

  return { runId: handle.runId, decisionsPath, inputDir }
}

describe('plan-review CLI resume', () => {
  it('resumes a paused run via CLI', async () => {
    const runDir = await tempRoot('cli-resume-')
    try {
      const { runId, decisionsPath, inputDir } = await createPausedRun(runDir)

      const output: string[] = []
      const exitCode = await runCli(
        ['node', 'plan-review', 'resume', '--run-id', runId, '--decisions', decisionsPath, '--run-dir', runDir],
        { stdout: (line) => output.push(line), stderr: (line) => output.push(line) },
      )
      const stdout = output.join('\n')

      expect(exitCode).toBe(0)
      expect(stdout).toContain(`Run resumed: ${runId}`)
      expect(stdout).toContain('Status: completed')
      expect(existsSync(path.join(runDir, runId, 'final', 'final-report.json'))).toBe(true)

      await cleanup(inputDir)
    } finally {
      await cleanup(runDir)
    }
  })

  it('exits non-zero when --run-id is missing', async () => {
    const output: string[] = []
    const exitCode = await runCli(['node', 'plan-review', 'resume', '--decisions', '/tmp/decisions.json'], {
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
    })
    expect(exitCode).toBe(1)
    expect(output.join('\n')).toContain('--run-id is required')
  })

  it('exits non-zero when --decisions is missing', async () => {
    const output: string[] = []
    const exitCode = await runCli(['node', 'plan-review', 'resume', '--run-id', 'run-xxx'], {
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
    })
    expect(exitCode).toBe(1)
    expect(output.join('\n')).toContain('--decisions is required')
  })

  it('exits non-zero for unsupported command', async () => {
    const output: string[] = []
    const exitCode = await runCli(['node', 'plan-review', 'unknown'], {
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
    })
    expect(exitCode).toBe(1)
    expect(output.join('\n')).toContain('Unsupported command')
  })
})
