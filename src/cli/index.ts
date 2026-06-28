#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { LangGraphWorkflowRuntime } from '../graph/LangGraphWorkflowRuntime.js'
import {
  createPromptEvalFileAdapter,
  loadPromptEvalCaseResults,
  loadPromptEvalCases,
  persistPromptEvalRun,
  runPromptEvalSuite,
} from '../prompt-eval/index.js'
import { MockAgentWorkerAdapter } from '../workers/MockAgentWorkerAdapter.js'
import type { AgentWorkerAdapter } from '../workers/AgentWorkerAdapter.js'

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

interface ResumeOptions {
  runId?: string
  decisions?: string
  runDir?: string
}

interface PromptEvalOptions {
  cases?: string
  observedDir?: string
  outputDir?: string
  runId?: string
  baseline?: string
  projectName?: string
}

const defaultIo: CliIo = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
}

function createDefaultWorkers(): AgentWorkerAdapter[] {
  return [
    new MockAgentWorkerAdapter({ role: 'architecture-reviewer', fixtureName: 'review.architecture.json' }),
    new MockAgentWorkerAdapter({ role: 'execution-reviewer', fixtureName: 'review.execution.json' }),
    new MockAgentWorkerAdapter({ role: 'risk-reviewer', fixtureName: 'review.risk.json' }),
    new MockAgentWorkerAdapter({ role: 'reviser', fixtureName: 'revision.json' }),
    new MockAgentWorkerAdapter({ role: 'regression', fixtureName: 'regression.round1.json' }),
  ]
}

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const [command, ...args] = argv.slice(2)

  if (command === 'start') {
    return handleStart(args, io)
  } else if (command === 'resume') {
    return handleResume(args, io)
  } else if (command === 'prompt-eval') {
    return handlePromptEval(args, io)
  } else {
    io.stderr(`Unsupported command: ${command ?? '(none)'}`)
    return 1
  }
}

async function handleStart(args: string[], io: CliIo): Promise<number> {
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
    workers: createDefaultWorkers(),
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

async function handleResume(args: string[], io: CliIo): Promise<number> {
  const options = parseResumeOptions(args)
  if (!options.runId) {
    io.stderr('--run-id is required')
    return 1
  }
  if (!options.decisions) {
    io.stderr('--decisions is required')
    return 1
  }

  const runtime = new LangGraphWorkflowRuntime({
    runDir: options.runDir ?? 'runs',
    maxRounds: 2,
    workers: createDefaultWorkers(),
  })

  const handle = await runtime.resume(options.runId, { decisionsPath: options.decisions })

  io.stdout(`Run resumed: ${handle.runId}`)
  io.stdout(`Status: ${handle.status}`)
  return 0
}

async function handlePromptEval(args: string[], io: CliIo): Promise<number> {
  const options = parsePromptEvalOptions(args)
  if (!options.cases) {
    io.stderr('--cases is required')
    return 1
  }
  if (!options.observedDir) {
    io.stderr('--observed-dir is required')
    return 1
  }
  if (!options.outputDir) {
    io.stderr('--output-dir is required')
    return 1
  }

  const cases = await loadPromptEvalCases(options.cases)
  if (!cases.length) {
    io.stderr(`No prompt eval cases found: ${options.cases}`)
    return 1
  }

  const runId = options.runId || `prompt-eval-${Date.now()}`
  const run = await runPromptEvalSuite({
    runId,
    cases,
    adapter: createPromptEvalFileAdapter({ observedDir: options.observedDir }),
    project: options.projectName ? { name: options.projectName } : undefined,
    baselineResults: options.baseline ? await loadPromptEvalCaseResults(options.baseline) : undefined,
  })
  await persistPromptEvalRun({ outputDir: options.outputDir, run })

  io.stdout(`Prompt eval run: ${run.manifest.runId}`)
  io.stdout(`Cases: ${run.report.totals.cases}`)
  io.stdout(`Passed: ${run.report.totals.passed}`)
  io.stdout(`Failed: ${run.report.totals.failed}`)
  io.stdout(`Warnings: ${run.report.totals.warning}`)
  io.stdout(`Skipped: ${run.report.totals.skipped}`)
  io.stdout(`Report: ${options.outputDir}/report.json`)
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

function parseResumeOptions(args: string[]): ResumeOptions {
  const options: ResumeOptions = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]
    if (arg === '--run-id') {
      options.runId = value
      index += 1
    } else if (arg === '--decisions') {
      options.decisions = value
      index += 1
    } else if (arg === '--run-dir') {
      options.runDir = value
      index += 1
    }
  }
  return options
}

function parsePromptEvalOptions(args: string[]): PromptEvalOptions {
  const options: PromptEvalOptions = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]
    if (arg === '--cases') {
      options.cases = value
      index += 1
    } else if (arg === '--observed-dir') {
      options.observedDir = value
      index += 1
    } else if (arg === '--output-dir') {
      options.outputDir = value
      index += 1
    } else if (arg === '--run-id') {
      options.runId = value
      index += 1
    } else if (arg === '--baseline') {
      options.baseline = value
      index += 1
    } else if (arg === '--project-name') {
      options.projectName = value
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
