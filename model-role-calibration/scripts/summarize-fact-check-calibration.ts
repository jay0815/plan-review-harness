#!/usr/bin/env node

type ArgValue = string | true | undefined
type ParsedArgs = Record<string, ArgValue>

interface FactCheckSummary {
  scores: unknown[]
  recommendation?: string
}

const { parseArgs, requireArg } = require('./lib') as {
  parseArgs(argv: string[]): ParsedArgs
  requireArg(args: ParsedArgs, name: string): string
}

const { summarizeRun } = require('./fact-check-calibration-lib') as {
  summarizeRun(run: string): FactCheckSummary
}

function main(): void {
  const summary = summarizeRun(requireArg(parseArgs(process.argv), 'run'))
  console.log(`Scores read: ${summary.scores.length}`)
  console.log(`Recommendation: ${summary.recommendation || 'TBD'}`)
}

main()
