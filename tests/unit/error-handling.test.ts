import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { LangGraphWorkflowRuntime, WorkflowError } from '../../src/graph/LangGraphWorkflowRuntime.js'
import { MockAgentWorkerAdapter } from '../../src/workers/MockAgentWorkerAdapter.js'
import type { AgentWorkerAdapter } from '../../src/workers/AgentWorkerAdapter.js'

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function cleanup(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

describe('WorkflowError and failed state persistence', () => {
  it('WorkflowError has stage and runId properties', () => {
    const error = new WorkflowError('test failed', { stage: 'blind_review', runId: 'run-123' })
    expect(error.message).toBe('test failed')
    expect(error.stage).toBe('blind_review')
    expect(error.runId).toBe('run-123')
    expect(error.name).toBe('WorkflowError')
    expect(error).toBeInstanceOf(Error)
  })

  it('start() saves failed state to disk when blindReview throws', async () => {
    const runRoot = await tempRoot('error-test-')
    try {
      // Create a worker that throws during blindReview
      const throwingReviewer: AgentWorkerAdapter = {
        kind: 'mock',
        role: 'architecture-reviewer',
        execute: async () => {
          throw new Error('simulated worker failure')
        },
      }

      const runtime = new LangGraphWorkflowRuntime({
        runDir: runRoot,
        maxRounds: 1,
        workers: [
          throwingReviewer,
          new MockAgentWorkerAdapter({ role: 'execution-reviewer', fixtureName: 'review.execution.json' }),
          new MockAgentWorkerAdapter({ role: 'risk-reviewer', fixtureName: 'review.risk.json' }),
          new MockAgentWorkerAdapter({ role: 'reviser', fixtureName: 'revision.json' }),
          new MockAgentWorkerAdapter({ role: 'regression', fixtureName: 'regression.round1.json' }),
        ],
      })

      await expect(
        runtime.start({
          requirementPath: 'fixtures/sample-requirement.md',
          initialPlanPath: 'fixtures/sample-plan.md',
          maxRounds: 1,
        }),
      ).rejects.toThrow(WorkflowError)

      // Find the run directory
      const dirs = await import('node:fs/promises').then((fs) => fs.readdir(runRoot))
      const runDir = dirs.find((d) => d.startsWith('run-'))
      expect(runDir).toBeDefined()

      const state = (await readJson(path.join(runRoot, runDir!, 'state.json'))) as {
        status: string
        errors: Array<{ stage: string; message: string; createdAt: string }>
      }

      expect(state.status).toBe('failed')
      expect(state.errors.length).toBeGreaterThan(0)
      expect(state.errors[0].stage).toBe('blind_review')
      expect(state.errors[0].message).toContain('simulated worker failure')
      expect(state.errors[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    } finally {
      await cleanup(runRoot)
    }
  })
})
