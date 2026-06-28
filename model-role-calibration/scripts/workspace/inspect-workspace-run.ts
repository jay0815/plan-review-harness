#!/usr/bin/env node

import * as fs from 'node:fs'
import * as path from 'node:path'

import { isMainScript, parseArgs, requireArg } from '../lib/lib.js'

type JsonEvent = Record<string, unknown> & {
  type?: string
  subtype?: string
  session_id?: string
  message?: {
    usage?: Usage
    content?: unknown
  }
}

type Usage = {
  input_tokens?: number
  prompt_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

type UsageSummary = {
  first_input_tokens: number | null
  max_input_tokens: number
  last_input_tokens: number | null
  last_output_tokens: number | null
  cache_read_input_tokens: number | null
  cache_creation_input_tokens: number | null
}

type ToolUse = {
  id: string | null
  name: string
  input: Record<string, unknown>
}

type ToolResult = {
  is_error: boolean
  content: unknown
}

type ReadAttempt = {
  id: string | null
  file: string
  result: ToolResult | null
}

type ProposedArtifact = {
  relative_path?: string
  line_count?: number
}

type ReadBoundary = Record<string, unknown> & {
  exposed_root?: string
  source_root?: string
  mode?: string
  file_count?: number
  proposed_artifacts?: ProposedArtifact[]
}

type RoleMetadata = {
  model?: string
  status?: string
  started_at?: string
  finished_at?: string
  read_boundary?: ReadBoundary
}

type RoleSummary = {
  role: string
  model: string | null
  session_id: string | null
  status: string | null
  elapsed_ms: number | null
  prompt_bytes: number
  output_bytes: number
  stdout_bytes: number
  event_count: number
  tools: string[]
  tool_counts: Record<string, number>
  read_files: string[]
  read_attempt_files: string[]
  failed_read_files: string[]
  mapped_read_files: string[]
  out_of_boundary_read_files: string[]
  failed_out_of_boundary_read_files: string[]
  read_boundary: ReadBoundary | null
  fact_check_summary: Record<string, unknown> | null
  usage: UsageSummary | null
}

type RunSummary = {
  run_id: string
  run_dir: string
  roles: RoleSummary[]
}

type OutputFormat = 'text' | 'json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

function parseJsonLines(file: string): JsonEvent[] {
  if (!fs.existsSync(file)) {
    return []
  }
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        const event = JSON.parse(line) as unknown
        return isRecord(event) ? event : { type: 'json_value', value: event }
      } catch (error) {
        return {
          type: 'parse_error',
          line: index + 1,
          error: errorMessage(error),
        }
      }
    })
}

function usageSummary(events: JsonEvent[]): UsageSummary | null {
  const usages = events.map((event) => event.message?.usage).filter((usage): usage is Usage => Boolean(usage))
  if (!usages.length) {
    return null
  }
  const last = usages[usages.length - 1]
  return {
    first_input_tokens: usages[0].input_tokens ?? usages[0].prompt_tokens ?? null,
    max_input_tokens: Math.max(...usages.map((item) => item.input_tokens ?? item.prompt_tokens ?? 0)),
    last_input_tokens: last.input_tokens ?? last.prompt_tokens ?? null,
    last_output_tokens: last.output_tokens ?? null,
    cache_read_input_tokens: last.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: last.cache_creation_input_tokens ?? null,
  }
}

function extractToolUses(events: JsonEvent[]): ToolUse[] {
  const calls: ToolUse[] = []
  for (const event of events) {
    const content = event.message?.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const block of content) {
      if (isRecord(block) && block.type === 'tool_use') {
        calls.push({
          id: typeof block.id === 'string' ? block.id : null,
          name: typeof block.name === 'string' ? block.name : '',
          input: isRecord(block.input) ? block.input : {},
        })
      }
    }
  }
  return calls
}

function extractToolResults(events: JsonEvent[]): Map<string, ToolResult> {
  const results = new Map<string, ToolResult>()
  for (const event of events) {
    const content = event.message?.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const block of content) {
      if (!isRecord(block) || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
        continue
      }
      results.set(block.tool_use_id, {
        is_error: Boolean(block.is_error),
        content: block.content || null,
      })
    }
  }
  return results
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function isOutOfBoundary(file: string, exposedRoot: string | null) {
  if (!exposedRoot) {
    return false
  }
  const relative = path.relative(exposedRoot, path.resolve(file))
  return relative.startsWith('..') || path.isAbsolute(relative)
}

function mapReadFile(file: string, exposedRoot: string | null, sourceRoot: string | null): string {
  if (!exposedRoot || !sourceRoot) {
    return file
  }
  if (isOutOfBoundary(file, exposedRoot)) {
    return file
  }
  const relative = path.relative(exposedRoot, path.resolve(file))
  return path.join(sourceRoot, relative)
}

function proposedArtifacts(readBoundary: ReadBoundary | null): ProposedArtifact[] {
  return Array.isArray(readBoundary?.proposed_artifacts) ? readBoundary.proposed_artifacts : []
}

function summarizeRole(roleDir: string): RoleSummary {
  const role = path.basename(roleDir)
  const metadataFile = path.join(roleDir, 'metadata.json')
  const stdoutFile = path.join(roleDir, 'stdout.jsonl')
  const outputFile = path.join(roleDir, 'output.json')
  const promptFile = path.join(roleDir, 'prompt.md')
  const metadata = fs.existsSync(metadataFile) ? readJson<RoleMetadata>(metadataFile) : {}
  const factCheckSummaryFile = path.join(roleDir, 'fact-check-summary.json')
  const factCheckSummary = fs.existsSync(factCheckSummaryFile)
    ? readJson<Record<string, unknown>>(factCheckSummaryFile)
    : null
  const events = parseJsonLines(stdoutFile)
  const init = events.find((event) => event.type === 'system' && event.subtype === 'init') || {}
  const toolUses = extractToolUses(events)
  const toolResults = extractToolResults(events)
  const toolCounts: Record<string, number> = {}
  for (const call of toolUses) {
    toolCounts[call.name] = (toolCounts[call.name] || 0) + 1
  }
  const readAttempts = toolUses
    .filter((call) => call.name === 'Read' && typeof call.input.file_path === 'string')
    .map(
      (call): ReadAttempt => ({
        id: call.id,
        file: String(call.input.file_path),
        result: call.id ? (toolResults.get(call.id) ?? null) : null,
      }),
    )
  const readAttemptFiles = unique(readAttempts.map((attempt) => attempt.file))
  const successfulReadFiles = unique(
    readAttempts.filter((attempt) => attempt.result?.is_error !== true).map((attempt) => attempt.file),
  )
  const failedReadFiles = unique(
    readAttempts.filter((attempt) => attempt.result?.is_error === true).map((attempt) => attempt.file),
  )
  const readBoundary = isRecord(metadata.read_boundary) ? metadata.read_boundary : null
  const exposedRoot = readBoundary?.exposed_root ? path.resolve(readBoundary.exposed_root) : null
  const sourceRoot = readBoundary?.source_root ? path.resolve(readBoundary.source_root) : null
  const outOfBoundaryReadFiles = successfulReadFiles.filter((file) => isOutOfBoundary(file, exposedRoot))
  const failedOutOfBoundaryReadFiles = failedReadFiles.filter((file) => isOutOfBoundary(file, exposedRoot))
  const mappedReadFiles = successfulReadFiles.map((file) => mapReadFile(file, exposedRoot, sourceRoot))
  const initModel = typeof init.model === 'string' ? init.model : null
  const sessionEvent = events.find((event) => typeof event.session_id === 'string')
  return {
    role,
    model: metadata.model || initModel,
    session_id: init.session_id || sessionEvent?.session_id || null,
    status: metadata.status || null,
    elapsed_ms:
      metadata.started_at && metadata.finished_at
        ? new Date(metadata.finished_at).getTime() - new Date(metadata.started_at).getTime()
        : null,
    prompt_bytes: fs.existsSync(promptFile) ? fs.statSync(promptFile).size : 0,
    output_bytes: fs.existsSync(outputFile) ? fs.statSync(outputFile).size : 0,
    stdout_bytes: fs.existsSync(stdoutFile) ? fs.statSync(stdoutFile).size : 0,
    event_count: events.length,
    tools: Array.isArray(init.tools) ? init.tools.filter(isString) : [],
    tool_counts: toolCounts,
    read_files: successfulReadFiles,
    read_attempt_files: readAttemptFiles,
    failed_read_files: failedReadFiles,
    mapped_read_files: unique(mappedReadFiles),
    out_of_boundary_read_files: outOfBoundaryReadFiles,
    failed_out_of_boundary_read_files: failedOutOfBoundaryReadFiles,
    read_boundary: readBoundary,
    fact_check_summary: factCheckSummary,
    usage: usageSummary(events),
  }
}

function printText(summary: RunSummary): void {
  console.log(`# Workspace Run Inspect: ${summary.run_id}`)
  console.log('')
  console.log(`Run dir: ${summary.run_dir}`)
  console.log(`Roles: ${summary.roles.map((item) => item.role).join(', ')}`)
  console.log('')
  console.log('| Role | Model | Elapsed | Prompt | Output | Stdout | Tool calls | Boundary | Max input tokens |')
  console.log('|---|---|---:|---:|---:|---:|---|---|---:|')
  for (const role of summary.roles) {
    const toolCalls =
      Object.entries(role.tool_counts)
        .map(([name, count]) => `${name}:${count}`)
        .join(', ') || '-'
    console.log(
      [
        `| ${role.role}`,
        role.model || '-',
        role.elapsed_ms == null ? '-' : `${Math.round(role.elapsed_ms / 1000)}s`,
        role.prompt_bytes,
        role.output_bytes,
        role.stdout_bytes,
        toolCalls,
        role.read_boundary
          ? [
              `${role.read_boundary.mode}:${role.read_boundary.file_count ?? '-'} files`,
              `proposed:${proposedArtifacts(role.read_boundary).length}`,
              `out:${role.out_of_boundary_read_files.length}`,
            ].join(', ')
          : '-',
        role.usage?.max_input_tokens ?? '-',
      ].join(' | ') + ' |',
    )
  }
  console.log('')
  for (const role of summary.roles) {
    console.log(`## ${role.role} (${role.model || 'unknown'})`)
    console.log(`session_id: ${role.session_id || '-'}`)
    console.log(`tools: ${role.tools.join(', ') || '-'}`)
    if (role.read_boundary) {
      console.log(`read_boundary: ${role.read_boundary.mode} (${role.read_boundary.file_count ?? '-'} file(s))`)
      const artifacts = proposedArtifacts(role.read_boundary)
      if (artifacts.length) {
        console.log('proposed_artifacts:')
        for (const artifact of artifacts) {
          console.log(`- ${artifact.relative_path}:1-${artifact.line_count || '?'}`)
        }
      }
      if (role.out_of_boundary_read_files.length) {
        console.log('out_of_boundary_read_files:')
        for (const file of role.out_of_boundary_read_files) {
          console.log(`- ${file}`)
        }
      }
      if ((role.failed_out_of_boundary_read_files || []).length) {
        console.log('failed_out_of_boundary_read_files:')
        for (const file of role.failed_out_of_boundary_read_files) {
          console.log(`- ${file}`)
        }
      }
    }
    if (role.fact_check_summary) {
      console.log(`fact_check_strictness: ${role.fact_check_summary.strictness_signal}`)
      console.log(`fact_check_status_counts: ${JSON.stringify(role.fact_check_summary.status_counts)}`)
      console.log(
        `fact_check_evidence_status_counts: ${JSON.stringify(role.fact_check_summary.evidence_status_counts)}`,
      )
    }
    if (!role.read_files.length) {
      console.log('read_files: none')
    } else {
      console.log('read_files:')
      for (const file of role.read_files) {
        console.log(`- ${file}`)
      }
    }
    console.log('')
  }
}

function outputFormat(args: Record<string, unknown>): OutputFormat {
  const format = args.format
  if (args.json === true) {
    if (format && format !== true && format !== 'json') {
      throw new Error('Use either --json or --format json, not both with different formats')
    }
    return 'json'
  }
  if (!format) {
    return 'text'
  }
  if (format === true) {
    throw new Error('Missing value for --format. Expected text or json.')
  }
  if (format !== 'text' && format !== 'json') {
    throw new Error(`Invalid --format "${String(format)}". Expected text or json.`)
  }
  return format
}

export function inspect(runDir: string): RunSummary {
  const absoluteRunDir = path.resolve(runDir)
  const rolesDir = path.join(absoluteRunDir, 'roles')
  if (!fs.existsSync(rolesDir)) {
    throw new Error(`Missing roles directory: ${rolesDir}`)
  }
  const roles = fs
    .readdirSync(rolesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => summarizeRole(path.join(rolesDir, entry.name)))
    .sort((a, b) => a.role.localeCompare(b.role))
  return {
    run_id: path.basename(absoluteRunDir),
    run_dir: absoluteRunDir,
    roles,
  }
}

function main() {
  const args = parseArgs(process.argv)
  const summary = inspect(requireArg(args, 'run-dir'))
  if (outputFormat(args) === 'json') {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    printText(summary)
  }
}

if (isMainScript(__filename)) {
  try {
    main()
  } catch (error) {
    console.error(errorMessage(error))
    process.exitCode = 1
  }
}
