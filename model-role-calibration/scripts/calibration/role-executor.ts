import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'

import { generatePrompts as generateRolePrompts } from '../cli/generate-prompts.js'
import {
  ROOT,
  agentOutputPaths,
  assertProbe,
  assertSafeCaseId,
  nodeScriptArgs,
  parseJsonFile,
  runtimeScript,
} from '../lib/lib.js'
import { slug, uniqueRunId as createUniqueRunId } from './core.js'

interface CalibrationConfig {
  models: string[]
  probe_concurrency_overrides?: Record<string, unknown>
}

interface RoleJob {
  run: string
  caseId: string
  model: string
  probe: string
}

interface AttemptMetadata {
  timed_out?: boolean
  timeout_ms?: number
  error?: string
  exit_code?: number | null
}

interface LatestAttemptMetadata {
  file: string
  metadata: AttemptMetadata
}

interface RunModelJobOptions {
  force?: boolean
}

interface RoleJobBaseResult {
  caseId: string
  model: string
  probe: string
}

interface RoleJobProcessResult extends RoleJobBaseResult {
  started_at: string
  finished_at: string
  exit_code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

interface CompletedRoleJobResult extends RoleJobProcessResult {
  status: 'completed'
  error: null
}

interface FailedRoleJobResult extends RoleJobProcessResult {
  status: 'failed'
  error: string
  attempt_file?: string | null
}

interface SkippedRoleJobResult extends RoleJobBaseResult {
  status: 'skipped'
  reason: string
  result_file: string
}

type RoleJobResult = CompletedRoleJobResult | FailedRoleJobResult | SkippedRoleJobResult

interface PromptInfo {
  promptDir: string
  generated: number
  reused: number
  prompts: Array<{
    probe: string
    file: string
  }>
}

interface JobStage {
  label: string
  concurrency: number
  jobs: RoleJob[]
}

interface InternalJobStage extends JobStage {
  key: string
}

export const DEFAULT_CONCURRENCY = 3

function jobKey(job: RoleJob): string {
  return `${job.model}/${job.caseId}/${job.probe}`
}

export function latestAttemptMetadata(run: string, job: RoleJob): LatestAttemptMetadata | null {
  const paths = agentOutputPaths(run, job.caseId, job.model, job.probe)
  if (!fs.existsSync(paths.attemptsDir)) {
    return null
  }
  const attempts = fs
    .readdirSync(paths.attemptsDir)
    .map((name) => {
      const match = /^attempt-(\d+)\.meta\.json$/.exec(name)
      return match ? { name, number: Number(match[1]) } : null
    })
    .filter((item): item is { name: string; number: number } => Boolean(item))
    .sort((a, b) => b.number - a.number)
  for (const attempt of attempts) {
    const file = path.join(paths.attemptsDir, attempt.name)
    try {
      return {
        file,
        metadata: parseJsonFile<AttemptMetadata>(file),
      }
    } catch {
      // Try the preceding attempt if the newest metadata is incomplete.
    }
  }
  return null
}

export function failureSummary(
  metadata: AttemptMetadata | undefined,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  spawnError: string | null,
): string {
  const compactMessage = (message: unknown): string => {
    const compact = String(message).replace(/\s+/g, ' ').trim()
    return compact.length > 300 ? `${compact.slice(0, 297)}...` : compact
  }
  if (spawnError) {
    return `Unable to start model runner: ${spawnError}`
  }
  if (metadata?.timed_out) {
    return `Model command timed out after ${metadata.timeout_ms}ms`
  }
  if (metadata?.error) {
    const position = /position (\d+)/i.exec(metadata.error)
    if (position && /valid JSON object|JSON parse/i.test(metadata.error)) {
      return `Invalid model output: JSON parse error at position ${position[1]}`
    }
    const prefix = metadata.exit_code === 0 ? 'Invalid model output' : 'Model command failed'
    return `${prefix}: ${compactMessage(metadata.error)}`
  }
  if (exitCode !== null) {
    return `Model runner exited with status ${exitCode}`
  }
  if (signal) {
    return `Model runner terminated by signal ${signal}`
  }
  return 'Model runner failed without a recorded error'
}

export function runModelJob(
  job: RoleJob,
  options: RunModelJobOptions = {},
): Promise<CompletedRoleJobResult | FailedRoleJobResult> {
  return new Promise((resolve) => {
    const runner = process.env.MODEL_ROLE_CALIBRATION_RUNNER || runtimeScript('cli/run-model')
    const startedAt = new Date().toISOString()
    const runnerArgs = [
      '--run',
      job.run,
      '--case',
      job.caseId,
      '--model',
      job.model,
      '--probe',
      job.probe,
      '--with-json-validator',
    ]
    if (options.force) {
      runnerArgs.push('--force')
    }
    const child = spawn(process.execPath, nodeScriptArgs(runner, ...runnerArgs), {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let spawnError: string | null = null

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error: Error) => {
      spawnError = error.message
    })
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      const paths = agentOutputPaths(job.run, job.caseId, job.model, job.probe)
      const base: RoleJobProcessResult = {
        caseId: job.caseId,
        model: job.model,
        probe: job.probe,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        exit_code: code,
        signal,
        stdout,
        stderr,
      }
      if (code === 0 && !spawnError && fs.existsSync(paths.resultFile)) {
        resolve({
          ...base,
          status: 'completed',
          error: null,
        })
        return
      }
      if (code === 0 && !spawnError) {
        resolve({
          ...base,
          status: 'failed',
          error: `Model runner exited successfully without output: ${path.relative(ROOT, paths.resultFile)}`,
          attempt_file: null,
        })
        return
      }
      const attempt = latestAttemptMetadata(job.run, job)
      resolve({
        ...base,
        status: 'failed',
        error: failureSummary(attempt?.metadata, code, signal, spawnError),
        attempt_file: attempt?.file ? path.relative(ROOT, attempt.file) : null,
      })
    })
  })
}

export class RoleCalibrationExecutor {
  get type(): string {
    return 'role'
  }

  get root(): string {
    return ROOT
  }

  validateOptions({
    caseId,
    models,
    probes,
    config,
  }: {
    caseId: string
    models: string[]
    probes: string[]
    config: CalibrationConfig
  }): void {
    assertSafeCaseId(caseId)
    if (!models.length) {
      throw new Error('At least one model is required')
    }
    for (const model of models) {
      if (!config.models.includes(model)) {
        throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`)
      }
    }
    if (!probes.length) {
      throw new Error('At least one probe is required')
    }
    probes.forEach(assertProbe)
  }

  uniqueRunId(caseId: string): string {
    return createUniqueRunId(slug(caseId), ROOT)
  }

  generatePrompts({
    run,
    caseId,
    probes,
    force = false,
  }: {
    run: string
    caseId: string
    probes: string[]
    force?: boolean
  }): PromptInfo {
    const promptDir = path.join(ROOT, 'runs', run, caseId, 'prompts')
    const generatedProbes = force
      ? probes
      : probes.filter((probe) => !fs.existsSync(path.join(promptDir, `${probe}.md`)))
    if (generatedProbes.length) {
      generateRolePrompts({
        run,
        caseId,
        probes: generatedProbes,
        force,
      })
    }
    return {
      promptDir,
      generated: generatedProbes.length,
      reused: probes.length - generatedProbes.length,
      prompts: probes.map((probe) => ({
        probe,
        file: path.join(promptDir, `${probe}.md`),
      })),
    }
  }

  buildJobs({
    run,
    caseId,
    models,
    probes,
  }: {
    run: string
    caseId: string
    models: string[]
    probes: string[]
  }): RoleJob[] {
    const jobs: RoleJob[] = []
    for (const probe of probes) {
      for (const model of models) {
        jobs.push({ run, caseId, model, probe })
      }
    }
    return jobs
  }

  planJobStages({
    jobs,
    concurrency,
    config,
  }: {
    jobs: RoleJob[]
    concurrency: number
    config: CalibrationConfig
  }): JobStage[] {
    const overrides = config.probe_concurrency_overrides || {}
    const stages: InternalJobStage[] = []
    for (const job of jobs) {
      const configuredLimit = overrides[job.probe]
      const effectiveConcurrency = Number.isInteger(configuredLimit)
        ? Math.min(concurrency, configuredLimit as number)
        : concurrency
      const label = effectiveConcurrency === concurrency ? 'default' : job.probe
      const key = `${label}:${effectiveConcurrency}`
      const current = stages[stages.length - 1]
      if (!current || current.key !== key) {
        stages.push({
          key,
          label,
          concurrency: effectiveConcurrency,
          jobs: [],
        })
      }
      stages[stages.length - 1]!.jobs.push(job)
    }
    return stages.map(({ key: _key, ...stage }) => stage)
  }

  async runJob(job: RoleJob, options: RunModelJobOptions = {}): Promise<RoleJobResult> {
    const paths = agentOutputPaths(job.run, job.caseId, job.model, job.probe)
    const label = jobKey(job)
    if (fs.existsSync(paths.resultFile) && !options.force) {
      console.log(`[skip] ${label}: completed output exists`)
      return {
        caseId: job.caseId,
        model: job.model,
        probe: job.probe,
        status: 'skipped',
        reason: 'completed_output_exists',
        result_file: path.relative(ROOT, paths.resultFile),
      }
    }

    console.log(`[start] ${label}`)
    const result = await runModelJob(job, options)
    if (result.status === 'completed') {
      console.log(`[done] ${label}`)
    } else {
      console.error(`[fail] ${label}`)
      console.error(`  ${result.error}`)
      if (result.attempt_file) {
        console.error(`  attempt: ${result.attempt_file}`)
      }
    }
    return result
  }

  summarizeRun(run: string): { run: string; automated_evaluation: false } {
    return {
      run,
      automated_evaluation: false,
    }
  }
}
