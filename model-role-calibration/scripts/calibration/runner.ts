import * as path from 'node:path'

import { positiveInteger, runWithConcurrency, writeGenerated } from './core.js'

export interface CalibrationJob {
  run: string
  caseId: string
  model: string
  probe?: string
}

export interface CalibrationPromptInfo {
  promptDir: string
  prompts: unknown[]
  generated?: number
  reused?: number
}

export interface CalibrationJobResult {
  status: string
  [key: string]: unknown
}

export interface CalibrationJobStage {
  label: string
  concurrency: number
  jobs: CalibrationJob[]
}

export interface CalibrationExecutor {
  type: string
  root: string
  validateOptions(opts: { caseId: string; models: string[]; probes: string[]; config: unknown }): void
  uniqueRunId(caseId: string): string
  generatePrompts(opts: {
    run: string
    caseId: string
    models: string[]
    probes: string[]
    force?: boolean
  }): CalibrationPromptInfo
  buildJobs(opts: { run: string; caseId: string; models: string[]; probes: string[] }): CalibrationJob[]
  planJobStages?(opts: { jobs: CalibrationJob[]; concurrency: number; config: unknown }): CalibrationJobStage[]
  runJob(job: CalibrationJob, opts?: { force?: boolean }): Promise<CalibrationJobResult>
  summarizeRun(run: string): object | null
}

export interface RunCalibrationOptions {
  caseId: string
  models: string[]
  probes: string[]
  run?: string | null
  concurrency?: number
  force?: boolean
  config: unknown
}

export interface CalibrationBatch {
  run: string
  type: string
  case_id: string
  models: string[]
  probes?: string[]
  requested: number
  force: boolean
  skipped: number
  completed: number
  failed: number
  results: CalibrationJobResult[]
  job_stages?: Array<{
    label: string
    concurrency: number
    jobs: number
  }>
  summary: object | null
}

export async function runCalibration(
  executor: CalibrationExecutor,
  options: RunCalibrationOptions,
): Promise<CalibrationBatch> {
  const { caseId, models, probes, config } = options
  executor.validateOptions({ caseId, models, probes, config })

  const run = options.run || executor.uniqueRunId(caseId)
  const concurrency = positiveInteger(options.concurrency || 2, 'concurrency')
  const force = options.force === true

  console.log(`Run ID: ${run}`)
  console.log(`Type: ${executor.type}`)
  console.log(`Case: ${caseId}`)
  console.log(`Models: ${models.join(',')}`)
  if (probes.length) {
    console.log(`Probes: ${probes.join(',')}`)
  }
  if (force) {
    console.log('Force: enabled (matching prompts and model outputs will be refreshed)')
  }

  const promptInfo = executor.generatePrompts({ run, caseId, models, probes, force })
  const generated = promptInfo.generated ?? promptInfo.prompts.length
  const reused = promptInfo.reused ?? 0
  console.log(`Prompts: ${generated} generated${reused ? `, ${reused} reused` : ''}`)

  const jobs = executor.buildJobs({ run, caseId, models, probes })
  console.log(`Jobs: ${jobs.length} scheduled, concurrency=${concurrency}`)

  const stages =
    typeof executor.planJobStages === 'function'
      ? executor.planJobStages({ jobs, concurrency, config })
      : [{ label: 'default', concurrency, jobs }]
  for (const stage of stages) {
    if (!Array.isArray(stage.jobs)) {
      throw new Error(`Invalid job stage "${stage.label || 'unknown'}": jobs must be an array`)
    }
    positiveInteger(stage.concurrency, `job stage ${stage.label || 'unknown'} concurrency`)
  }

  const showStages = stages.length > 1 || stages.some((stage) => stage.concurrency !== concurrency)
  const results: CalibrationJobResult[] = []
  for (const stage of stages) {
    if (showStages) {
      console.log(`[stage] ${stage.label}: ${stage.jobs.length} job(s), concurrency=${stage.concurrency}`)
    }
    const stageResults = await runWithConcurrency(stage.jobs, stage.concurrency, (job) =>
      executor.runJob(job, { force }),
    )
    results.push(...stageResults)
  }

  const completed = results.filter((item) => item.status === 'completed' || item.status === 'skipped').length
  const failed = results.filter((item) => item.status === 'failed').length

  const summary = completed > 0 ? executor.summarizeRun(run) : null

  const batch: CalibrationBatch = {
    run,
    type: executor.type,
    case_id: caseId,
    models,
    probes: probes.length ? probes : undefined,
    requested: jobs.length,
    force,
    skipped: results.filter((item) => item.status === 'skipped').length,
    completed,
    failed,
    results,
    job_stages: showStages
      ? stages.map((stage) => ({
          label: stage.label,
          concurrency: stage.concurrency,
          jobs: stage.jobs.length,
        }))
      : undefined,
    summary: summary || null,
  }

  const batchFile = path.join(executor.root, 'runs', run, 'batch.json')
  writeGenerated(batchFile, JSON.stringify(batch, null, 2) + '\n')
  console.log(`Batch saved: ${batchFile}`)

  if (failed > 0) {
    process.exitCode = 1
  }

  return batch
}
