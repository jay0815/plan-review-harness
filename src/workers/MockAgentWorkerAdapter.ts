import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ZodSchema } from 'zod'
import {
  PlannerResultSchema,
  RegressionResultSchema,
  ReviewResultSchema,
  RevisionResultSchema,
} from '../schemas/worker.js'
import { atomicWriteJson, atomicWriteText, ensureDir } from '../utils/fs.js'
import type { AgentWorkerAdapter, AgentWorkerContext, AgentWorkerRole, AgentWorkerTask } from './AgentWorkerAdapter.js'

export interface MockAgentWorkerOptions {
  role: AgentWorkerRole
  fixtureName: string
  fixtureDir?: string
}

export class MockAgentWorkerAdapter implements AgentWorkerAdapter<unknown, unknown> {
  readonly kind = 'mock'
  readonly role: AgentWorkerRole
  private readonly fixtureName: string
  private readonly fixtureDir: string

  constructor(options: MockAgentWorkerOptions) {
    this.role = options.role
    this.fixtureName = options.fixtureName
    this.fixtureDir = options.fixtureDir ?? path.resolve('fixtures', 'mock')
  }

  async execute(task: AgentWorkerTask<unknown>, context: AgentWorkerContext): Promise<unknown> {
    await Promise.all([
      ensureDir(path.join(context.workerDir, 'task')),
      ensureDir(context.inputDir),
      ensureDir(context.outputDir),
      ensureDir(context.logDir),
      ensureDir(path.join(context.workerDir, 'meta')),
    ])

    await atomicWriteJson(path.join(context.workerDir, 'task', 'input-manifest.json'), {
      taskId: task.taskId,
      type: task.type,
      input: task.input,
      context: task.context ?? {},
    })
    await atomicWriteText(path.join(context.workerDir, 'task', 'task.md'), `# ${context.role}\n\n${task.type}\n`)
    await atomicWriteJson(path.join(context.workerDir, 'task', 'output-schema.json'), {
      role: context.role,
      kind: this.kind,
    })
    await atomicWriteText(path.join(context.logDir, 'stdout.log'), '')
    await atomicWriteText(path.join(context.logDir, 'stderr.log'), '')

    const fixturePath = path.join(this.fixtureDir, this.fixtureNameForContext(context))
    const startedAt = new Date(0).toISOString()
    const raw = await this.readFixture(fixturePath)
    const output = this.schemaForRole().parse(JSON.parse(raw))
    // result.json is written by the caller (blindReview or runtime), not the adapter.
    // The adapter only returns the parsed output; persistence is the caller's responsibility.
    await atomicWriteJson(path.join(context.workerDir, 'meta', 'adapter.json'), {
      kind: this.kind,
      role: this.role,
      fixtureName: this.fixtureName,
    })
    await atomicWriteJson(path.join(context.workerDir, 'meta', 'run-result.json'), {
      runId: context.runId,
      round: context.round,
      role: context.role,
      kind: this.kind,
      status: 'success',
      exitCode: 0,
      startedAt,
      finishedAt: startedAt,
      stdoutPath: path.join(context.logDir, 'stdout.log'),
      stderrPath: path.join(context.logDir, 'stderr.log'),
    })
    return output
  }

  private schemaForRole(): ZodSchema<unknown> {
    if (this.role === 'planner') return PlannerResultSchema
    if (this.role.endsWith('reviewer')) return ReviewResultSchema
    if (this.role === 'reviser') return RevisionResultSchema
    if (this.role === 'regression') return RegressionResultSchema
    return PlannerResultSchema
  }

  private fixtureNameForContext(context: AgentWorkerContext): string {
    if (this.role === 'regression') {
      return `regression.round${context.round}.json`
    }
    return this.fixtureName
  }

  private async readFixture(fixturePath: string): Promise<string> {
    try {
      return await readFile(fixturePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Regression fixture fallback: if roundN doesn't exist, try round1
        if (this.role === 'regression' && /\.round\d+\.json$/.test(fixturePath)) {
          const fallbackPath = fixturePath.replace(/\.round\d+\.json$/, '.round1.json')
          if (fallbackPath !== fixturePath) {
            try {
              return await readFile(fallbackPath, 'utf8')
            } catch {
              // fallback also failed — throw original error
            }
          }
        }
        throw new Error(`Mock fixture not found: ${fixturePath}`)
      }
      throw error
    }
  }
}
