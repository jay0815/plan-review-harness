import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  FACT_CHECK_ROOT as FACT_CHECK_ROOT_UNTYPED,
  assertFactCheckCaseId as assertFactCheckCaseIdUntyped,
  ingestOutput as ingestOutputUntyped,
  loadCase as loadCaseUntyped,
  renderFactCheckPrompt as renderFactCheckPromptUntyped,
  scoreOutput as scoreOutputUntyped,
  summarizeRun as summarizeFactCheckRunUntyped,
} from '../cli/fact-check-calibration-lib.js'
import {
  buildCliArgs as buildCliArgsUntyped,
  parseAssistantOutput as parseAssistantOutputUntyped,
  resolveWrapperCommand as resolveWrapperCommandUntyped,
  runCommand as runCommandUntyped,
} from '../cli/run-model.js'
import {
  buildFactCheckReadScope as buildFactCheckReadScopeUntyped,
  copyScopedWorkspace as copyScopedWorkspaceUntyped,
} from '../workspace-review-lib.js'
import { ensureDir, parseJsonFile, positiveInteger, readText, slug, writeFileNew, writeGenerated } from './core.js'

type JsonObject = Record<string, unknown>

interface CalibrationConfig {
  models: string[]
  agent_execution: {
    timeout_ms: number
    max_buffer_bytes: number
  }
}

interface FactCheckJob {
  run: string
  caseId: string
  model: string
  probe: typeof CALIBRATION_PROBE
}

interface ArtifactPaths {
  base: string
  outputDir: string
  attemptsDir: string
  resultFile: string
  rawCliFile: string
  metadataFile: string
}

interface AttemptPaths {
  number: number
  label: string
  rawCliFile: string
  rawTextFile: string
  resultFile: string
  metadataFile: string
  validatorLogFile: string
}

interface ReadBoundary {
  files?: string[]
  blocked_refs?: string[]
  skipped_refs?: string[]
  exposed_root: string
}

interface ParsedAssistantOutput {
  envelope: unknown
  output: JsonObject
}

interface WrapperCommand {
  command: string
  args: string[]
}

interface RunCommandResult {
  stdout: string
  stderr: string
  status: number | null
  signal: NodeJS.Signals | null
  error: NodeJS.ErrnoException | null
}

interface Metadata {
  run: string
  case_id: string
  model: string
  probe: typeof CALIBRATION_PROBE
  attempt: number
  started_at: string
  status: 'failed' | 'completed'
  finished_at?: string
  exit_code?: number | null
  signal?: NodeJS.Signals | null
  timed_out?: boolean
  command?: string
  command_args?: string[]
  json_validator_enabled?: boolean
  validator_log_file?: string | null
  stderr?: string
  error?: string | null
  recovered_from_validator?: boolean
}

interface ScoreResult {
  metrics: {
    status_accuracy: number | null
    challenge_recall: number | null
    [key: string]: unknown
  }
}

interface PromptInfo {
  promptDir: string
  promptHash: string
  prompts: Array<{
    model: string
    probe: typeof CALIBRATION_PROBE
    file: string
  }>
}

const FACT_CHECK_ROOT = FACT_CHECK_ROOT_UNTYPED as string
const assertFactCheckCaseId = assertFactCheckCaseIdUntyped as (caseId: string) => void
const ingestOutput = ingestOutputUntyped as (options: {
  run: string
  caseId: string
  model: string
  file: string
}) => unknown
const loadCase = loadCaseUntyped as (caseId: string) => JsonObject
const renderFactCheckPrompt = renderFactCheckPromptUntyped as (fixture: JsonObject) => string
const scoreOutput = scoreOutputUntyped as (options: { run: string; caseId: string; model: string }) => ScoreResult
const summarizeFactCheckRun = summarizeFactCheckRunUntyped as (run: string) => object

const buildFactCheckReadScope = buildFactCheckReadScopeUntyped as (...args: unknown[]) => unknown
const copyScopedWorkspace = copyScopedWorkspaceUntyped as (...args: unknown[]) => unknown
void buildFactCheckReadScope
void copyScopedWorkspace

const buildCliArgs = buildCliArgsUntyped as (
  wrapperArgs: string[],
  schema: unknown,
  options: {
    persistSession: boolean
    jsonValidator: boolean
    run: string
    model: string
    probe: string
    schemaFile: string
    validatorLogFile: string
    attemptLabel: string
    tools: string
    permissionMode: string
    addDir: string | null
  },
) => string[]
const parseAssistantOutput = parseAssistantOutputUntyped as (stdout: string, probe: string) => ParsedAssistantOutput
const resolveWrapperCommand = resolveWrapperCommandUntyped as (
  shell: string,
  model: string,
  timeoutMs: number,
  maxBuffer: number,
) => WrapperCommand
const runCommand = runCommandUntyped as (
  command: string,
  args: string[],
  options: {
    cwd: string
    input: string
    timeoutMs: number
    killSignal: NodeJS.Signals
    maxBuffer: number
    validatorLogFile: string | null
    env: NodeJS.ProcessEnv
  },
) => Promise<RunCommandResult>

export const CALIBRATION_PROBE = 'fact_check'
export const DEFAULT_CONCURRENCY = 2

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function promptPaths(run: string, caseId: string): string {
  return path.join(FACT_CHECK_ROOT, 'runs', run, caseId, 'prompts')
}

function scopedPaths(run: string, caseId: string): string {
  return path.join(FACT_CHECK_ROOT, 'runs', run, caseId, 'scoped')
}

function artifactPaths(run: string, caseId: string, model: string): ArtifactPaths {
  const base = path.join(FACT_CHECK_ROOT, 'runs', run, caseId)
  const modelSlug = slug(model)
  return {
    base,
    outputDir: path.join(base, 'agent-outputs', modelSlug),
    attemptsDir: path.join(base, 'agent-outputs', modelSlug, 'attempts'),
    resultFile: path.join(base, 'agent-outputs', modelSlug, 'result.json'),
    rawCliFile: path.join(base, 'agent-outputs', modelSlug, 'cli.json'),
    metadataFile: path.join(base, 'agent-outputs', modelSlug, 'meta.json'),
  }
}

function nextAttempt(paths: ArtifactPaths): AttemptPaths {
  ensureDir(paths.attemptsDir)
  const attempts = fs
    .readdirSync(paths.attemptsDir)
    .map((name) => /^attempt-(\d+)\.meta\.json$/.exec(name))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number(match[1]))
  const number = attempts.length ? Math.max(...attempts) + 1 : 1
  const label = `attempt-${String(number).padStart(3, '0')}`
  return {
    number,
    label,
    rawCliFile: path.join(paths.attemptsDir, `${label}.cli.json`),
    rawTextFile: path.join(paths.attemptsDir, `${label}.cli.txt`),
    resultFile: path.join(paths.attemptsDir, `${label}.result.json`),
    metadataFile: path.join(paths.attemptsDir, `${label}.meta.json`),
    validatorLogFile: path.join(paths.attemptsDir, `${label}.validator.log`),
  }
}

function completedOutputExists(run: string, caseId: string, model: string): boolean {
  const normalized = path.join(FACT_CHECK_ROOT, 'runs', run, caseId, 'outputs', 'normalized', `${slug(model)}.json`)
  return fs.existsSync(normalized)
}

function log(message: string): void {
  console.error(`[run-fact-check] ${new Date().toISOString()} ${message}`)
}

function renderScopedPrompt(fixture: JsonObject, projectRoot: string, readBoundary: ReadBoundary): string {
  const fileList = readBoundary.files?.length
    ? readBoundary.files.map((file) => `- ${file}`).join('\n')
    : '- （无可读取工程文件）'
  const blocked = readBoundary.blocked_refs?.length
    ? ['', '已阻止的外部路径引用：', ...readBoundary.blocked_refs.map((item) => `- ${item}`)].join('\n')
    : ''
  const skipped = readBoundary.skipped_refs?.length
    ? ['', '未暴露或不存在的引用：', ...readBoundary.skipped_refs.slice(0, 30).map((item) => `- ${item}`)].join('\n')
    : ''
  return [
    '# 工程读取能力',
    '',
    `工程原始目录：\`${projectRoot}\``,
    `只读镜像目录：\`${readBoundary.exposed_root}\``,
    '',
    '你可以且只能使用 Read 读取下列相对路径对应的镜像文件。',
    '读取时使用只读镜像目录下的绝对路径；禁止使用 Glob/Grep 搜索新证据，禁止新增 Reviewer 未提出的问题。',
    '',
    '可读取文件：',
    fileList,
    blocked,
    skipped,
    '',
    renderFactCheckPrompt(fixture),
  ]
    .filter(Boolean)
    .join('\n')
}
void scopedPaths
void renderScopedPrompt

function extractValidatorCandidate(stdout: string): ParsedAssistantOutput | null {
  const lines = String(stdout || '')
    .trim()
    .split(/\n+/)
    .filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let event: JsonObject
    try {
      const parsed = JSON.parse(lines[index] as string) as unknown
      if (!isRecord(parsed)) {
        continue
      }
      event = parsed
    } catch {
      continue
    }
    const message = isRecord(event.message) ? event.message : null
    const content = message?.content
    if (!Array.isArray(content)) {
      continue
    }
    for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const block = content[contentIndex]
      if (!isRecord(block) || !isRecord(block.input)) {
        continue
      }
      if (
        block.type === 'tool_use' &&
        block.name === 'mcp__json_validator__validate_json_output' &&
        typeof block.input.candidate_text === 'string'
      ) {
        try {
          return parseAssistantOutput(block.input.candidate_text, CALIBRATION_PROBE)
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function writeCompletedArtifacts(
  paths: ArtifactPaths,
  attempt: AttemptPaths,
  metadata: Metadata,
  parsed: ParsedAssistantOutput,
): void {
  metadata.status = 'completed'
  metadata.error = null
  writeFileNew(attempt.rawCliFile, JSON.stringify(parsed.envelope, null, 2) + '\n')
  writeFileNew(attempt.resultFile, JSON.stringify(parsed.output, null, 2) + '\n')
  writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
  writeGenerated(paths.rawCliFile, JSON.stringify(parsed.envelope, null, 2) + '\n')
  writeGenerated(paths.resultFile, JSON.stringify(parsed.output, null, 2) + '\n')
  writeGenerated(paths.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
}

export class FactCheckExecutor {
  get type(): string {
    return 'fact_check'
  }

  get root(): string {
    return FACT_CHECK_ROOT
  }

  validateOptions({ caseId, models, config }: { caseId: string; models: string[]; config: CalibrationConfig }): void {
    assertFactCheckCaseId(caseId)
    if (!models.length) {
      throw new Error('At least one model is required')
    }
    for (const model of models) {
      if (!config.models.includes(model)) {
        throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`)
      }
    }
  }

  uniqueRunId(caseId: string): string {
    const base = `${slug(caseId)}-${new Date()
      .toISOString()
      .replace(/[-:.]/g, '')
      .replace(/\d{3}Z$/, 'Z')}`
    let run = base
    let suffix = 2
    while (fs.existsSync(path.join(FACT_CHECK_ROOT, 'runs', run))) {
      run = `${base}-${suffix}`
      suffix += 1
    }
    return run
  }

  generatePrompts({ run, caseId, models }: { run: string; caseId: string; models: string[] }): PromptInfo {
    const fixture = loadCase(caseId)
    const prompt = renderFactCheckPrompt(fixture)
    const promptDir = promptPaths(run, caseId)
    ensureDir(promptDir)
    writeGenerated(path.join(promptDir, 'fact_check.md'), prompt)
    for (const model of models) {
      writeGenerated(path.join(promptDir, `${slug(model)}-fact_check.md`), prompt)
    }
    return {
      promptDir,
      promptHash: sha256(prompt),
      prompts: models.map((model) => ({
        model,
        probe: CALIBRATION_PROBE,
        file: path.join(promptDir, `${slug(model)}-fact_check.md`),
      })),
    }
  }

  buildJobs({ run, caseId, models }: { run: string; caseId: string; models: string[] }): FactCheckJob[] {
    return models.map((model) => ({
      run,
      caseId,
      model,
      probe: CALIBRATION_PROBE,
    }))
  }

  async runJob(
    job: FactCheckJob,
  ): Promise<{ model: string; status: string; error?: string; recovered_from_validator?: boolean }> {
    const { run, caseId, model } = job
    if (completedOutputExists(run, caseId, model)) {
      log(`[skip] ${model}: normalized output already exists`)
      return { model, status: 'skipped' }
    }

    const paths = artifactPaths(run, caseId, model)
    ensureDir(paths.outputDir)
    const attempt = nextAttempt(paths)
    const startedAt = new Date().toISOString()
    const metadataBase: Metadata = {
      run,
      case_id: caseId,
      model,
      probe: CALIBRATION_PROBE,
      attempt: attempt.number,
      started_at: startedAt,
      status: 'failed',
    }

    log(`[start] ${model} ${attempt.label}`)

    const config = parseJsonFile<CalibrationConfig>(path.join(path.dirname(FACT_CHECK_ROOT), 'calibration.config.json'))
    const executionConfig = config.agent_execution
    const timeoutMs = positiveInteger(executionConfig.timeout_ms, 'agent_execution.timeout_ms')
    const maxBuffer = positiveInteger(executionConfig.max_buffer_bytes, 'agent_execution.max_buffer_bytes')
    const shell = process.env.MODEL_ROLE_CALIBRATION_SHELL || '/bin/zsh'
    const jsonValidator = true
    const schemaFile = path.join(path.dirname(FACT_CHECK_ROOT), 'schemas', 'fact-check-output.schema.json')
    const schema = parseJsonFile(schemaFile)

    const promptDir = promptPaths(run, caseId)
    const promptFile = path.join(promptDir, `${slug(model)}-fact_check.md`)
    const prompt = readText(promptFile)

    const wrapper = resolveWrapperCommand(shell, model, 10000, maxBuffer)
    const cliArgs = buildCliArgs(wrapper.args, schema, {
      persistSession: false,
      jsonValidator,
      run,
      model,
      probe: CALIBRATION_PROBE,
      schemaFile,
      validatorLogFile: attempt.validatorLogFile,
      attemptLabel: attempt.label,
      tools: '',
      permissionMode: 'default',
      addDir: null,
    })

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-check-calibration-'))
    let child: RunCommandResult
    try {
      child = await runCommand(wrapper.command, cliArgs, {
        cwd: workDir,
        input: prompt,
        timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer,
        validatorLogFile: jsonValidator ? attempt.validatorLogFile : null,
        env: {
          ...process.env,
          CLAUDE_CODE_SIMPLE: '1',
          MODEL_ROLE_CALIBRATION_MODEL: model,
          MODEL_ROLE_CALIBRATION_PROBE: CALIBRATION_PROBE,
          MODEL_ROLE_CALIBRATION_ATTEMPT: attempt.label,
        },
      })
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
    }

    const metadata: Metadata = {
      ...metadataBase,
      finished_at: new Date().toISOString(),
      exit_code: child.status,
      signal: child.signal,
      timed_out: child.error?.code === 'ETIMEDOUT',
      command: wrapper.command,
      command_args: cliArgs,
      json_validator_enabled: jsonValidator,
      validator_log_file: jsonValidator ? attempt.validatorLogFile : null,
      stderr: child.stderr || '',
      error: child.error ? child.error.message : null,
    }

    if (child.error || child.status !== 0) {
      const recovered = extractValidatorCandidate(child.stdout)
      if (recovered) {
        metadata.recovered_from_validator = true
        writeCompletedArtifacts(paths, attempt, metadata, recovered)
        ingestOutput({ run, caseId, model, file: paths.resultFile })
        const score = scoreOutput({ run, caseId, model })
        log(
          `[recovered] ${model}: status_accuracy=${score.metrics.status_accuracy} challenge_recall=${score.metrics.challenge_recall}`,
        )
        return {
          model,
          status: 'completed',
          recovered_from_validator: true,
        }
      }
      if (child.stdout) {
        writeFileNew(attempt.rawTextFile, child.stdout)
      }
      writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
      log(`[fail] ${model}: command failed`)
      return { model, status: 'failed', error: metadata.error || `exit ${child.status}` }
    }

    let parsed: ParsedAssistantOutput
    try {
      parsed = parseAssistantOutput(child.stdout, CALIBRATION_PROBE)
    } catch (error) {
      metadata.error = errorMessage(error)
      writeFileNew(attempt.rawTextFile, child.stdout)
      writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
      log(`[fail] ${model}: invalid JSON output`)
      return { model, status: 'failed', error: errorMessage(error) }
    }

    metadata.status = 'completed'
    writeCompletedArtifacts(paths, attempt, metadata, parsed)

    ingestOutput({ run, caseId, model, file: paths.resultFile })
    const score = scoreOutput({ run, caseId, model })
    log(
      `[done] ${model}: status_accuracy=${score.metrics.status_accuracy} challenge_recall=${score.metrics.challenge_recall}`,
    )
    return { model, status: 'completed' }
  }

  summarizeRun(run: string): object {
    return summarizeFactCheckRun(run)
  }
}
