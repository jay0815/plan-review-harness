#!/usr/bin/env node

import { type CalibrationExecutor, runCalibration } from './calibration/runner'

type ArgValue = string | true | undefined
type ParsedArgs = Record<string, ArgValue>

const { parseArgs, requireArg, loadConfig } = require('./lib') as {
  parseArgs(argv: string[]): ParsedArgs
  requireArg(args: ParsedArgs, name: string): string
  loadConfig(): unknown
}

const { FactCheckExecutor, DEFAULT_CONCURRENCY } = require('./calibration/fact-check-executor') as {
  FactCheckExecutor: new () => CalibrationExecutor
  DEFAULT_CONCURRENCY: number
}

function parseModels(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  const config = loadConfig()

  const run = args.run && args.run !== true ? String(args.run) : null
  const caseId = requireArg(args, 'case')
  const models = parseModels(requireArg(args, 'models'))
  const concurrency = args.concurrency && args.concurrency !== true ? Number(args.concurrency) : DEFAULT_CONCURRENCY

  const executor = new FactCheckExecutor()
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

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exitCode = 1
  })
}
