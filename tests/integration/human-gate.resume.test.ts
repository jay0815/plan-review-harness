import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DecisionQueueSchema } from '../../src/schemas/index.js'
import { LangGraphWorkflowRuntime } from '../../src/graph/LangGraphWorkflowRuntime.js'
import { MockAgentWorkerAdapter } from '../../src/workers/MockAgentWorkerAdapter.js'

const createdAt = '2026-01-01T00:00:00.000Z'

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

async function writeFixture(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value))
}

async function writeHumanGateFixtures(fixtureDir: string): Promise<void> {
  await writeFixture(path.join(fixtureDir, 'architecture.json'), {
    reviewerId: 'architecture-reviewer',
    dimension: 'architecture',
    issues: [
      {
        id: 'ISSUE-L3',
        title: 'Architecture rollback blocker',
        dimension: 'architecture',
        type: 'risk',
        severity: 'blocker',
        confidence: 0.91,
        planRef: 'section:deployment',
        claim: 'Rollback is mandatory before rollout.',
        evidence: ['The plan does not define rollback trigger or owner.'],
        impact: 'A failed release may not be recoverable quickly.',
        suggestion: 'Add rollback trigger, owner, and steps.',
        sourceWorkerId: 'architecture-reviewer',
        createdAt,
      },
    ],
  })
  await writeFixture(path.join(fixtureDir, 'execution.json'), {
    reviewerId: 'execution-reviewer',
    dimension: 'execution',
    issues: [],
  })
  await writeFixture(path.join(fixtureDir, 'risk.json'), {
    reviewerId: 'risk-reviewer',
    dimension: 'risk',
    issues: [],
  })
  await writeFixture(path.join(fixtureDir, 'revision.json'), {
    planMarkdown: '# Revised plan\n\nRollback trigger and owner are defined.',
    revisionLog: {
      runId: 'run-placeholder',
      round: 1,
      adopted: [{ issueId: 'MERGED-ISSUE-L3', changeDescription: 'Added rollback path.' }],
      rejected: [],
      pendingDecision: [],
      createdAt,
    },
  })
  await writeFixture(path.join(fixtureDir, 'regression.round1.json'), {
    runId: 'run-placeholder',
    round: 1,
    checkedIssueIds: ['MERGED-ISSUE-L3'],
    results: [{ issueId: 'MERGED-ISSUE-L3', status: 'resolved', severity: 'blocker', summary: 'Resolved.' }],
    blockerCount: 0,
    highCount: 0,
    newIssueCount: 0,
    createdAt,
  })
}

describe('human gate resume', () => {
  it('pauses on L3 decision queue and resumes through final output', async () => {
    const runRoot = await tempRoot('human-gate-run-')
    const fixtureDir = await tempRoot('human-gate-fixtures-')
    const inputDir = await tempRoot('human-gate-input-')
    try {
      await writeHumanGateFixtures(fixtureDir)
      const requirementPath = path.join(inputDir, 'requirement.md')
      const planPath = path.join(inputDir, 'plan.md')
      await writeFile(requirementPath, '# Requirement\n')
      await writeFile(planPath, '# Initial plan\n')

      const runtime = new LangGraphWorkflowRuntime({
        runDir: runRoot,
        maxRounds: 2,
        workers: [
          new MockAgentWorkerAdapter({ role: 'architecture-reviewer', fixtureName: 'architecture.json', fixtureDir }),
          new MockAgentWorkerAdapter({ role: 'execution-reviewer', fixtureName: 'execution.json', fixtureDir }),
          new MockAgentWorkerAdapter({ role: 'risk-reviewer', fixtureName: 'risk.json', fixtureDir }),
          new MockAgentWorkerAdapter({ role: 'reviser', fixtureName: 'revision.json', fixtureDir }),
          new MockAgentWorkerAdapter({ role: 'regression', fixtureName: 'regression.round1.json', fixtureDir }),
        ],
      })

      const paused = await runtime.start({ requirementPath, initialPlanPath: planPath, maxRounds: 2 })

      expect(paused.status).toBe('waiting_for_decision')
      expect(paused.stage).toBe('human_gate')
      expect(paused.state.artifacts.decisionQueue?.path).toBe(
        path.join(runRoot, paused.runId, 'round-001', 'decisions', 'decision-queue.json'),
      )
      expect(existsSync(paused.state.artifacts.decisionQueue!.path)).toBe(true)
      const queue = DecisionQueueSchema.parse(
        JSON.parse(
          await import('node:fs/promises').then(({ readFile }) =>
            readFile(paused.state.artifacts.decisionQueue!.path, 'utf8'),
          ),
        ),
      )
      expect(queue.items).toHaveLength(1)

      const decisionsPath = path.join(inputDir, 'user-decisions.json')
      await writeFixture(decisionsPath, {
        decisions: [
          {
            decisionId: 'DECISION-ANSWER-1',
            itemId: queue.items[0]!.id,
            chosenKey: 'adopt',
            rationale: 'Rollback is required for release safety.',
            decidedAt: createdAt,
            decidedBy: 'test',
          },
        ],
      })

      const resumed = await runtime.resume(paused.runId, { decisionsPath })

      expect(resumed.status).toBe('completed')
      expect(resumed.stage).toBe('done')
      expect(existsSync(path.join(runRoot, paused.runId, 'round-001', 'decisions', 'user-decisions.json'))).toBe(true)
      expect(existsSync(path.join(runRoot, paused.runId, 'final', 'final-report.json'))).toBe(true)
    } finally {
      await cleanup(runRoot)
      await cleanup(fixtureDir)
      await cleanup(inputDir)
    }
  })
})
