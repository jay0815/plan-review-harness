import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteJson } from '../utils/fs.js'
import {
  PromptEvalCaseResultSchema,
  PromptEvalCaseSchema,
  PromptEvalObservedOutputSchema,
  PromptEvalResultSetSchema,
  type PromptEvalCase,
  type PromptEvalCaseResult,
  type PromptEvalObservedOutput,
  type PromptEvalResultSet,
} from './schemas.js'
import type { PromptEvalAdapter, PromptEvalRun } from './runner.js'

export interface PromptEvalFileAdapterOptions {
  observedDir: string
}

export interface PersistPromptEvalRunOptions {
  outputDir: string
  run: PromptEvalRun
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read JSON from ${filePath}: ${message}`)
  }
}

async function collectJsonFiles(inputPath: string): Promise<string[]> {
  const inputStat = await stat(inputPath)
  if (inputStat.isFile()) {
    return inputPath.endsWith('.json') ? [inputPath] : []
  }
  if (!inputStat.isDirectory()) {
    return []
  }

  const entries = await readdir(inputPath, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }
    const entryPath = path.join(inputPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectJsonFiles(entryPath)))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(entryPath)
    }
  }
  return files.sort()
}

function parseCasesFromJson(value: unknown): PromptEvalCase[] {
  const maybeCases = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && 'cases' in value
      ? (value as { cases: unknown }).cases
      : value

  if (Array.isArray(maybeCases)) {
    return maybeCases.map((item) => PromptEvalCaseSchema.parse(item))
  }
  return [PromptEvalCaseSchema.parse(maybeCases)]
}

function parseResultsFromJson(value: unknown): PromptEvalCaseResult[] {
  if (Array.isArray(value)) {
    return value.map((item) => PromptEvalCaseResultSchema.parse(item))
  }
  const resultSet = PromptEvalResultSetSchema.safeParse(value)
  if (resultSet.success) {
    return resultSet.data.results
  }
  return [PromptEvalCaseResultSchema.parse(value)]
}

export async function loadPromptEvalCases(inputPath: string): Promise<PromptEvalCase[]> {
  const files = await collectJsonFiles(inputPath)
  const cases: PromptEvalCase[] = []
  for (const file of files) {
    cases.push(...parseCasesFromJson(await readJsonFile(file)))
  }
  return cases
}

export async function loadPromptEvalCaseResults(inputPath: string): Promise<PromptEvalCaseResult[]> {
  return parseResultsFromJson(await readJsonFile(inputPath))
}

export async function loadPromptEvalObservedOutput(filePath: string): Promise<PromptEvalObservedOutput> {
  return PromptEvalObservedOutputSchema.parse(await readJsonFile(filePath))
}

export function createPromptEvalFileAdapter(options: PromptEvalFileAdapterOptions): PromptEvalAdapter {
  return {
    id: 'prompt-eval-file-adapter',
    async evaluate(testCase) {
      return loadPromptEvalObservedOutput(path.join(options.observedDir, `${testCase.id}.json`))
    },
  }
}

export function createPromptEvalResultSet(
  runId: string,
  results: PromptEvalCaseResult[],
  metadata: Record<string, unknown> = {},
): PromptEvalResultSet {
  return PromptEvalResultSetSchema.parse({
    version: 1,
    runId,
    results,
    metadata,
  })
}

export async function persistPromptEvalRun(options: PersistPromptEvalRunOptions): Promise<void> {
  await atomicWriteJson(path.join(options.outputDir, 'run-manifest.json'), options.run.manifest)
  await atomicWriteJson(
    path.join(options.outputDir, 'results.json'),
    createPromptEvalResultSet(options.run.manifest.runId, options.run.results, {
      adapterId: options.run.manifest.metadata.adapterId,
    }),
  )
  await atomicWriteJson(path.join(options.outputDir, 'report.json'), options.run.report)
}
