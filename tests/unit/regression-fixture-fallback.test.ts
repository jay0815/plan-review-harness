import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { MockAgentWorkerAdapter } from '../../src/workers/MockAgentWorkerAdapter.js'
import type { AgentWorkerContext } from '../../src/workers/AgentWorkerAdapter.js'

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

function makeContext(runDir: string, round: number): AgentWorkerContext {
  const runId = 'run-test'
  const role = 'regression'
  const workerDir = path.join(runDir, runId, `round-${String(round).padStart(3, '0')}`, 'workers', role)
  return {
    runId,
    round,
    nodeName: 'regression',
    role: role as AgentWorkerContext['role'],
    runDir: path.join(runDir, runId),
    workerDir,
    inputDir: path.join(workerDir, 'input'),
    outputDir: path.join(workerDir, 'output'),
    logDir: path.join(workerDir, 'logs'),
  }
}

const regressionFixture = JSON.stringify({
  runId: 'x',
  round: 1,
  checkedIssueIds: [],
  results: [],
  blockerCount: 0,
  highCount: 0,
  newIssueCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
})

describe('regression fixture round fallback', () => {
  it('uses regression.round1.json when regression.round2.json does not exist', async () => {
    const runDir = await tempRoot('regression-fallback-')
    const fixtureDir = await tempRoot('regression-fixtures-')
    try {
      await mkdir(fixtureDir, { recursive: true })
      await writeFile(path.join(fixtureDir, 'regression.round1.json'), regressionFixture)

      const adapter = new MockAgentWorkerAdapter({
        role: 'regression',
        fixtureName: 'regression.round1.json',
        fixtureDir,
      })

      // round 2 — fixture file doesn't exist, should fallback to round1
      const output = await adapter.execute(
        { taskId: 'test', type: 'regression_review', input: {} },
        makeContext(runDir, 2),
      )

      expect(output).toMatchObject({ blockerCount: 0, highCount: 0 })
    } finally {
      await cleanup(runDir)
      await cleanup(fixtureDir)
    }
  })

  it('uses regression.round1.json when regression.round3.json does not exist', async () => {
    const runDir = await tempRoot('regression-fallback-')
    const fixtureDir = await tempRoot('regression-fixtures-')
    try {
      await mkdir(fixtureDir, { recursive: true })
      await writeFile(path.join(fixtureDir, 'regression.round1.json'), regressionFixture)

      const adapter = new MockAgentWorkerAdapter({
        role: 'regression',
        fixtureName: 'regression.round1.json',
        fixtureDir,
      })

      const output = await adapter.execute(
        { taskId: 'test', type: 'regression_review', input: {} },
        makeContext(runDir, 3),
      )

      expect(output).toMatchObject({ blockerCount: 0 })
    } finally {
      await cleanup(runDir)
      await cleanup(fixtureDir)
    }
  })

  it('uses regression.round2.json when it exists', async () => {
    const runDir = await tempRoot('regression-fallback-')
    const fixtureDir = await tempRoot('regression-fixtures-')
    try {
      await mkdir(fixtureDir, { recursive: true })
      await writeFile(path.join(fixtureDir, 'regression.round1.json'), regressionFixture)
      const round2Fixture = JSON.stringify({
        runId: 'x',
        round: 2,
        checkedIssueIds: [],
        results: [],
        blockerCount: 1,
        highCount: 0,
        newIssueCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      await writeFile(path.join(fixtureDir, 'regression.round2.json'), round2Fixture)

      const adapter = new MockAgentWorkerAdapter({
        role: 'regression',
        fixtureName: 'regression.round1.json',
        fixtureDir,
      })

      const output = await adapter.execute(
        { taskId: 'test', type: 'regression_review', input: {} },
        makeContext(runDir, 2),
      )

      // Should use round2 fixture (blockerCount: 1), not round1 (blockerCount: 0)
      expect(output).toMatchObject({ blockerCount: 1 })
    } finally {
      await cleanup(runDir)
      await cleanup(fixtureDir)
    }
  })
})
