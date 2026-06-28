#!/usr/bin/env node

import * as path from 'node:path'

import { parseList } from '../calibration/core.js'
import { type CalibrationExecutor, runCalibration } from '../calibration/runner.js'
import { DEFAULT_CONCURRENCY, RoleCalibrationExecutor } from '../calibration/role-executor.js'
import { PROBES, isMainScript, loadConfig, parseArgs } from '../lib/lib.js'

interface CalibrationConfig {
  models: string[]
  [key: string]: unknown
}

export const DEFAULT_CASE = 'synthetic/event-reporting'

export async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  const config = loadConfig<CalibrationConfig>()
  const run = args.run && args.run !== true ? String(args.run) : null
  const caseId = args.case && args.case !== true ? String(args.case) : DEFAULT_CASE
  const models = parseList(args.models, config.models).map((item) => item.toLowerCase())
  const probes = parseList(args.probes, PROBES)
  const concurrency = args.concurrency && args.concurrency !== true ? Number(args.concurrency) : DEFAULT_CONCURRENCY
  const force = args.force === true

  const executor = new RoleCalibrationExecutor() as unknown as CalibrationExecutor & { root: string }
  if (force) {
    console.warn(
      'Warning: --force refreshes matching prompts and model outputs. ' +
        'Existing score files are not updated and must be rescored before summarization.',
    )
  }
  const batch = await runCalibration(executor, {
    run,
    caseId,
    models,
    probes,
    concurrency,
    force,
    config,
  })

  if (batch.failed > 0) {
    console.error(`\nRole-play workflow finished with ${batch.failed} failed job(s).`)
  } else {
    console.log('\nRole-play workflow completed.')
  }
  console.log(`Run directory: ${path.join(executor.root, 'runs', batch.run)}`)
  console.log('Automated evaluation is not enabled yet.')
}

if (isMainScript(__filename)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exitCode = 1
  })
}
