#!/usr/bin/env node

type ArgValue = string | true | undefined
type ParsedArgs = Record<string, ArgValue>

interface IngestOutputResult {
  raw_file: string
  normalized_file: string
}

const { parseArgs, requireArg } = require('./lib') as {
  parseArgs(argv: string[]): ParsedArgs
  requireArg(args: ParsedArgs, name: string): string
}

const { ingestOutput } = require('./fact-check-calibration-lib') as {
  ingestOutput(opts: { run: string; caseId: string; model: string; file: string }): IngestOutputResult
}

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
