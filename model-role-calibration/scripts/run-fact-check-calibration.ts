#!/usr/bin/env node

import { DEFAULT_CONCURRENCY, FactCheckExecutor } from './calibration/fact-check-executor.js'
import { type CalibrationExecutor, runCalibration } from './calibration/runner.js'
import { isMainScript, loadConfig, parseArgs, requireArg } from './lib.js'

function parseModels(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((item: any) => item.trim().toLowerCase())
    .filter(Boolean)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  const config = loadConfig()

  const run = args.run && args.run !== true ? String(args.run) : null
  const caseId = requireArg(args, 'case')
  const models = parseModels(requireArg(args, 'models'))
  const concurrency = args.concurrency && args.concurrency !== true ? Number(args.concurrency) : DEFAULT_CONCURRENCY

  const executor = new FactCheckExecutor() as unknown as CalibrationExecutor
  const batch = await runCalibration(executor, {
    run,
    caseId,
    models,
    probes: [],
    concurrency,
    config,
  })

  console.log(JSON.stringify(batch, null, 2))
}

if (isMainScript(__filename)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exitCode = 1
  })
}
