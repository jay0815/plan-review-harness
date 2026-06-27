#!/usr/bin/env node

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  ROOT,
  PROBES,
  isMainScript,
  parseArgs,
  requireArg,
  assertSafeCaseId,
  assertProbe,
  ensureDir,
  writeFileNew,
  writeGenerated,
  loadConfig,
  parseJsonFile,
  timestamp,
  agentOutputPaths,
  nodeScriptArgs,
  runtimeScript,
} from './lib.js'

const MAX_CONCURRENCY = 3

type Probe = 'planner' | 'risk' | 'architecture' | 'execution' | 'rebuttal' | 'synthesis'

interface CalibrationConfig {
  primary_cases: string[]
  models: string[]
}

interface AgentJob {
  caseId: string
  model: string
  probe: string
}

interface SkippedJob extends AgentJob {
  reason: string
  result_file: string
}

interface JobResult extends AgentJob {
  id: number
  started_at: string
  finished_at: string
  exit_code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  error: string | null
}

interface BatchIndexItem {
  id: string
  file: string | null
  requested: number
  scheduled?: number
  completed: number
  failed: number
  skipped: number
  started_at?: string
  finished_at?: string
  imported_legacy_record?: boolean
}

interface PoolIndex {
  version: number
  run?: string
  max_concurrency?: number
  updated_at?: string
  ready_for_evaluation?: boolean
  requested_jobs: AgentJob[]
  unresolved_jobs?: AgentJob[]
  batches: BatchIndexItem[]
  requested?: number
  completed?: AgentJob[]
  failed?: AgentJob[]
}

interface AttemptMetadata {
  timed_out?: boolean
  timeout_ms?: number
  error?: string
  exit_code?: number | null
}

interface AttemptMetadataRecord {
  file: string
  metadata: AttemptMetadata
}

interface ActiveJob {
  record: Omit<JobResult, 'finished_at' | 'exit_code' | 'signal' | 'stdout' | 'stderr' | 'error'>
  stdout: string
  stderr: string
  spawnError?: string
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseList(value: string | true | undefined, fallback: string[]): string[] {
  if (!value || value === true) {
    return [...fallback]
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function jobKey(job: AgentJob): string {
  return `${job.model}/${job.caseId}/${job.probe}`
}

function validateSelection(
  cases: string[],
  models: string[],
  probes: string[],
  config: CalibrationConfig,
  run: string,
): void {
  for (const caseId of cases) {
    assertSafeCaseId(caseId)
  }
  for (const model of models) {
    if (!config.models.includes(model)) {
      throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`)
    }
  }
  for (const probe of probes) {
    assertProbe(probe)
  }
  for (const caseId of cases) {
    for (const probe of probes) {
      const promptFile = path.join(ROOT, 'runs', run, caseId, 'prompts', `${probe}.md`)
      if (!fs.existsSync(promptFile)) {
        throw new Error(`Missing generated prompt: ${promptFile}`)
      }
    }
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return isNodeError(error) && error.code === 'EPERM'
  }
}

function acquireRunLock(lockFile: string): () => void {
  ensureDir(path.dirname(lockFile))
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockFile, 'wx')
      fs.writeFileSync(
        fd,
        JSON.stringify(
          {
            pid: process.pid,
            started_at: new Date().toISOString(),
          },
          null,
          2,
        ) + '\n',
      )
      fs.closeSync(fd)
      return () => {
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile)
        }
      }
    } catch (error: unknown) {
      if (!isNodeError(error)) {
        throw error
      }
      if (error.code !== 'EEXIST') {
        throw error
      }
      let existing: { pid?: number } | null
      try {
        existing = parseJsonFile<{ pid?: number }>(lockFile)
      } catch {
        existing = null
      }
      if (!existing?.pid) {
        throw new Error(`Agent pool lock exists but is not readable: ${lockFile}`)
      }
      if (existing?.pid && processExists(existing.pid)) {
        throw new Error(`Another agent pool is active for this harness (pid ${existing.pid})`)
      }
      fs.unlinkSync(lockFile)
    }
  }
  throw new Error(`Unable to acquire run lock: ${lockFile}`)
}

function loadPoolIndex(indexFile: string): PoolIndex {
  if (!fs.existsSync(indexFile)) {
    return {
      version: 2,
      batches: [],
      requested_jobs: [],
    }
  }
  const existing = parseJsonFile<PoolIndex>(indexFile)
  if (existing.version === 2 && Array.isArray(existing.batches)) {
    return existing
  }
  const legacyJobs = [...(existing.completed || []), ...(existing.failed || [])]
    .map((item) => ({
      caseId: item.caseId,
      model: item.model,
      probe: item.probe,
    }))
    .filter((item) => item.caseId && item.model && item.probe)
  return {
    version: 2,
    batches: [
      {
        id: 'legacy-agent-pool',
        file: null,
        requested: existing.requested || legacyJobs.length,
        completed: (existing.completed || []).length,
        failed: (existing.failed || []).length,
        skipped: 0,
        imported_legacy_record: true,
      },
    ],
    requested_jobs: legacyJobs,
  }
}

function uniqueBatchId(batchDir: string): string {
  const base = `batch-${timestamp()}`
  let id = base
  let suffix = 2
  while (fs.existsSync(path.join(batchDir, `${id}.json`))) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

function mergeRequestedJobs(previous: AgentJob[], current: AgentJob[]): AgentJob[] {
  const jobs = new Map<string, AgentJob>()
  for (const job of [...previous, ...current]) {
    jobs.set(jobKey(job), {
      caseId: job.caseId,
      model: job.model,
      probe: job.probe,
    })
  }
  return [...jobs.values()].sort((a, b) => jobKey(a).localeCompare(jobKey(b)))
}

function latestAttemptMetadata(run: string, job: AgentJob): AttemptMetadataRecord | null {
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
    .filter((attempt): attempt is { name: string; number: number } => Boolean(attempt))
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

function failureSummary(
  metadata: AttemptMetadata | null | undefined,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  spawnError: string | null | undefined,
): string {
  const compactMessage = (message: unknown) => {
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

function main() {
  const args = parseArgs(process.argv)
  const run = requireArg(args, 'run')
  const config = loadConfig<CalibrationConfig>()
  const cases = parseList(args.cases, config.primary_cases)
  const models = parseList(args.models, config.models).map((item) => item.toLowerCase())
  const probes = parseList(args.probes, PROBES)
  validateSelection(cases, models, probes, config, run)

  const requestedJobs: AgentJob[] = []
  for (const caseId of cases) {
    for (const probe of probes) {
      for (const model of models) {
        requestedJobs.push({ caseId, model, probe })
      }
    }
  }

  const runDir = path.join(ROOT, 'runs', run)
  const lockFile = process.env.MODEL_ROLE_CALIBRATION_POOL_LOCK || path.join(ROOT, 'runs', '.agent-pool.lock')
  const releaseLock = acquireRunLock(lockFile)
  let lockReleased = false
  const releaseOnce = () => {
    if (!lockReleased) {
      releaseLock()
      lockReleased = true
    }
  }
  process.once('exit', releaseOnce)

  const batchDir = path.join(runDir, 'agent-pools')
  ensureDir(batchDir)
  const batchId = uniqueBatchId(batchDir)
  const batchFile = path.join(batchDir, `${batchId}.json`)
  const indexFile = path.join(runDir, 'agent-pool.json')
  const poolIndex = loadPoolIndex(indexFile)

  const skipped: SkippedJob[] = []
  const jobs: AgentJob[] = []
  for (const job of requestedJobs) {
    const paths = agentOutputPaths(run, job.caseId, job.model, job.probe)
    if (fs.existsSync(paths.resultFile)) {
      skipped.push({
        ...job,
        reason: 'completed_output_exists',
        result_file: path.relative(ROOT, paths.resultFile),
      })
    } else {
      jobs.push(job)
    }
  }

  const runner = process.env.MODEL_ROLE_CALIBRATION_RUNNER || runtimeScript('run-model')
  const pending: AgentJob[] = [...jobs]
  const active = new Map<number, ActiveJob>()
  const completed: JobResult[] = []
  const failed: JobResult[] = []
  const startedAt = new Date().toISOString()
  let sequence = 0
  let finishing = false

  function finish() {
    if (finishing) {
      return
    }
    finishing = true
    const finishedAt = new Date().toISOString()
    const batch = {
      id: batchId,
      run,
      max_concurrency: MAX_CONCURRENCY,
      started_at: startedAt,
      finished_at: finishedAt,
      requested: requestedJobs.length,
      scheduled: jobs.length,
      pending: 0,
      active: 0,
      ready_for_evaluation: failed.length === 0,
      skipped,
      completed,
      failed,
    }
    writeFileNew(batchFile, JSON.stringify(batch, null, 2) + '\n')

    const allRequestedJobs = mergeRequestedJobs(poolIndex.requested_jobs || [], requestedJobs)
    const unresolved = allRequestedJobs.filter((job) => {
      const paths = agentOutputPaths(run, job.caseId, job.model, job.probe)
      return !fs.existsSync(paths.resultFile)
    })
    const nextIndex = {
      version: 2,
      run,
      max_concurrency: MAX_CONCURRENCY,
      updated_at: finishedAt,
      ready_for_evaluation: unresolved.length === 0,
      requested_jobs: allRequestedJobs,
      unresolved_jobs: unresolved,
      batches: [
        ...(poolIndex.batches || []),
        {
          id: batchId,
          file: path.relative(ROOT, batchFile),
          requested: batch.requested,
          scheduled: batch.scheduled,
          completed: completed.length,
          failed: failed.length,
          skipped: skipped.length,
          started_at: startedAt,
          finished_at: finishedAt,
        },
      ],
    }
    writeGenerated(indexFile, JSON.stringify(nextIndex, null, 2) + '\n')
    releaseOnce()

    console.log(`Agent pool drained: ${completed.length} completed, ${failed.length} failed, ${skipped.length} skipped`)
    console.log(`Batch summary saved: ${batchFile}`)
    console.log(`Pool index updated: ${indexFile}`)
    if (unresolved.length) {
      console.error(`Role play still has ${unresolved.length} unresolved job(s); retry before evaluation.`)
      process.exitCode = 1
    } else {
      console.log('All requested role-play jobs are complete. Ready for output ingestion and evaluation.')
    }
  }

  function fillPool() {
    while (active.size < MAX_CONCURRENCY && pending.length) {
      const job = pending.shift()
      if (!job) {
        continue
      }
      sequence += 1
      const id = sequence
      const label = jobKey(job)
      const child = spawn(
        process.execPath,
        nodeScriptArgs(
          runner,
          '--run',
          run,
          '--case',
          job.caseId,
          '--model',
          job.model,
          '--probe',
          job.probe,
          '--with-json-validator',
        ),
        {
          cwd: ROOT,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      const record = {
        id,
        ...job,
        started_at: new Date().toISOString(),
      }
      active.set(id, { record, stdout: '', stderr: '' })
      console.log(`[start ${id}/${jobs.length}] ${label} (active=${active.size})`)

      child.stdout.on('data', (chunk: Buffer) => {
        const state = active.get(id)
        if (state) {
          state.stdout += chunk.toString()
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        const state = active.get(id)
        if (state) {
          state.stderr += chunk.toString()
        }
      })
      child.on('error', (error: Error) => {
        const state = active.get(id)
        if (state) {
          state.spawnError = error.message
        }
      })
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        const state = active.get(id)
        if (!state) {
          return
        }
        active.delete(id)
        const result = {
          ...state.record,
          finished_at: new Date().toISOString(),
          exit_code: code,
          signal,
          stdout: state.stdout,
          stderr: state.stderr,
          error: state.spawnError || null,
        }
        const target = code === 0 && !state.spawnError ? completed : failed
        target.push(result)
        if (target === completed) {
          console.log(`[done ${id}/${jobs.length}] ${label} (active=${active.size}, pending=${pending.length})`)
        } else {
          const attempt = latestAttemptMetadata(run, job)
          console.error(`[fail ${id}/${jobs.length}] ${label} (active=${active.size}, pending=${pending.length})`)
          console.error(`  ${failureSummary(attempt?.metadata, code, signal, state.spawnError)}`)
          if (attempt?.file) {
            console.error(`  attempt: ${path.relative(ROOT, attempt.file)}`)
          }
        }

        if (!pending.length && !active.size) {
          finish()
          return
        }
        fillPool()
      })
    }
  }

  if (!pending.length) {
    finish()
    return
  }
  fillPool()
}

if (isMainScript(__filename)) {
  try {
    main()
  } catch (error: unknown) {
    console.error(errorMessage(error))
    process.exitCode = 1
  }
}

export { MAX_CONCURRENCY, acquireRunLock, failureSummary, latestAttemptMetadata, mergeRequestedJobs }
