import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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

async function writeMultiRoundFixtures(fixtureDir: string): Promise<void> {
  for (const [fileName, reviewerId, dimension] of [
    ['architecture.json', 'architecture-reviewer', 'architecture'],
    ['execution.json', 'execution-reviewer', 'execution'],
    ['risk.json', 'risk-reviewer', 'risk'],
  ] as const) {
    await writeFixture(path.join(fixtureDir, fileName), {
      reviewerId,
      dimension,
      issues: [
        {
          id: `ISSUE-${dimension}`,
          title: `${dimension} high issue`,
          dimension,
          type: 'risk',
          severity: 'high',
          confidence: 0.82,
          planRef: 'section:deployment',
          claim: 'The plan needs another review round.',
          evidence: ['The plan is intentionally incomplete in round one.'],
          impact: 'The plan remains risky.',
          suggestion: 'Revise and re-check.',
          sourceWorkerId: reviewerId,
          createdAt,
        },
      ],
    })
  }

  await writeFixture(path.join(fixtureDir, 'revision.json'), {
    planMarkdown: '# Revised plan\n\nRound-specific risks are addressed.',
    revisionLog: {
      runId: 'run-placeholder',
      round: 1,
      adopted: [{ issueId: 'MERGED-ISSUE-architecture', changeDescription: 'Added missing deployment checks.' }],
      rejected: [],
      pendingDecision: [],
      createdAt,
    },
  })
  await writeFixture(path.join(fixtureDir, 'regression.round1.json'), {
    runId: 'run-placeholder',
    round: 1,
    checkedIssueIds: ['MERGED-ISSUE-architecture'],
    results: [{ issueId: 'MERGED-ISSUE-architecture', status: 'unresolved', severity: 'high', summary: 'Still high.' }],
    blockerCount: 0,
    highCount: 1,
    newIssueCount: 0,
    createdAt,
  })
  await writeFixture(path.join(fixtureDir, 'regression.round2.json'), {
    runId: 'run-placeholder',
    round: 2,
    checkedIssueIds: ['MERGED-ISSUE-architecture'],
    results: [{ issueId: 'MERGED-ISSUE-architecture', status: 'resolved', severity: 'high', summary: 'Resolved.' }],
    blockerCount: 0,
    highCount: 0,
    newIssueCount: 0,
    createdAt,
  })
}

describe('multi-round convergence', () => {
  it('continues to round 2 when round 1 regression still has high issues', async () => {
    const runRoot = await tempRoot('convergence-run-')
    const fixtureDir = await tempRoot('convergence-fixtures-')
    const inputDir = await tempRoot('convergence-input-')
    try {
      await writeMultiRoundFixtures(fixtureDir)
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

      const handle = await runtime.start({ requirementPath, initialPlanPath: planPath, maxRounds: 2 })

      expect(handle.status).toBe('completed')
      expect(handle.stage).toBe('done')
      expect(handle.state.round).toBe(2)
      expect(handle.state.artifacts.regressionReport?.path).toBe(
        path.join(runRoot, handle.runId, 'round-002', 'regression', 'regression-report.json'),
      )
      expect(existsSync(path.join(runRoot, handle.runId, 'round-001', 'regression', 'regression-report.json'))).toBe(
        true,
      )
      expect(existsSync(path.join(runRoot, handle.runId, 'round-002', 'regression', 'regression-report.json'))).toBe(
        true,
      )
      expect(existsSync(path.join(runRoot, handle.runId, 'round-001', 'convergence', 'convergence-report.json'))).toBe(
        true,
      )
      expect(existsSync(path.join(runRoot, handle.runId, 'round-002', 'convergence', 'convergence-report.json'))).toBe(
        true,
      )
      expect(existsSync(path.join(runRoot, handle.runId, 'final', 'final-report.json'))).toBe(true)
    } finally {
      await cleanup(runRoot)
      await cleanup(fixtureDir)
      await cleanup(inputDir)
    }
  })
})
