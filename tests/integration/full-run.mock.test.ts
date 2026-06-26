import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { LangGraphWorkflowRuntime } from '../../src/graph/LangGraphWorkflowRuntime.js'
import { MockAgentWorkerAdapter } from '../../src/workers/MockAgentWorkerAdapter.js'
import { DecisionQueueSchema, DisagreementLedgerSchema, IssueLedgerSchema } from '../../src/schemas/index.js'
import { ConvergenceReportSchema } from '../../src/schemas/regression.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

describe('full mock run artifact contract', () => {
  it('writes stable core workflow artifacts even when decision queue is empty', async () => {
    const runRoot = await tempRoot('full-run-')
    try {
      const runtime = new LangGraphWorkflowRuntime({
        runDir: runRoot,
        maxRounds: 2,
        workers: [
          new MockAgentWorkerAdapter({ role: 'architecture-reviewer', fixtureName: 'review.architecture.json' }),
          new MockAgentWorkerAdapter({ role: 'execution-reviewer', fixtureName: 'review.execution.json' }),
          new MockAgentWorkerAdapter({ role: 'risk-reviewer', fixtureName: 'review.risk.json' }),
          new MockAgentWorkerAdapter({ role: 'reviser', fixtureName: 'revision.json' }),
          new MockAgentWorkerAdapter({ role: 'regression', fixtureName: 'regression.round1.json' }),
        ],
      })

      const handle = await runtime.start({
        requirementPath: 'fixtures/sample-requirement.md',
        initialPlanPath: 'fixtures/sample-plan.md',
        maxRounds: 2,
      })

      const roundDir = path.join(runRoot, handle.runId, 'round-001')
      const issueLedgerPath = path.join(roundDir, 'ledgers', 'issue-ledger.json')
      const disagreementLedgerPath = path.join(roundDir, 'ledgers', 'disagreement-ledger.json')
      const decisionQueuePath = path.join(roundDir, 'decisions', 'decision-queue.json')
      const convergenceReportPath = path.join(roundDir, 'convergence', 'convergence-report.json')

      expect(existsSync(issueLedgerPath)).toBe(true)
      expect(existsSync(disagreementLedgerPath)).toBe(true)
      expect(existsSync(decisionQueuePath)).toBe(true)
      expect(existsSync(convergenceReportPath)).toBe(true)

      expect(IssueLedgerSchema.parse(await readJson(issueLedgerPath))).toMatchObject({
        runId: handle.runId,
        round: 1,
      })
      expect(DisagreementLedgerSchema.parse(await readJson(disagreementLedgerPath))).toMatchObject({
        runId: handle.runId,
        round: 1,
      })
      const queue = DecisionQueueSchema.parse(await readJson(decisionQueuePath))
      expect(queue).toMatchObject({ runId: handle.runId, round: 1 })
      expect(queue.items).toEqual([])
      expect(ConvergenceReportSchema.parse(await readJson(convergenceReportPath))).toMatchObject({
        runId: handle.runId,
        round: 1,
        converged: true,
        nextAction: 'done',
        blockerCount: 0,
        highCount: 0,
        roundLimitReached: false,
      })

      for (const role of ['architecture-reviewer', 'execution-reviewer', 'risk-reviewer', 'reviser', 'regression']) {
        const workerDir = path.join(roundDir, 'workers', role)
        expect(existsSync(path.join(workerDir, 'task', 'task.md'))).toBe(true)
        expect(existsSync(path.join(workerDir, 'task', 'input-manifest.json'))).toBe(true)
        expect(existsSync(path.join(workerDir, 'task', 'output-schema.json'))).toBe(true)
        expect(existsSync(path.join(workerDir, 'input'))).toBe(true)
        expect(existsSync(path.join(workerDir, 'output', 'result.json'))).toBe(true)
        expect(existsSync(path.join(workerDir, 'logs', 'stdout.log'))).toBe(true)
        expect(existsSync(path.join(workerDir, 'logs', 'stderr.log'))).toBe(true)
        expect(existsSync(path.join(workerDir, 'meta', 'run-result.json'))).toBe(true)

        const runResult = await readJson(path.join(workerDir, 'meta', 'run-result.json'))
        expect(runResult).toMatchObject({
          runId: handle.runId,
          round: 1,
          role,
          kind: 'mock',
          status: 'success',
          startedAt: expect.any(String),
          finishedAt: expect.any(String),
        })

        const output = await readJson(path.join(workerDir, 'output', 'result.json'))
        expect(output).toMatchObject({
          meta: {
            runId: handle.runId,
            round: 1,
            role,
            producedBy: role,
            createdAt: expect.any(String),
          },
          result: expect.any(Object),
        })
      }

      const state = await readJson(path.join(runRoot, handle.runId, 'state.json'))
      expect(state).toMatchObject({
        artifacts: {
          requirement: { producedBy: 'loadInput' },
          currentPlan: { producedBy: 'reviser' },
          issueLedger: { producedBy: 'synthesis' },
          disagreementLedger: { producedBy: 'synthesis' },
          decisionQueue: { producedBy: 'autoResolve' },
          revisionLog: { producedBy: 'reviser' },
          regressionReport: { producedBy: 'regression' },
          convergenceReport: { producedBy: 'convergenceCheck' },
          finalReport: { producedBy: 'finalOutput' },
        },
      })
      const parsedState = state as { confirmedIssues?: Array<Record<string, unknown>> }
      expect(parsedState.confirmedIssues?.length).toBeGreaterThan(0)
      for (const issueRef of parsedState.confirmedIssues ?? []) {
        expect(Object.keys(issueRef).sort()).toEqual(['issueId', 'ledgerPath', 'round', 'severity', 'status'])
        expect(issueRef).not.toHaveProperty('claim')
        expect(issueRef).not.toHaveProperty('evidence')
        expect(issueRef).not.toHaveProperty('suggestion')
      }
      const serializedConfirmedIssues = JSON.stringify(parsedState.confirmedIssues)
      expect(serializedConfirmedIssues).not.toContain('claim')
      expect(serializedConfirmedIssues).not.toContain('evidence')
      expect(serializedConfirmedIssues).not.toContain('suggestion')
    } finally {
      await cleanup(runRoot)
    }
  })
})
