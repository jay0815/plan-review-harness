#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  ROOT,
  isMainScript,
  parseArgs,
  requireArg,
  assertSafeCaseId,
  assertProbe,
  ensureDir,
  readText,
  writeFileNew,
  writeGenerated,
  loadConfig,
  parseJsonFile,
  schemaForProbe,
  agentOutputPaths,
  runtimeNodeScriptArgs,
} from '../lib/lib.js'

const ALIAS_MARKER = Buffer.from('\0MRC_ARGV\0')
const CALIBRATION_SYSTEM_PROMPT = [
  'You are a non-interactive calibration probe runner.',
  'Follow the user prompt exactly.',
].join(' ')
const HEARTBEAT_MS = 30000

type JsonRecord = Record<string, unknown>

interface OutputCandidate {
  output: JsonRecord
  matched: boolean
}

interface ToolResultCandidate {
  toolUseId: string
  result: JsonRecord
}

interface AttemptFiles {
  rawJsonFile: string
  rawTextFile: string
  resultFile: string
  metadataFile: string
  validatorLogFile: string
}

interface AttemptPaths extends AttemptFiles {
  number: number
  label: string
}

interface DynamicEnvelope extends JsonRecord {
  structured_output: JsonRecord
  result?: unknown
  probe?: unknown
  type?: unknown
  is_error?: unknown
  error?: unknown
}

type AssistantEnvelope = (DynamicEnvelope | unknown[]) & { length?: number }

interface AgentPaths {
  outputDir: string
  resultFile: string
  rawFile: string
  metadataFile: string
  attemptsDir: string
}

interface CalibrationConfig {
  models: string[]
  agent_execution: {
    timeout_ms: number
    alias_resolution_timeout_ms: number
    max_buffer_bytes: number
  }
}

interface CliArgsOptions {
  persistSession: boolean
  jsonValidator?: boolean
  run: string
  model: string
  probe: string
  schemaFile?: string
  validatorLogFile?: string | null
  attemptLabel?: string
  tools?: string
  permissionMode?: string
  addDir?: string
}

interface WrapperCommand {
  command: string
  args: string[]
}

interface RunCommandOptions {
  cwd: string
  input: string
  timeoutMs: number
  killSignal: NodeJS.Signals
  maxBuffer: number
  validatorLogFile?: string | null
  env: NodeJS.ProcessEnv
}

interface RunCommandResult {
  stdout: string
  stderr: string
  status: number | null
  signal: NodeJS.Signals | null
  error: (Error & { code?: string }) | null
}

interface AttemptMetadata {
  [key: string]: unknown
  run: string
  case_id: string
  model: string
  probe: string
  attempt: number
  started_at: string
  finished_at?: string
  timeout_ms: number
  timed_out?: boolean
  exit_code?: number | null
  signal?: NodeJS.Signals | null
  command?: string | null
  command_args?: string[]
  persist_session?: boolean
  session_name?: string | null
  prompt_file: string
  schema_file: string
  stderr?: string
  error?: string | null
  status?: string
}

interface ParsedAssistantOutput {
  envelope: AssistantEnvelope
  output: JsonRecord
}

interface ValidatorLogEvent {
  event?: string
  valid?: boolean
  stage?: string
  error_count?: number
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function extractJsonObjects(text: string): string[] {
  const objects: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (start === -1) {
      if (char === '{') {
        start = index
        depth = 1
        inString = false
        escaped = false
      }
      continue
    }
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        objects.push(text.slice(start, index + 1))
        start = -1
      }
    }
  }
  return objects
}

function parseJsonEnvelope<T = DynamicEnvelope>(stdout: unknown): T {
  const text = String(stdout || '').trim()
  let parseError: unknown
  try {
    return JSON.parse(text) as T
  } catch (error: unknown) {
    parseError = error
    const candidates = extractJsonObjects(text)
    const parsedCandidates: unknown[] = []
    for (const candidate of candidates) {
      try {
        parsedCandidates.push(JSON.parse(candidate))
      } catch (candidateError: unknown) {
        parseError = candidateError
        // Continue collecting complete stream-json events.
      }
    }
    if (parsedCandidates.length === 1) {
      return parsedCandidates[0] as T
    }
    if (parsedCandidates.length > 1) {
      return parsedCandidates as T
    }
  }
  const message = parseError instanceof Error ? parseError.message : ''
  const detail = message ? `: ${message}` : ''
  const match = message ? /position (\d+)/.exec(message) : null
  const position = match ? Number(match[1]) : null
  const context =
    position !== null && Number.isInteger(position)
      ? ` near ${JSON.stringify(text.slice(Math.max(0, position - 120), position + 120))}`
      : ''
  throw new Error(`Claude Code output does not contain a valid JSON object${detail}${context}`)
}

function parseOutputValue(value: unknown): unknown {
  if (isRecord(value) || Array.isArray(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return null
  }
  const result = value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  return parseJsonEnvelope(result)
}

function findOutputCandidate(value: unknown, probe: string): OutputCandidate | null {
  if (!isRecord(value) && !Array.isArray(value)) {
    return null
  }
  if (Array.isArray(value)) {
    let fallback: OutputCandidate | null = null
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const candidate = findOutputCandidate(value[index], probe)
      if (!candidate) {
        continue
      }
      if (candidate.matched) {
        return candidate
      }
      fallback ||= candidate
    }
    return fallback
  }
  if (Object.prototype.hasOwnProperty.call(value, 'probe')) {
    return {
      output: value as JsonRecord,
      matched: value.probe === probe,
    }
  }
  if (value.structured_output && typeof value.structured_output === 'object') {
    return (
      findOutputCandidate(value.structured_output, probe) || {
        output: value.structured_output as JsonRecord,
        matched: false,
      }
    )
  }
  if (value.result !== undefined) {
    const parsedResult = parseOutputValue(value.result)
    const candidate = findOutputCandidate(parsedResult, probe)
    if (candidate) {
      return candidate
    }
    if (isRecord(parsedResult)) {
      return {
        output: parsedResult,
        matched: false,
      }
    }
  }
  const content = isRecord(value.message) ? value.message.content : undefined
  if (Array.isArray(content)) {
    let fallback: OutputCandidate | null = null
    for (let index = content.length - 1; index >= 0; index -= 1) {
      const block = content[index]
      if (block?.type !== 'text' || typeof block.text !== 'string') {
        continue
      }
      try {
        const parsedText = parseOutputValue(block.text)
        const candidate = findOutputCandidate(parsedText, probe)
        if (candidate?.matched) {
          return candidate
        }
        fallback ||= candidate
      } catch {
        // Continue to earlier text blocks.
      }
    }
    return fallback
  }
  return null
}

function parseToolResultBlock(block: unknown): ToolResultCandidate | null {
  if (!isRecord(block) || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
    return null
  }
  const content = Array.isArray(block.content)
    ? block.content.map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : '')).join('\n')
    : String(block.content || '')
  if (!content.trim()) {
    return null
  }
  try {
    const result = parseJsonEnvelope(content)
    if (!isRecord(result)) {
      return null
    }
    return {
      toolUseId: block.tool_use_id,
      result,
    }
  } catch {
    return null
  }
}

function validatedToolUseIds(envelope: unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const item of envelope) {
    const content = isRecord(item) && isRecord(item.message) ? item.message.content : undefined
    if (!Array.isArray(content)) {
      continue
    }
    for (const block of content) {
      const parsed = parseToolResultBlock(block)
      if (parsed?.result?.valid === true) {
        ids.add(parsed.toolUseId)
      }
    }
  }
  return ids
}

function findValidatedToolCandidate(envelope: unknown[], probe: string): JsonRecord | null {
  const validIds = validatedToolUseIds(envelope)
  if (!validIds.size) {
    return null
  }
  for (let itemIndex = envelope.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = envelope[itemIndex]
    const content = isRecord(item) && isRecord(item.message) ? item.message.content : undefined
    if (!Array.isArray(content)) {
      continue
    }
    for (let blockIndex = content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = content[blockIndex]
      if (
        !isRecord(block) ||
        block.type !== 'tool_use' ||
        block.name !== 'mcp__json_validator__validate_json_output' ||
        typeof block.id !== 'string' ||
        !validIds.has(block.id) ||
        !isRecord(block.input) ||
        typeof block.input.candidate_text !== 'string'
      ) {
        continue
      }
      const parsed = parseOutputValue(block.input.candidate_text)
      const candidate = findOutputCandidate(parsed, probe)
      if (candidate?.matched) {
        return candidate.output
      }
    }
  }
  return null
}

function parseArrayEnvelope(envelope: unknown[], probe: string): JsonRecord | null {
  let fallback: JsonRecord | null = null
  let parseError: unknown = null
  for (let index = envelope.length - 1; index >= 0; index -= 1) {
    const item = envelope[index]
    if (!item || typeof item !== 'object') {
      continue
    }
    if (isRecord(item) && item.type === 'result' && item.is_error) {
      throw new Error(`Claude Code result is_error: ${String(item.result || item.error || 'unknown')}`)
    }
    let candidate: OutputCandidate | null = null
    try {
      candidate = findOutputCandidate(item, probe)
    } catch (error: unknown) {
      parseError ||= error
      continue
    }
    if (candidate?.matched) {
      return candidate.output
    }
    fallback ||= candidate?.output || null
  }
  const validatedCandidate = findValidatedToolCandidate(envelope, probe)
  if (validatedCandidate) {
    return validatedCandidate
  }
  if (fallback) {
    return fallback
  }
  if (parseError) {
    throw parseError
  }
  return null
}

function parseAssistantOutput(stdout: unknown, probe: string): ParsedAssistantOutput {
  const envelope = parseJsonEnvelope<AssistantEnvelope>(stdout)
  let output: unknown

  if (Array.isArray(envelope)) {
    output = parseArrayEnvelope(envelope, probe)
  } else if (isRecord(envelope) && envelope.type === 'result' && envelope.is_error) {
    throw new Error(`Claude Code result is_error: ${String(envelope.result || envelope.error || 'unknown')}`)
  } else if (isRecord(envelope) && envelope.probe) {
    output = envelope
  } else if (isRecord(envelope) && isRecord(envelope.structured_output)) {
    output = envelope.structured_output
  } else if (isRecord(envelope) && isRecord(envelope.result)) {
    output = findOutputCandidate(envelope.result, probe)?.output || envelope.result
  } else if (isRecord(envelope) && typeof envelope.result === 'string') {
    const parsedResult = parseOutputValue(envelope.result)
    output = findOutputCandidate(parsedResult, probe)?.output || parsedResult
  } else {
    throw new Error('Claude Code JSON output does not contain result or structured_output')
  }

  if (!isRecord(output)) {
    throw new Error('Claude Code JSON output does not contain result or structured_output')
  }
  if (output.probe !== probe) {
    throw new Error(`Probe mismatch: output has "${output.probe}", expected "${probe}"`)
  }
  return { envelope, output }
}

function resolveWrapperCommand(shell: string, model: string, timeoutMs: number, maxBuffer: number): WrapperCommand {
  const resolver = [
    'alias_value=${aliases[$MODEL]-}',
    'if [[ -z $alias_value ]]; then',
    '  print -u2 -- "Missing Claude Code wrapper alias: $MODEL"',
    '  exit 127',
    'fi',
    'eval "set -- $alias_value"',
    "printf '\\0MRC_ARGV\\0'",
    'printf \'%s\\0\' "$@"',
  ].join('\n')
  const child = spawnSync(shell, ['-lic', resolver], {
    encoding: null,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer,
    env: {
      ...process.env,
      MODEL: model,
    },
  })
  const stdout = child.stdout || Buffer.alloc(0)
  const markerIndex = stdout.lastIndexOf(ALIAS_MARKER)
  if (child.error || child.status !== 0 || markerIndex === -1) {
    const stderr = (child.stderr || Buffer.alloc(0)).toString('utf8').trim()
    const reason = child.error?.message || stderr || `exit ${child.status}`
    throw new Error(`Unable to resolve wrapper alias "${model}": ${reason}`)
  }
  const commandParts = stdout
    .subarray(markerIndex + ALIAS_MARKER.length)
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  if (!commandParts.length) {
    throw new Error(`Wrapper alias "${model}" resolved to an empty command`)
  }
  return {
    command: commandParts[0],
    args: commandParts.slice(1),
  }
}

function nextAttempt(paths: AgentPaths): AttemptPaths {
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
    rawJsonFile: path.join(paths.attemptsDir, `${label}.cli.json`),
    rawTextFile: path.join(paths.attemptsDir, `${label}.cli.txt`),
    resultFile: path.join(paths.attemptsDir, `${label}.result.json`),
    metadataFile: path.join(paths.attemptsDir, `${label}.meta.json`),
    validatorLogFile: path.join(paths.attemptsDir, `${label}.validator.log`),
  }
}

function attemptFiles(paths: AgentPaths, label: string): AttemptFiles {
  if (!/^attempt-\d{3}$/.test(label)) {
    throw new Error(`Invalid attempt label "${label}". Expected attempt-001.`)
  }
  return {
    rawJsonFile: path.join(paths.attemptsDir, `${label}.cli.json`),
    rawTextFile: path.join(paths.attemptsDir, `${label}.cli.txt`),
    resultFile: path.join(paths.attemptsDir, `${label}.result.json`),
    metadataFile: path.join(paths.attemptsDir, `${label}.meta.json`),
    validatorLogFile: path.join(paths.attemptsDir, `${label}.validator.log`),
  }
}

function positiveInteger(value: unknown, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function buildCliArgs(wrapperArgs: string[], schema: unknown, options: CliArgsOptions): string[] {
  const maxTurns = options.jsonValidator ? '4' : '1'
  const tools = options.tools === undefined ? '' : options.tools
  const cliArgs = [
    ...wrapperArgs,
    '--bare',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--tools',
    tools,
    '--no-chrome',
    '--permission-mode',
    options.permissionMode || 'default',
    '--system-prompt',
    CALIBRATION_SYSTEM_PROMPT,
    '--input-format',
    'text',
    '--output-format',
    'stream-json',
    '--json-schema',
    JSON.stringify(schema),
    '--max-turns',
    maxTurns,
  ]

  if (options.jsonValidator) {
    cliArgs.push(
      '--mcp-config',
      JSON.stringify({
        mcpServers: {
          json_validator: {
            type: 'stdio',
            command: process.execPath,
            args: runtimeNodeScriptArgs('mcp/json-validator-mcp'),
            env: {
              MODEL_ROLE_CALIBRATION_SCHEMA_FILE: options.schemaFile,
              MODEL_ROLE_CALIBRATION_VALIDATOR_LOG: options.validatorLogFile,
              MODEL_ROLE_CALIBRATION_ATTEMPT: options.attemptLabel,
              MODEL_ROLE_CALIBRATION_MODEL: options.model,
              MODEL_ROLE_CALIBRATION_PROBE: options.probe,
            },
            alwaysLoad: true,
            timeout: 10000,
          },
        },
      }),
    )
    cliArgs.push('--allowed-tools', [tools, 'mcp__json_validator__validate_json_output'].filter(Boolean).join(','))
  } else if (tools) {
    cliArgs.push('--allowed-tools', tools)
  } else {
    cliArgs.push('--disallowed-tools', 'mcp__*')
  }

  if (options.persistSession) {
    cliArgs.push('--name', `mrc-${options.run}-${options.model}-${options.probe}`)
  } else {
    cliArgs.push('--no-session-persistence')
  }

  if (options.addDir) {
    cliArgs.push('--add-dir', options.addDir)
  }

  cliArgs.push('-p')
  return cliArgs
}

function logProgress(message: string): void {
  console.error(`[run-model] ${new Date().toISOString()} ${message}`)
}

function durationLabel(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes ? `${minutes}m${String(remainder).padStart(2, '0')}s` : `${remainder}s`
}

function validatorLogSummary(file: string | null | undefined): string {
  if (!file) {
    return ''
  }
  if (!fs.existsSync(file)) {
    return 'validatorLog=missing calls=0 last=none'
  }
  try {
    const stats = fs.statSync(file)
    const text = fs.readFileSync(file, 'utf8').trim()
    const lines = text ? text.split(/\n+/) : []
    let calls = 0
    let last: ValidatorLogEvent | null = null
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown
        const event = isRecord(parsed) ? (parsed as ValidatorLogEvent) : { event: 'json_value' }
        if (event.event === 'tool_call') {
          calls += 1
        }
        last = event
      } catch {
        last = { event: 'unparseable_log_line' }
      }
    }
    let lastLabel = 'none'
    if (last?.event === 'tool_call') {
      lastLabel = last.valid ? 'tool_call:valid' : `tool_call:${last.stage || 'invalid'}:${last.error_count || 0}`
    } else if (last?.event) {
      lastLabel = last.event
    }
    return `validatorLog=${stats.size}B calls=${calls} last=${lastLabel}`
  } catch (error: unknown) {
    return `validatorLog=error:${errorMessage(error)}`
  }
}

function summarizeArgs(args: string[]): string {
  const redactedValueFlags = new Set(['--json-schema', '--system-prompt', '--mcp-config'])
  const summary: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    summary.push(arg)
    if (redactedValueFlags.has(arg) && index + 1 < args.length) {
      summary.push('<redacted>')
      index += 1
    }
  }
  return summary.join(' ')
}

function runCommand(command: string, args: string[], options: RunCommandOptions): Promise<RunCommandResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let error: RunCommandResult['error'] = null
    let killed = false
    const startedAt = Date.now()

    logProgress(`starting process: ${command} ${summarizeArgs(args)}`)
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const heartbeat = setInterval(() => {
      const validatorStatus = validatorLogSummary(options.validatorLogFile)
      logProgress(
        `still running after ${durationLabel(Date.now() - startedAt)} ` +
          `(pid=${child.pid || 'unknown'}, stdout=${stdoutBytes}B, stderr=${stderrBytes}B` +
          `${validatorStatus ? `, ${validatorStatus}` : ''})`,
      )
    }, HEARTBEAT_MS)

    const timeout = setTimeout(() => {
      killed = true
      error = new Error(`timed out after ${options.timeoutMs}ms`)
      error.code = 'ETIMEDOUT'
      logProgress(`timeout reached after ${durationLabel(Date.now() - startedAt)}; sending ${options.killSignal}`)
      child.kill(options.killSignal)
    }, options.timeoutMs)

    function appendChunk(target: 'stdout' | 'stderr', chunk: Buffer): void {
      if (target === 'stdout') {
        stdoutChunks.push(chunk)
        stdoutBytes += chunk.length
      } else {
        stderrChunks.push(chunk)
        stderrBytes += chunk.length
      }

      if (!killed && stdoutBytes + stderrBytes > options.maxBuffer) {
        killed = true
        error = new Error(`combined stdout/stderr exceeded maxBuffer ${options.maxBuffer}`)
        error.code = 'ENOBUFS'
        logProgress(`maxBuffer exceeded; sending ${options.killSignal}`)
        child.kill(options.killSignal)
      }
    }

    child.stdout.on('data', (chunk: Buffer) => appendChunk('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => appendChunk('stderr', chunk))
    child.on('error', (spawnError: Error) => {
      if (!error) {
        error = spawnError
      }
    })
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      clearInterval(heartbeat)
      clearTimeout(timeout)
      const validatorStatus = validatorLogSummary(options.validatorLogFile)
      logProgress(
        `process finished after ${durationLabel(Date.now() - startedAt)} ` +
          `(exit=${code}, signal=${signal || 'none'}, stdout=${stdoutBytes}B, stderr=${stderrBytes}B` +
          `${validatorStatus ? `, ${validatorStatus}` : ''})`,
      )
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        status: code,
        signal,
        error,
      })
    })

    child.stdin.on('error', (stdinError: NodeJS.ErrnoException) => {
      if (stdinError.code !== 'EPIPE' && !error) {
        error = stdinError
      }
    })
    child.stdin.end(options.input)
  })
}

function writeCompletedArtifacts(
  paths: AgentPaths,
  attempt: AttemptPaths,
  metadata: AttemptMetadata,
  envelope: unknown,
  output: JsonRecord,
): void {
  metadata.status = 'completed'
  metadata.error = null
  writeFileNew(attempt.rawJsonFile, JSON.stringify(envelope, null, 2) + '\n')
  writeFileNew(attempt.resultFile, JSON.stringify(output, null, 2) + '\n')
  writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
  writeGenerated(paths.rawFile, JSON.stringify(envelope, null, 2) + '\n')
  writeGenerated(paths.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
  writeGenerated(paths.resultFile, JSON.stringify(output, null, 2) + '\n')
}

function reparseAttempt(
  paths: AgentPaths,
  sourceLabel: string,
  newAttempt: AttemptPaths,
  metadataBase: AttemptMetadata,
  probe: string,
): { sourceRawFile: string; output: JsonRecord } {
  const source = attemptFiles(paths, sourceLabel)
  const sourceRawFile = fs.existsSync(source.rawTextFile) ? source.rawTextFile : source.rawJsonFile
  if (!fs.existsSync(sourceRawFile)) {
    throw new Error(`Missing raw CLI output for ${sourceLabel}: ${source.rawTextFile} or ${source.rawJsonFile}`)
  }
  const stdout = readText(sourceRawFile)
  const parsed = parseAssistantOutput(stdout, probe)
  let sourceMetadata: Partial<AttemptMetadata> = {}
  if (fs.existsSync(source.metadataFile)) {
    sourceMetadata = parseJsonFile<Partial<AttemptMetadata>>(source.metadataFile)
  }
  const metadata: AttemptMetadata = {
    ...metadataBase,
    started_at: sourceMetadata.started_at || metadataBase.started_at,
    finished_at: new Date().toISOString(),
    timeout_ms: sourceMetadata.timeout_ms || metadataBase.timeout_ms,
    timed_out: false,
    exit_code: sourceMetadata.exit_code ?? 0,
    signal: sourceMetadata.signal ?? null,
    command: sourceMetadata.command || null,
    command_args: sourceMetadata.command_args || [],
    persist_session: Boolean(sourceMetadata.persist_session),
    session_name: sourceMetadata.session_name || null,
    stderr: sourceMetadata.stderr || '',
    reparsed_from_attempt: sourceLabel,
  }
  writeCompletedArtifacts(paths, newAttempt, metadata, parsed.envelope, parsed.output)
  return {
    sourceRawFile,
    output: parsed.output,
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const run = requireArg(args, 'run')
  const caseId = requireArg(args, 'case')
  const model = requireArg(args, 'model').toLowerCase()
  const probe = requireArg(args, 'probe')
  const force = args.force === true
  assertSafeCaseId(caseId)
  assertProbe(probe)

  const config = loadConfig<CalibrationConfig>()
  if (!config.models.includes(model)) {
    throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`)
  }

  const promptFile = path.join(ROOT, 'runs', run, caseId, 'prompts', `${probe}.md`)
  if (!fs.existsSync(promptFile)) {
    throw new Error(`Missing generated prompt: ${promptFile}`)
  }

  const paths = agentOutputPaths(run, caseId, model, probe)
  if (fs.existsSync(paths.resultFile) && !force) {
    console.log(`Model output already complete, skipping: ${paths.resultFile}`)
    return
  }
  if (force && fs.existsSync(paths.resultFile)) {
    logProgress(`force enabled; refreshing completed output: ${paths.resultFile}`)
  }
  ensureDir(paths.outputDir)

  const schemaFile = schemaForProbe(probe)
  const schema = parseJsonFile<unknown>(schemaFile)
  const executionConfig = config.agent_execution
  const timeoutMs = positiveInteger(
    args['timeout-ms'] && args['timeout-ms'] !== true ? args['timeout-ms'] : executionConfig.timeout_ms,
    '--timeout-ms',
  )
  const aliasTimeoutMs = positiveInteger(
    executionConfig.alias_resolution_timeout_ms,
    'agent_execution.alias_resolution_timeout_ms',
  )
  const maxBuffer = positiveInteger(executionConfig.max_buffer_bytes, 'agent_execution.max_buffer_bytes')
  const reparseAttemptLabel =
    args['reparse-attempt'] && args['reparse-attempt'] !== true ? String(args['reparse-attempt']) : null
  if (reparseAttemptLabel) {
    const attempt = nextAttempt(paths)
    const metadataBase: AttemptMetadata = {
      run,
      case_id: caseId,
      model,
      probe,
      attempt: attempt.number,
      started_at: new Date().toISOString(),
      timeout_ms: timeoutMs,
      prompt_file: path.relative(ROOT, promptFile),
      schema_file: path.relative(ROOT, schemaFile),
    }
    logProgress(`run=${run} case=${caseId} model=${model} probe=${probe} attempt=${attempt.label}`)
    logProgress(`reparsing existing attempt=${reparseAttemptLabel}`)
    const reparsed = reparseAttempt(paths, reparseAttemptLabel, attempt, metadataBase, probe)
    logProgress(`source raw CLI output=${reparsed.sourceRawFile}`)
    console.log(`Attempt reparsed: ${attempt.label}`)
    console.log(`Ingestable output saved: ${paths.resultFile}`)
    console.log(`Metadata saved: ${paths.metadataFile}`)
    return
  }

  const attempt = nextAttempt(paths)
  const shell = process.env.MODEL_ROLE_CALIBRATION_SHELL || '/bin/zsh'
  const persistSession = Boolean(args['persist-session'])
  const jsonValidator = Boolean(args['with-json-validator'])
  const validatorLogFile = jsonValidator ? attempt.validatorLogFile : null
  const sessionName = persistSession ? `mrc-${run}-${model}-${probe}` : null
  logProgress(`run=${run} case=${caseId} model=${model} probe=${probe} attempt=${attempt.label}`)
  logProgress(`prompt=${path.relative(ROOT, promptFile)} schema=${path.relative(ROOT, schemaFile)}`)
  logProgress(
    `timeout=${timeoutMs}ms maxBuffer=${maxBuffer} persistSession=${persistSession} jsonValidator=${jsonValidator}`,
  )
  if (validatorLogFile) {
    logProgress(`validator log=${validatorLogFile}`)
  }
  if (sessionName) {
    logProgress(`session name=${sessionName}`)
  }
  logProgress(`resolving alias with shell=${shell}`)
  const wrapper = resolveWrapperCommand(shell, model, aliasTimeoutMs, maxBuffer)
  logProgress(`alias resolved: command=${wrapper.command} args=${summarizeArgs(wrapper.args) || '(none)'}`)
  const cliArgs = buildCliArgs(wrapper.args, schema, {
    persistSession,
    jsonValidator,
    run,
    model,
    probe,
    schemaFile,
    validatorLogFile,
    attemptLabel: attempt.label,
  })

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-role-calibration-'))
  const startedAt = new Date().toISOString()
  let child: RunCommandResult
  try {
    logProgress(`temporary cwd=${workDir}`)
    child = await runCommand(wrapper.command, cliArgs, {
      cwd: workDir,
      input: readText(promptFile),
      timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer,
      validatorLogFile,
      env: {
        ...process.env,
        CLAUDE_CODE_SIMPLE: '1',
        MODEL_ROLE_CALIBRATION_MODEL: model,
        MODEL_ROLE_CALIBRATION_PROBE: probe,
        MODEL_ROLE_CALIBRATION_ATTEMPT: attempt.label,
      },
    })
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
    logProgress(`removed temporary cwd=${workDir}`)
  }

  const timedOut = child.error?.code === 'ETIMEDOUT'
  const metadata: AttemptMetadata = {
    run,
    case_id: caseId,
    model,
    probe,
    attempt: attempt.number,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timeout_ms: timeoutMs,
    timed_out: timedOut,
    exit_code: child.status,
    signal: child.signal,
    prompt_file: path.relative(ROOT, promptFile),
    schema_file: path.relative(ROOT, schemaFile),
    command: wrapper.command,
    command_args: cliArgs,
    persist_session: persistSession,
    session_name: sessionName,
    json_validator_enabled: jsonValidator,
    validator_log_file: validatorLogFile ? path.relative(ROOT, validatorLogFile) : null,
    stderr: child.stderr || '',
    error: child.error ? child.error.message : null,
    status: 'failed',
  }

  if (child.error || child.status !== 0) {
    if (child.stdout) {
      writeFileNew(attempt.rawTextFile, child.stdout)
      logProgress(`raw CLI output saved: ${attempt.rawTextFile}`)
    }
    writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
    logProgress(`metadata saved: ${attempt.metadataFile}`)
    const reason = timedOut ? `timed out after ${timeoutMs}ms` : `exited with status ${child.status}`
    throw new Error(`Model command ${reason} for ${model}/${probe}; retry will create a new attempt`)
  }

  let parsed: ParsedAssistantOutput
  try {
    parsed = parseAssistantOutput(child.stdout, probe)
  } catch (error: unknown) {
    metadata.error = errorMessage(error)
    writeFileNew(attempt.rawTextFile, child.stdout)
    writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n')
    logProgress(`raw CLI output saved: ${attempt.rawTextFile}`)
    logProgress(`metadata saved: ${attempt.metadataFile}`)
    throw new Error(
      `Invalid model output for ${model}/${probe}: ${errorMessage(error)}; retry will create a new attempt`,
    )
  }

  const { envelope, output } = parsed
  writeCompletedArtifacts(paths, attempt, metadata, envelope, output)

  console.log(`Attempt completed: ${attempt.label}`)
  console.log(`CLI output saved: ${paths.rawFile}`)
  console.log(`Ingestable output saved: ${paths.resultFile}`)
  console.log(`Metadata saved: ${paths.metadataFile}`)
}

if (isMainScript(__filename)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}

export { extractJsonObjects, parseJsonEnvelope, parseAssistantOutput, resolveWrapperCommand, buildCliArgs, runCommand }
