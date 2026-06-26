import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtifactPathBuilder } from '../../src/artifacts/paths.js'
import { PlannerResultSchema } from '../../src/schemas/worker.js'
import type { AgentWorkerContext, AgentWorkerRole } from '../../src/workers/AgentWorkerAdapter.js'
import { MockAgentWorkerAdapter } from '../../src/workers/MockAgentWorkerAdapter.js'

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

async function writePlannerFixture(fixtureDir: string): Promise<void> {
  await mkdir(fixtureDir, { recursive: true })
  await writeFile(path.join(fixtureDir, 'planning.result.json'), JSON.stringify({ planMarkdown: '# Fixture plan' }))
}

function workerContext(paths: ArtifactPathBuilder, role: AgentWorkerRole = 'planner'): AgentWorkerContext {
  return {
    runId: 'run-1',
    round: 1,
    nodeName: role === 'planner' ? 'planning' : 'blindReview',
    role,
    runDir: paths.getRunDir('run-1'),
    workerDir: paths.getWorkerDir('run-1', 1, role),
    inputDir: paths.getWorkerInputDir('run-1', 1, role),
    outputDir: paths.getWorkerOutputDir('run-1', 1, role),
    logDir: paths.getWorkerLogDir('run-1', 1, role),
  }
}

describe('MockAgentWorkerAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads fixture output and writes worker result.json', async () => {
    const runRoot = await tempRoot('mock-worker-run-')
    const fixtureDir = await tempRoot('mock-worker-fixtures-')
    try {
      await writePlannerFixture(fixtureDir)
      const paths = new ArtifactPathBuilder(runRoot)
      const worker = new MockAgentWorkerAdapter({ role: 'planner', fixtureName: 'planning.result.json', fixtureDir })

      const output = await worker.execute(
        { taskId: 'task-1', type: 'generate_plan', input: { requirementPath: 'input.md' } },
        workerContext(paths),
      )

      expect(PlannerResultSchema.parse(output)).toEqual({ planMarkdown: '# Fixture plan' })
      expect(existsSync(path.join(runRoot, 'run-1', 'round-001', 'workers', 'planner', 'output', 'result.json'))).toBe(
        true,
      )
    } finally {
      await cleanup(runRoot)
      await cleanup(fixtureDir)
    }
  })

  it('rejects fixture output that does not satisfy the role schema', async () => {
    const runRoot = await tempRoot('mock-worker-run-')
    const fixtureDir = await tempRoot('mock-worker-fixtures-')
    try {
      await mkdir(fixtureDir, { recursive: true })
      await writeFile(path.join(fixtureDir, 'planning.result.json'), JSON.stringify({ text: '# Wrong shape' }))
      const paths = new ArtifactPathBuilder(runRoot)
      const worker = new MockAgentWorkerAdapter({ role: 'planner', fixtureName: 'planning.result.json', fixtureDir })

      await expect(
        worker.execute({ taskId: 'task-1', type: 'generate_plan', input: {} }, workerContext(paths)),
      ).rejects.toThrow()
    } finally {
      await cleanup(runRoot)
      await cleanup(fixtureDir)
    }
  })

  it('does not access network while executing fixtures', async () => {
    const runRoot = await tempRoot('mock-worker-run-')
    const fixtureDir = await tempRoot('mock-worker-fixtures-')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      await writePlannerFixture(fixtureDir)
      const paths = new ArtifactPathBuilder(runRoot)
      const worker = new MockAgentWorkerAdapter({ role: 'planner', fixtureName: 'planning.result.json', fixtureDir })

      await worker.execute({ taskId: 'task-1', type: 'generate_plan', input: {} }, workerContext(paths))

      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      await cleanup(runRoot)
      await cleanup(fixtureDir)
    }
  })

  it('does not require real LLM API keys', async () => {
    const originalOpenAI = process.env.OPENAI_API_KEY
    const originalAnthropic = process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    const runRoot = await tempRoot('mock-worker-run-')
    const fixtureDir = await tempRoot('mock-worker-fixtures-')
    try {
      await writePlannerFixture(fixtureDir)
      const paths = new ArtifactPathBuilder(runRoot)
      const worker = new MockAgentWorkerAdapter({ role: 'planner', fixtureName: 'planning.result.json', fixtureDir })

      await expect(
        worker.execute({ taskId: 'task-1', type: 'generate_plan', input: {} }, workerContext(paths)),
      ).resolves.toEqual({ planMarkdown: '# Fixture plan' })
    } finally {
      if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = originalOpenAI
      if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = originalAnthropic
      await cleanup(runRoot)
      await cleanup(fixtureDir)
    }
  })

  it('fails validation when fixture is missing required result fields', async () => {
    const runRoot = await tempRoot('mock-worker-run-')
    try {
      const paths = new ArtifactPathBuilder(runRoot)
      const worker = new MockAgentWorkerAdapter({
        role: 'planner',
        fixtureName: 'planner-missing-required.json',
        fixtureDir: 'tests/fixtures/malformed',
      })

      await expect(
        worker.execute({ taskId: 'task-1', type: 'generate_plan', input: {} }, workerContext(paths)),
      ).rejects.toThrow()
    } finally {
      await cleanup(runRoot)
    }
  })

  it('fails validation when review fixture has invalid issue severity', async () => {
    const runRoot = await tempRoot('mock-worker-run-')
    try {
      const paths = new ArtifactPathBuilder(runRoot)
      const worker = new MockAgentWorkerAdapter({
        role: 'architecture-reviewer',
        fixtureName: 'review-invalid-severity.json',
        fixtureDir: 'tests/fixtures/malformed',
      })

      await expect(
        worker.execute(
          { taskId: 'task-1', type: 'review_plan', input: {} },
          workerContext(paths, 'architecture-reviewer'),
        ),
      ).rejects.toThrow()
    } finally {
      await cleanup(runRoot)
    }
  })

  it('fails validation when review fixture has confidence greater than 1', async () => {
    const runRoot = await tempRoot('mock-worker-run-')
    try {
      const paths = new ArtifactPathBuilder(runRoot)
      const worker = new MockAgentWorkerAdapter({
        role: 'architecture-reviewer',
        fixtureName: 'review-confidence-too-high.json',
        fixtureDir: 'tests/fixtures/malformed',
      })

      await expect(
        worker.execute(
          { taskId: 'task-1', type: 'review_plan', input: {} },
          workerContext(paths, 'architecture-reviewer'),
        ),
      ).rejects.toThrow()
    } finally {
      await cleanup(runRoot)
    }
  })

  it('missing fixture should fail with a clear error', async () => {
    const runRoot = await tempRoot('mock-worker-run-')
    try {
      const paths = new ArtifactPathBuilder(runRoot)
      const worker = new MockAgentWorkerAdapter({
        role: 'planner',
        fixtureName: 'does-not-exist.json',
        fixtureDir: 'tests/fixtures/malformed',
      })

      await expect(
        worker.execute({ taskId: 'task-1', type: 'generate_plan', input: {} }, workerContext(paths)),
      ).rejects.toThrow(/Mock fixture not found: tests\/fixtures\/malformed\/does-not-exist\.json/)
    } finally {
      await cleanup(runRoot)
    }
  })
})
