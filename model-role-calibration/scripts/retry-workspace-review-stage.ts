#!/usr/bin/env node

import * as path from 'node:path'

import { parseArgs, type ParsedArgs, requireArg, isMainScript } from './lib.js'
import { retryWorkspaceReviewStage as retryWorkspaceReviewStageUntyped } from './run-workspace-review.js'
import { loadWorkspaceReviewFromArgs as loadWorkspaceReviewFromArgsUntyped } from './workspace-review-lib.js'

const loadWorkspaceReviewFromArgs = loadWorkspaceReviewFromArgsUntyped as (args: ParsedArgs) => unknown
const retryWorkspaceReviewStage = retryWorkspaceReviewStageUntyped as (
  config: unknown,
  runDir: string,
  stage: string,
  options: { force: boolean },
) => Promise<unknown>

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

if (isMainScript(__filename)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exitCode = 1
  })
}
