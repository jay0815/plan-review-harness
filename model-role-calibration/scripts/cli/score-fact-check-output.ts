#!/usr/bin/env node

import { scoreOutput as scoreOutputUntyped } from './fact-check-calibration-lib.js'
import { parseArgs, requireArg } from '../lib/lib.js'

interface FactCheckScore {
  model: string
  case_id: string
  metrics: {
    status_accuracy: number
    challenge_recall: number
  }
}

const scoreOutput = scoreOutputUntyped as (opts: { run: string; caseId: string; model: string }) => FactCheckScore

function main(): void {
  const args = parseArgs(process.argv)
  const score = scoreOutput({
    run: requireArg(args, 'run'),
    caseId: requireArg(args, 'case'),
    model: requireArg(args, 'model'),
  })
  console.log(`Scored ${score.model}/${score.case_id}`)
  console.log(`Status accuracy: ${score.metrics.status_accuracy}`)
  console.log(`Challenge recall: ${score.metrics.challenge_recall}`)
}

main()
