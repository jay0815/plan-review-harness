#!/usr/bin/env node

import { summarizeRun as summarizeRunUntyped } from './fact-check-calibration-lib.js'
import { parseArgs, requireArg } from '../lib/lib.js'

interface FactCheckSummary {
  scores: unknown[]
  recommendation?: string
}

const summarizeRun = summarizeRunUntyped as (run: string) => FactCheckSummary

function main(): void {
  const summary = summarizeRun(requireArg(parseArgs(process.argv), 'run'))
  console.log(`Scores read: ${summary.scores.length}`)
  console.log(`Recommendation: ${summary.recommendation || 'TBD'}`)
}

main()
