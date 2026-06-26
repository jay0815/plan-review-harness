#!/usr/bin/env node

type ArgValue = string | true | undefined
type ParsedArgs = Record<string, ArgValue>

interface FactCheckScore {
  model: string
  case_id: string
  metrics: {
    status_accuracy: number
    challenge_recall: number
  }
}

const { parseArgs, requireArg } = require('./lib') as {
  parseArgs(argv: string[]): ParsedArgs
  requireArg(args: ParsedArgs, name: string): string
}

const { scoreOutput } = require('./fact-check-calibration-lib') as {
  scoreOutput(opts: { run: string; caseId: string; model: string }): FactCheckScore
}

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
