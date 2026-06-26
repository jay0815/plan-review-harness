#!/usr/bin/env node

import os = require('node:os')
import path = require('node:path')

type ArgValue = string | true | undefined
type ParsedArgs = Record<string, ArgValue>

interface ResolveRunDirOptions {
  workspaceRunsDir?: string
}

interface RunManifest {
  run_id: string
  status: string
  resolved_execution?: Record<string, unknown>
}

const { parseArgs } = require('./lib') as {
  parseArgs(argv: string[]): ParsedArgs
}

const { backfillRunManifest } = require('./workspace-review-manifest') as {
  backfillRunManifest(runDir: string, options: { force: boolean }): RunManifest
}

const DEFAULT_WORKSPACE_RUNS_DIR = path.join(os.homedir(), '.claude', 'plan-review-harness', 'mcp', 'workspace-runs')

export function resolveRunDir(args: ParsedArgs, options: ResolveRunDirOptions = {}): string {
  const hasRunDir = args['run-dir'] && args['run-dir'] !== true
  const hasRunId = args['run-id'] && args['run-id'] !== true
  if (hasRunDir && hasRunId) {
    throw new Error('Use either --run-id or --run-dir, not both.')
  }
  if (hasRunDir) {
    return path.resolve(String(args['run-dir']))
  }
  if (hasRunId) {
    const runId = String(args['run-id'])
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
      throw new Error(`Invalid run id: ${runId}`)
    }
    return path.join(options.workspaceRunsDir || DEFAULT_WORKSPACE_RUNS_DIR, runId)
  }
  throw new Error('Missing required argument: --run-id or --run-dir.')
}

function main(): void {
  const args = parseArgs(process.argv)
  const runDir = resolveRunDir(args)
  const manifest = backfillRunManifest(runDir, {
    force: Boolean(args.force),
  })
  console.log(
    JSON.stringify(
      {
        run_id: manifest.run_id,
        status: manifest.status,
        run_dir: path.resolve(runDir),
        run_manifest: path.join(path.resolve(runDir), 'run-manifest.json'),
        resolved_roles: Object.keys(manifest.resolved_execution || {}),
      },
      null,
      2,
    ),
  )
}

if (require.main === module) {
  try {
    main()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exitCode = 1
  }
}
