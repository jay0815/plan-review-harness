#!/usr/bin/env node

import path = require('node:path')

type ArgValue = string | true | undefined
type ParsedArgs = Record<string, ArgValue>

const { parseArgs, requireArg } = require('./lib') as {
  parseArgs(argv: string[]): ParsedArgs
  requireArg(args: ParsedArgs, name: string): string
}

const { loadWorkspaceReviewFromArgs } = require('./workspace-review-lib') as {
  loadWorkspaceReviewFromArgs(args: ParsedArgs): unknown
}

const { retryWorkspaceReviewStage } = require('./run-workspace-review') as {
  retryWorkspaceReviewStage(
    config: unknown,
    runDir: string,
    stage: string,
    options: { force: boolean },
  ): Promise<unknown>
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  const runDir = path.resolve(requireArg(args, 'run-dir'))
  const stage = requireArg(args, 'stage')
  const config = loadWorkspaceReviewFromArgs(args)
  const result = await retryWorkspaceReviewStage(config, runDir, stage, {
    force: Boolean(args.force),
  })
  console.log(JSON.stringify(result, null, 2))
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exitCode = 1
  })
}
