#!/usr/bin/env node

import { ingestOutput as ingestOutputUntyped } from './fact-check-calibration-lib.js'
import { parseArgs, requireArg } from './lib.js'

interface IngestOutputResult {
  raw_file: string
  normalized_file: string
}

const ingestOutput = ingestOutputUntyped as (opts: {
  run: string
  caseId: string
  model: string
  file: string
}) => IngestOutputResult

function main(): void {
  const args = parseArgs(process.argv)
  const result = ingestOutput({
    run: requireArg(args, 'run'),
    caseId: requireArg(args, 'case'),
    model: requireArg(args, 'model'),
    file: requireArg(args, 'file'),
  })
  console.log(`Raw output saved: ${result.raw_file}`)
  console.log(`Normalized output saved: ${result.normalized_file}`)
}

main()
