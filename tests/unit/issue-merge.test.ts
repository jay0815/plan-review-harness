import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { LangGraphWorkflowRuntime } from '../../src/graph/LangGraphWorkflowRuntime.js'
import { MockAgentWorkerAdapter } from '../../src/workers/MockAgentWorkerAdapter.js'
import type { AgentWorkerAdapter, AgentWorkerTask, AgentWorkerContext } from '../../src/workers/AgentWorkerAdapter.js'
import { DecisionQueueSchema, IssueLedgerSchema } from '../../src/schemas/index.js'

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

function createReviewerAdapter(role: string, issues: unknown[]): AgentWorkerAdapter {
  return {
    kind: 'mock' as const,
    role: role as AgentWorkerAdapter['role'],
    async execute(_task: AgentWorkerTask, _ctx: AgentWorkerContext) {
      return { reviewerId: role, dimension: role.replace('-reviewer', ''), issues }
    },
  }
}

describe('issue merge — consensus detection', () => {
  it('groups identical issues from different reviewers into consensus', async () => {
    const runRoot = await tempRoot('merge-test-')
    try {
      const sameIssue = {
        id: 'ISSUE-1',
        title: 'Missing rollback plan',
        dimension: 'architecture',
        type: 'risk',
        severity: 'blocker',
        confidence: 0.9,
        planRef: 'section:deploy',
        claim: 'No rollback.',
        evidence: ['Plan has no rollback section.'],
        impact: 'Cannot recover from failure.',
        suggestion: 'Add rollback.',
        createdAt: fixedTime,
      }

      const runtime = new LangGraphWorkflowRuntime({
        runDir: runRoot,
        maxRounds: 1,
        clock: { now: () => fixedTime },
        workers: [
          createReviewerAdapter('architecture-reviewer', [{ ...sameIssue, sourceWorkerId: 'architecture-reviewer' }]),
          createReviewerAdapter('execution-reviewer', [
            { ...sameIssue, id: 'ISSUE-2', sourceWorkerId: 'execution-reviewer' },
          ]),
          createReviewerAdapter('risk-reviewer', []),
          new MockAgentWorkerAdapter({ role: 'reviser', fixtureName: 'revision.json' }),
          new MockAgentWorkerAdapter({ role: 'regression', fixtureName: 'regression.round1.json' }),
        ],
      })

      const handle = await runtime.start({
        requirementPath: 'fixtures/sample-requirement.md',
        initialPlanPath: 'fixtures/sample-plan.md',
        maxRounds: 1,
      })

      // Should pause at human_gate (blocker issues)
      expect(handle.status).toBe('waiting_for_decision')

      // Check issue ledger — should have 1 merged issue, not 2
      const issueLedgerPath = path.join(runRoot, handle.runId, 'round-001', 'ledgers', 'issue-ledger.json')
      const ledger = IssueLedgerSchema.parse(JSON.parse(await readFile(issueLedgerPath, 'utf8')))
      expect(ledger.issues).toHaveLength(1)
      expect(ledger.issues[0].status).toBe('consensus')
      expect(ledger.issues[0].supportedBy).toContain('architecture-reviewer')
      expect(ledger.issues[0].supportedBy).toContain('execution-reviewer')

      // Decision queue should have 1 item, not 2
      const queuePath = handle.state.artifacts.decisionQueue!.path
      const queue = DecisionQueueSchema.parse(JSON.parse(await readFile(queuePath, 'utf8')))
      expect(queue.items).toHaveLength(1)
    } finally {
      await cleanup(runRoot)
    }
  })

  it('keeps single-point issues as single_point', async () => {
    const runRoot = await tempRoot('merge-single-')
    try {
      const runtime = new LangGraphWorkflowRuntime({
        runDir: runRoot,
        maxRounds: 1,
        clock: { now: () => fixedTime },
        workers: [
          createReviewerAdapter('architecture-reviewer', [
            {
              id: 'ISSUE-A',
              title: 'Unique architecture issue',
              dimension: 'architecture',
              type: 'risk',
              severity: 'blocker',
              confidence: 0.9,
              planRef: 'section:1',
              claim: 'Claim A',
              evidence: ['Evidence A.'],
              impact: 'Impact A.',
              suggestion: 'Fix A.',
              createdAt: fixedTime,
              sourceWorkerId: 'architecture-reviewer',
            },
          ]),
          createReviewerAdapter('execution-reviewer', []),
          createReviewerAdapter('risk-reviewer', []),
          new MockAgentWorkerAdapter({ role: 'reviser', fixtureName: 'revision.json' }),
          new MockAgentWorkerAdapter({ role: 'regression', fixtureName: 'regression.round1.json' }),
        ],
      })

      const handle = await runtime.start({
        requirementPath: 'fixtures/sample-requirement.md',
        initialPlanPath: 'fixtures/sample-plan.md',
        maxRounds: 1,
      })

      const issueLedgerPath = path.join(runRoot, handle.runId, 'round-001', 'ledgers', 'issue-ledger.json')
      const ledger = IssueLedgerSchema.parse(JSON.parse(await readFile(issueLedgerPath, 'utf8')))
      expect(ledger.issues).toHaveLength(1)
      expect(ledger.issues[0].status).toBe('single_point')
      expect(ledger.issues[0].supportedBy).toEqual(['architecture-reviewer'])
    } finally {
      await cleanup(runRoot)
    }
  })
})
