import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { LangGraphWorkflowRuntime } from '../../src/graph/LangGraphWorkflowRuntime.js'
import { MockAgentWorkerAdapter } from '../../src/workers/MockAgentWorkerAdapter.js'
import type { Clock } from '../../src/utils/fs.js'

function createFixedClock(value: string): Clock {
  return { now: () => value }
}

function createDefaultWorkers() {
  return [
    new MockAgentWorkerAdapter({ role: 'architecture-reviewer', fixtureName: 'review.architecture.json' }),
    new MockAgentWorkerAdapter({ role: 'execution-reviewer', fixtureName: 'review.execution.json' }),
    new MockAgentWorkerAdapter({ role: 'risk-reviewer', fixtureName: 'review.risk.json' }),
    new MockAgentWorkerAdapter({ role: 'reviser', fixtureName: 'revision.json' }),
    new MockAgentWorkerAdapter({ role: 'regression', fixtureName: 'regression.round1.json' }),
  ]
}

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

describe('clock injection', () => {
  it('state.createdAt and state.updatedAt use injected clock, not hardcoded constant', async () => {
    const runRoot = await tempRoot('clock-test-')
    try {
      const fixedTime = '2030-06-15T10:30:00.000Z'
      const runtime = new LangGraphWorkflowRuntime({
        runDir: runRoot,
        maxRounds: 1,
        workers: createDefaultWorkers(),
        clock: createFixedClock(fixedTime),
      })

      const handle = await runtime.start({
        requirementPath: 'fixtures/sample-requirement.md',
        initialPlanPath: 'fixtures/sample-plan.md',
        maxRounds: 1,
      })

      const state = (await readJson(path.join(runRoot, handle.runId, 'state.json'))) as {
        createdAt: string
        updatedAt: string
      }

      expect(state.createdAt).toBe(fixedTime)
      expect(state.updatedAt).toBe(fixedTime)
      // 确认不再是硬编码常量
      expect(state.createdAt).not.toBe('2026-01-01T00:00:00.000Z')
    } finally {
      await cleanup(runRoot)
    }
  })

  it('artifact createdAt fields use injected clock', async () => {
    const runRoot = await tempRoot('clock-artifact-')
    try {
      const fixedTime = '2030-06-15T10:30:00.000Z'
      const runtime = new LangGraphWorkflowRuntime({
        runDir: runRoot,
        maxRounds: 1,
        workers: createDefaultWorkers(),
        clock: createFixedClock(fixedTime),
      })

      const handle = await runtime.start({
        requirementPath: 'fixtures/sample-requirement.md',
        initialPlanPath: 'fixtures/sample-plan.md',
        maxRounds: 1,
      })

      const roundDir = path.join(runRoot, handle.runId, 'round-001')

      // issue ledger
      const issueLedger = (await readJson(path.join(roundDir, 'ledgers', 'issue-ledger.json'))) as { createdAt: string }
      expect(issueLedger.createdAt).toBe(fixedTime)

      // convergence report
      const convergence = (await readJson(path.join(roundDir, 'convergence', 'convergence-report.json'))) as {
        createdAt: string
      }
      expect(convergence.createdAt).toBe(fixedTime)
    } finally {
      await cleanup(runRoot)
    }
  })
})
