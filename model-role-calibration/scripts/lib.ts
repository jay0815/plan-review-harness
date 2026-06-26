#!/usr/bin/env node

import * as fs from 'node:fs'
import * as path from 'node:path'

export type ArgValue = string | true | undefined
export type ParsedArgs = Record<string, ArgValue>

export interface AgentOutputPaths {
  outputDir: string
  baseName: string
  resultFile: string
  rawFile: string
  metadataFile: string
  attemptsDir: string
}

export const ROOT = path.resolve(__dirname, '..')
const CONFIG_FILE = path.join(ROOT, 'calibration.config.json')
export const PROBES = ['planner', 'risk', 'architecture', 'execution', 'rebuttal', 'synthesis']
const REVIEW_PROBES = new Set(['risk', 'architecture', 'execution', 'rebuttal'])

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i] as string
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`)
    }
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i += 1
    }
  }
  return args
}

export function requireArg(args: ParsedArgs, name: string): string {
  if (!args[name] || args[name] === true) {
    throw new Error(`Missing required argument: --${name}`)
  }
  return String(args[name])
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

export function readText(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

export function writeFileNew(file: string, content: string): void {
  if (fs.existsSync(file)) {
    throw new Error(`Refusing to overwrite existing file: ${file}`)
  }
  ensureDir(path.dirname(file))
  const tempFile = temporarySibling(file)
  fs.writeFileSync(tempFile, content, { flag: 'wx' })
  try {
    fs.linkSync(tempFile, file)
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      throw new Error(`Refusing to overwrite existing file: ${file}`)
    }
    throw error
  } finally {
    fs.unlinkSync(tempFile)
  }
}

export function writeGenerated(file: string, content: string): void {
  ensureDir(path.dirname(file))
  const tempFile = temporarySibling(file)
  fs.writeFileSync(tempFile, content, { flag: 'wx' })
  try {
    fs.renameSync(tempFile, file)
  } catch (error) {
    fs.unlinkSync(tempFile)
    throw error
  }
}

export function assertSafeCaseId(caseId: string): void {
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(caseId)) {
    throw new Error(`Invalid case id "${caseId}". Expected group/case-id.`)
  }
}

export function assertProbe(probe: string): void {
  if (!PROBES.includes(probe)) {
    throw new Error(`Invalid probe "${probe}". Expected one of: ${PROBES.join(', ')}`)
  }
}

export function slug(value: string): string {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function optionalSlugArg(args: ParsedArgs, name: string): string | null {
  const value = args[name]
  if (!value || value === true) {
    return null
  }
  const normalized = slug(value).toLowerCase()
  if (!normalized) {
    throw new Error(`Invalid --${name}: must contain at least one alphanumeric, underscore, or hyphen`)
  }
  return normalized
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export function isMainScript(filename: string, argv: string[] = process.argv): boolean {
  const script = argv[1]
  if (typeof script !== 'string') {
    return false
  }
  const resolvedScript = path.resolve(script)
  if (resolvedScript === filename) {
    return true
  }
  try {
    return fs.realpathSync.native(resolvedScript) === fs.realpathSync.native(filename)
  } catch {
    return false
  }
}

function loadLegacyCaseInput(caseDir: string): string {
  const inputFile = path.join(caseDir, 'input.md')
  const contextFile = path.join(caseDir, 'context.md')
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Missing case input: ${inputFile}`)
  }
  const input = readText(inputFile).trim()
  const context = fs.existsSync(contextFile) ? readText(contextFile).trim() : ''
  return context ? `${context}\n\n---\n\n${input}\n` : `${input}\n`
}

export function loadCaseInput(caseId: string, probe: string): string {
  assertSafeCaseId(caseId)
  assertProbe(probe)
  const caseDir = path.join(ROOT, 'cases', caseId)
  const inputsDir = path.join(caseDir, 'inputs')
  let inputName: string | undefined
  if (probe === 'planner') {
    inputName = 'planner.md'
  } else if (probe === 'synthesis') {
    inputName = 'synthesis.md'
  } else if (REVIEW_PROBES.has(probe)) {
    inputName = 'review.md'
  }

  const probeInput = inputName ? path.join(inputsDir, inputName) : null
  if (probeInput && fs.existsSync(probeInput)) {
    return `${readText(probeInput).trim()}\n`
  }
  if (fs.existsSync(inputsDir)) {
    throw new Error(`Missing ${probe} input: ${probeInput}`)
  }

  return loadLegacyCaseInput(caseDir)
}

export function parseJsonFile<T = unknown>(file: string): T {
  return JSON.parse(readText(file)) as T
}

export function loadConfig<T = unknown>(): T {
  return parseJsonFile<T>(CONFIG_FILE)
}

export function schemaForProbe(probe: string): string {
  assertProbe(probe)
  if (probe === 'planner') {
    return path.join(ROOT, 'schemas', 'planner-output.schema.json')
  }
  if (probe === 'risk') {
    return path.join(ROOT, 'schemas', 'risk-output.schema.json')
  }
  if (probe === 'architecture') {
    return path.join(ROOT, 'schemas', 'architecture-output.schema.json')
  }
  if (probe === 'execution') {
    return path.join(ROOT, 'schemas', 'execution-output.schema.json')
  }
  if (probe === 'rebuttal') {
    return path.join(ROOT, 'schemas', 'rebuttal-output.schema.json')
  }
  if (probe === 'synthesis') {
    return path.join(ROOT, 'schemas', 'synthesis-output.schema.json')
  }
  return path.join(ROOT, 'schemas', 'model-output.schema.json')
}

export function agentOutputPaths(run: string, caseId: string, model: string, probe: string): AgentOutputPaths {
  assertSafeCaseId(caseId)
  assertProbe(probe)
  const baseName = `${slug(model)}-${probe}`
  const outputDir = path.join(ROOT, 'runs', run, caseId, 'agent-outputs')
  return {
    outputDir,
    baseName,
    resultFile: path.join(outputDir, `${baseName}.json`),
    rawFile: path.join(outputDir, `${baseName}.cli.json`),
    metadataFile: path.join(outputDir, `${baseName}.meta.json`),
    attemptsDir: path.join(outputDir, 'attempts', baseName),
  }
}

export function sumScore(score: Record<string, unknown>): number {
  const values = [
    score.hit_rate,
    score.contract_closure,
    score.actionability,
    score.evidence_discipline,
    score.false_positive_cost,
  ]
  return values.reduce<number>((total, value) => total + Number(value || 0), 0)
}

export function walk(dir: string, predicate?: (file: string) => boolean, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return results
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, predicate, results)
    } else if (!predicate || predicate(full)) {
      results.push(full)
    }
  }
  return results
}

function temporarySibling(file: string): string {
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`,
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
