#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { LangGraphWorkflowRuntime } from '../graph/LangGraphWorkflowRuntime.js'
import { MockAgentWorkerAdapter } from '../workers/MockAgentWorkerAdapter.js'

interface CliIo {
  stdout(line: string): void
  stderr(line: string): void
}

interface StartOptions {
  requirement?: string
  plan?: string
  maxRounds?: number
  runDir?: string
}

const defaultIo: CliIo = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
}

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const [command, ...args] = argv.slice(2)
  if (command !== 'start') {
    io.stderr(`Unsupported command: ${command ?? '(none)'}`)
    return 1
  }

  const options = parseStartOptions(args)
  if (!options.requirement) {
    io.stderr('Missing required option: --requirement')
    return 1
  }
  if (!options.plan) {
    io.stderr('Missing required option: --plan')
    return 1
  }

  const runtime = new LangGraphWorkflowRuntime({
    runDir: options.runDir ?? 'runs',
    maxRounds: options.maxRounds ?? 2,
    workers: [
      new MockAgentWorkerAdapter({ role: 'architecture-reviewer', fixtureName: 'review.architecture.json' }),
      new MockAgentWorkerAdapter({ role: 'execution-reviewer', fixtureName: 'review.execution.json' }),
      new MockAgentWorkerAdapter({ role: 'risk-reviewer', fixtureName: 'review.risk.json' }),
      new MockAgentWorkerAdapter({ role: 'reviser', fixtureName: 'revision.json' }),
      new MockAgentWorkerAdapter({ role: 'regression', fixtureName: 'regression.round1.json' }),
    ],
  })

  const handle = await runtime.start({
    requirementPath: options.requirement,
    initialPlanPath: options.plan,
    maxRounds: options.maxRounds,
  })

  io.stdout(`Run created: ${handle.runId}`)
  io.stdout(`Status: ${handle.status}`)
  io.stdout(`Artifacts: ${options.runDir ?? 'runs'}/${handle.runId}/`)
  return 0
}

function parseStartOptions(args: string[]): StartOptions {
  const options: StartOptions = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]
    if (arg === '--requirement') {
      options.requirement = value
      index += 1
    } else if (arg === '--plan') {
      options.plan = value
      index += 1
    } else if (arg === '--max-rounds') {
      options.maxRounds = value === undefined ? undefined : Number(value)
      index += 1
    } else if (arg === '--run-dir') {
      options.runDir = value
      index += 1
    }
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv)
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
