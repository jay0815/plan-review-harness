import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { MockAgentWorkerAdapter } from '../../src/workers/MockAgentWorkerAdapter.js'
import type { AgentWorkerContext } from '../../src/workers/AgentWorkerAdapter.js'

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

function makeContext(runDir: string, role: string): AgentWorkerContext {
  const runId = 'run-test'
  const round = 1
  const workerDir = path.join(runDir, runId, `round-001`, 'workers', role)
  return {
    runId,
    round,
    nodeName: 'test',
    role: role as AgentWorkerContext['role'],
    runDir: path.join(runDir, runId),
    workerDir,
    inputDir: path.join(workerDir, 'input'),
    outputDir: path.join(workerDir, 'output'),
    logDir: path.join(workerDir, 'logs'),
  }
}

describe('MockAgentWorkerAdapter', () => {
  it('does NOT write result.json — that is the caller responsibility', async () => {
    const runDir = await tempRoot('adapter-no-result-')
    try {
      const adapter = new MockAgentWorkerAdapter({
        role: 'architecture-reviewer',
        fixtureName: 'review.architecture.json',
      })
      const context = makeContext(runDir, 'architecture-reviewer')

      await adapter.execute({ taskId: 'test-task', type: 'review_plan', input: {} }, context)

      // result.json should NOT exist — adapter no longer writes it
      const resultPath = path.join(context.outputDir, 'result.json')
      expect(existsSync(resultPath)).toBe(false)

      // meta files should still exist
      expect(existsSync(path.join(context.workerDir, 'meta', 'adapter.json'))).toBe(true)
      expect(existsSync(path.join(context.workerDir, 'meta', 'run-result.json'))).toBe(true)

      // task files should still exist
      expect(existsSync(path.join(context.workerDir, 'task', 'input-manifest.json'))).toBe(true)
      expect(existsSync(path.join(context.workerDir, 'task', 'task.md'))).toBe(true)
    } finally {
      await cleanup(runDir)
    }
  })
})
