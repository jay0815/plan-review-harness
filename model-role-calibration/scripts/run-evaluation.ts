#!/usr/bin/env node

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'

import {
  buildCodexArgs as buildCodexArgsTyped,
  buildEvaluationPrompt as buildEvaluationPromptTyped,
  evaluationPaths as evaluationPathsTyped,
  evaluationSchemaFile,
  hashText,
  nextEvaluationAttempt as nextEvaluationAttemptTyped,
  parseList as parseListTyped,
  validateEvaluationScore as validateEvaluationScoreTyped,
} from './evaluation-lib.js'
import {
  ROOT,
  assertProbe,
  assertSafeCaseId,
  type ArgValue,
  isMainScript,
  loadConfig,
  parseArgs,
  parseJsonFile,
  readText,
  requireArg,
  writeFileNew,
  writeGenerated,
} from './lib.js'

interface CalibrationConfig {
  models: string[]
  agent_execution: {
    timeout_ms: number
    max_buffer_bytes: number
  }
}

interface EvaluationSourceFiles {
  evaluatorFile: string
  rubricFile: string
  outputFile: string
}

interface BuiltEvaluationPrompt {
  prompt: string
  files: EvaluationSourceFiles
  hashes: Record<string, string>
}

interface EvaluationPaths {
  promptFile: string
  draftFile: string
}

interface EvaluationAttempt {
  number: number
  promptFile: string
  stdoutFile: string
  stderrFile: string
  resultFile: string
  metadataFile: string
}

interface EvaluationScore {
  total: number
  [key: string]: unknown
}

interface EvaluationMetadata {
  run: string
  case_id: string
  model: string
  probe: string
  attempt: number
  started_at: string
  finished_at: string
  timeout_ms: number
  timed_out: boolean
  exit_code: number | null
  signal: NodeJS.Signals | null
  status: 'failed' | 'completed'
  error: string | null
  codex_command: string
  codex_args: string[]
  codex_model: string | null
  prompt_file: string
  attempt_prompt_file: string
  schema_file: string
  evaluator_file: string
  rubric_file: string
  candidate_output_file: string
  hashes: Record<string, string>
  result_sha256?: string
}

interface RunProcessOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  input: string
  timeoutMs: number
  maxBuffer: number
}

interface RunProcessResult {
  status: number | null
  signal: NodeJS.Signals | null
  error: NodeJS.ErrnoException | null
  stdout: string
  stderr: string
}

interface ExecuteEvaluationOptions {
  run: string
  caseId: string
  model: string
  probe: string
  codexBin: string
  codexModel: string | null
  timeoutMs: number
  maxBuffer: number
}

const parseList = parseListTyped as (value: ArgValue, fallback: string[]) => string[]
const buildEvaluationPrompt = buildEvaluationPromptTyped as unknown as (
  run: string,
  caseId: string,
  model: string,
  probe: string,
) => BuiltEvaluationPrompt
const evaluationPaths = evaluationPathsTyped as unknown as (
  run: string,
  caseId: string,
  model: string,
  probe: string,
) => EvaluationPaths
const nextEvaluationAttempt = nextEvaluationAttemptTyped as unknown as (paths: EvaluationPaths) => EvaluationAttempt
const validateEvaluationScore = validateEvaluationScoreTyped as unknown as (
  score: EvaluationScore,
  expected: { case_id: string; model: string; probe: string },
) => EvaluationScore
const buildCodexArgs = buildCodexArgsTyped as (options: {
  workDir: string
  schemaFile: string
  resultFile: string
  codexModel?: string | null
}) => string[]

export function positiveInteger(value: unknown, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

export function runProcess(command: string, args: string[], options: RunProcessOptions): Promise<RunProcessResult> {
  return new Promise((resolve: any) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let error: NodeJS.ErrnoException | null = null
    let killed = false
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const timeout = setTimeout(() => {
      killed = true
      error = new Error(`timed out after ${options.timeoutMs}ms`) as NodeJS.ErrnoException
      error.code = 'ETIMEDOUT'
      child.kill('SIGKILL')
    }, options.timeoutMs)

    function append(target: Buffer[], chunk: Buffer): void {
      target.push(chunk)
      outputBytes += chunk.length
      if (!killed && outputBytes > options.maxBuffer) {
        killed = true
        error = new Error(`combined stdout/stderr exceeded maxBuffer ${options.maxBuffer}`) as NodeJS.ErrnoException
        error.code = 'ENOBUFS'
        child.kill('SIGKILL')
      }
    }

    child.stdout!.on('data', (chunk: Buffer) => append(stdout, chunk))
    child.stderr!.on('data', (chunk: Buffer) => append(stderr, chunk))
    child.on('error', (spawnError: any) => {
      if (!error) {
        error = spawnError
      }
    })
    child.on('close', (status: any, signal: any) => {
      clearTimeout(timeout)
      resolve({
        status,
        signal,
        error,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
    child.stdin!.on('error', (stdinError: NodeJS.ErrnoException) => {
      if (stdinError.code !== 'EPIPE' && !error) {
        error = stdinError
      }
    })
    child.stdin!.end(options.input)
  })
}

export async function executeEvaluation(options: ExecuteEvaluationOptions): Promise<{
  status: 'skipped' | 'completed'
  paths: EvaluationPaths
  score?: EvaluationScore
}> {
  const paths = evaluationPaths(options.run, options.caseId, options.model, options.probe)
  if (fs.existsSync(paths.draftFile)) {
    console.log(`[skip] draft exists: ${path.relative(ROOT, paths.draftFile)}`)
    return { status: 'skipped', paths }
  }

  const built = buildEvaluationPrompt(options.run, options.caseId, options.model, options.probe)
  writeGenerated(paths.promptFile, built.prompt)
  const attempt = nextEvaluationAttempt(paths)
  writeFileNew(attempt.promptFile, built.prompt)

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-role-evaluation-'))
  const schemaFile = evaluationSchemaFile()
  const commandArgs = buildCodexArgs({
    workDir,
    schemaFile,
    resultFile: attempt.resultFile,
    codexModel: options.codexModel,
  })
  const startedAt = new Date().toISOString()
  let child: RunProcessResult
  try {
    child = await runProcess(options.codexBin, commandArgs, {
      cwd: workDir,
      env: {
        ...process.env,
        MODEL_ROLE_CALIBRATION_EVALUATION_MODEL: options.model,
        MODEL_ROLE_CALIBRATION_EVALUATION_PROBE: options.probe,
      },
      input: built.prompt,
      timeoutMs: options.timeoutMs,
      maxBuffer: options.maxBuffer,
    })
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }

  if (child.stdout) {
    writeFileNew(attempt.stdoutFile, child.stdout)
  }
  if (child.stderr) {
    writeFileNew(attempt.stderrFile, child.stderr)
  }

  const metadata: EvaluationMetadata = {
    run: options.run,
    case_id: options.caseId,
    model: options.model,
    probe: options.probe,
    attempt: attempt.number,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timeout_ms: options.timeoutMs,
    timed_out: child.error?.code === 'ETIMEDOUT',
    exit_code: child.status,
    signal: child.signal,
    status: 'failed',
    error: child.error ? child.error.message : null,
    codex_command: options.codexBin,
    codex_args: commandArgs,
    codex_model: options.codexModel || null,
    prompt_file: path.relative(ROOT, paths.promptFile),
    attempt_prompt_file: path.relative(ROOT, attempt.promptFile),
    schema_file: path.relative(ROOT, schemaFile),
    evaluator_file: path.relative(ROOT, built.files.evaluatorFile),
    rubric_file: path.relative(ROOT, built.files.rubricFile),
    candidate_output_file: path.relative(ROOT, built.files.outputFile),
    hashes: {
      ...built.hashes,
      schema_sha256: hashText(readText(schemaFile)),
    },
  }

  if (child.error || child.status !== 0) {
    writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
    const reason = child.error?.message || `exited with status ${child.status}`
    throw new Error(`Codex evaluation failed for ${options.model}/${options.probe}: ${reason}`)
  }
  if (!fs.existsSync(attempt.resultFile)) {
    metadata.error = 'Codex did not write --output-last-message'
    writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
    throw new Error(`Codex evaluation produced no result for ${options.model}/${options.probe}`)
  }

  let score: EvaluationScore
  try {
    score = parseJsonFile<EvaluationScore>(attempt.resultFile)
    validateEvaluationScore(score, {
      case_id: options.caseId,
      model: options.model,
      probe: options.probe,
    })
  } catch (error: any) {
    metadata.error = error.message
    writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
    throw error
  }

  metadata.status = 'completed'
  metadata.error = null
  metadata.result_sha256 = hashText(JSON.stringify(score))
  writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
  writeFileNew(paths.draftFile, JSON.stringify(score, null, 2) + '\n')
  console.log(`[done] ${options.model}/${options.probe}: ${score.total}/25`)
  console.log(`  draft: ${path.relative(ROOT, paths.draftFile)}`)
  return { status: 'completed', paths, score }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  const run = requireArg(args, 'run')
  const caseId = requireArg(args, 'case')
  const probe = requireArg(args, 'probe')
  assertSafeCaseId(caseId)
  assertProbe(probe)

  const config = loadConfig<CalibrationConfig>()
  const models = parseList(args.models, config.models).map((item: any) => item.toLowerCase())
  for (const model of models) {
    if (!config.models.includes(model)) {
      throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`)
    }
  }

  const execute = Boolean(args.execute)
  const codexBin = process.env.MODEL_ROLE_CALIBRATION_CODEX_BIN || 'codex'
  const codexModel = args['codex-model'] && args['codex-model'] !== true ? String(args['codex-model']) : null
  const timeoutMs = positiveInteger(
    args['timeout-ms'] && args['timeout-ms'] !== true ? args['timeout-ms'] : config.agent_execution.timeout_ms,
    '--timeout-ms',
  )
  const maxBuffer = positiveInteger(config.agent_execution.max_buffer_bytes, 'agent_execution.max_buffer_bytes')

  for (const model of models) {
    const built = buildEvaluationPrompt(run, caseId, model, probe)
    const paths = evaluationPaths(run, caseId, model, probe)
    writeGenerated(paths.promptFile, built.prompt)
    console.log(`[prompt] ${model}/${probe}: ${path.relative(ROOT, paths.promptFile)}`)
  }

  if (!execute) {
    console.log('\nEvaluation prompts generated. No model was executed.')
    console.log('Run the same command with --execute to create draft scores.')
    return
  }

  console.log(`\nRunning ${models.length} Codex evaluation(s) for role ${probe}...`)
  const failures: Array<{ model: string; error: unknown }> = []
  for (const model of models) {
    try {
      await executeEvaluation({
        run,
        caseId,
        model,
        probe,
        codexBin,
        codexModel,
        timeoutMs,
        maxBuffer,
      })
    } catch (error: any) {
      failures.push({ model, error })
      console.error(`[fail] ${model}/${probe}: ${error.message}`)
    }
  }
  if (failures.length) {
    throw new Error(`${failures.length} evaluation(s) failed; retry the same role after inspection`)
  }

  console.log('\nDraft evaluations completed. Review all four drafts before promotion.')
  console.log('No formal score files were modified.')
}

if (isMainScript(__filename)) {
  main().catch((error: any) => {
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
}
