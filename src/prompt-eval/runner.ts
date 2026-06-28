import {
  PromptEvalAdapterResultSchema,
  PromptEvalCaseResultSchema,
  PromptEvalCaseSchema,
  PromptEvalObservedOutputSchema,
  PromptEvalRunManifestSchema,
  type PromptEvalCase,
  type PromptEvalAdapterResult,
  type PromptEvalCaseResult,
  type PromptEvalObservedOutput,
  type PromptEvalReport,
  type PromptEvalRunManifest,
} from './schemas.js'
import {
  aggregatePromptEvalReport,
  createPromptEvalCaseResult,
  type AggregatePromptEvalReportInput,
} from './scoring.js'

export interface PromptEvalAdapter {
  id: string
  evaluate(
    testCase: PromptEvalCase,
  ): PromptEvalObservedOutput | PromptEvalAdapterResult | Promise<PromptEvalObservedOutput | PromptEvalAdapterResult>
}

export interface RunPromptEvalCaseInput {
  runId: string
  testCase: PromptEvalCase
  adapter: PromptEvalAdapter
  createdAt?: string
  artifacts?: Record<string, string>
  metadata?: Record<string, unknown>
}

export interface RunPromptEvalSuiteInput {
  runId: string
  cases: PromptEvalCase[]
  adapter: PromptEvalAdapter
  createdAt?: string
  project?: PromptEvalRunManifest['project']
  baselineRunId?: string
  baselineResults?: PromptEvalCaseResult[]
  metadata?: Record<string, unknown>
}

export interface PromptEvalRun {
  manifest: PromptEvalRunManifest
  results: PromptEvalCaseResult[]
  report: PromptEvalReport
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function ensureUniqueCaseIds(cases: PromptEvalCase[]): void {
  const seen = new Set<string>()
  for (const testCase of cases) {
    if (seen.has(testCase.id)) {
      throw new Error(`Duplicate prompt eval case id: ${testCase.id}`)
    }
    seen.add(testCase.id)
  }
}

function promptKey(prompt: NonNullable<PromptEvalCase['prompt']>): string {
  return [prompt.id, prompt.version, prompt.hash || '', prompt.source || ''].join('\0')
}

function collectPromptVersions(cases: PromptEvalCase[]): PromptEvalRunManifest['promptVersions'] {
  const prompts = new Map<string, NonNullable<PromptEvalCase['prompt']>>()
  for (const testCase of cases) {
    if (testCase.prompt) {
      prompts.set(promptKey(testCase.prompt), testCase.prompt)
    }
  }
  return [...prompts.values()]
}

function normalizeAdapterResult(value: PromptEvalObservedOutput | PromptEvalAdapterResult): PromptEvalAdapterResult {
  const adapterResult = PromptEvalAdapterResultSchema.safeParse(value)
  if (adapterResult.success) {
    return adapterResult.data
  }
  return PromptEvalAdapterResultSchema.parse({
    observed: PromptEvalObservedOutputSchema.parse(value),
  })
}

export async function runPromptEvalCase(input: RunPromptEvalCaseInput): Promise<PromptEvalCaseResult> {
  const testCase = PromptEvalCaseSchema.parse(input.testCase)
  const adapterResult = normalizeAdapterResult(await input.adapter.evaluate(testCase))
  return createPromptEvalCaseResult({
    runId: input.runId,
    case: testCase,
    observed: adapterResult.observed,
    checks: adapterResult.checks,
    artifacts: {
      ...adapterResult.artifacts,
      ...input.artifacts,
    },
    createdAt: input.createdAt,
    metadata: {
      adapterId: input.adapter.id,
      ...adapterResult.metadata,
      ...input.metadata,
    },
  })
}

export async function runPromptEvalSuite(input: RunPromptEvalSuiteInput): Promise<PromptEvalRun> {
  const createdAt = input.createdAt || new Date().toISOString()
  const cases = input.cases.map((testCase) => PromptEvalCaseSchema.parse(testCase))
  ensureUniqueCaseIds(cases)

  const manifest = PromptEvalRunManifestSchema.parse({
    version: 1,
    runId: input.runId,
    createdAt,
    project: input.project,
    suites: uniqueStrings(cases.map((testCase) => testCase.suite)),
    caseIds: cases.map((testCase) => testCase.id),
    promptVersions: collectPromptVersions(cases),
    baselineRunId: input.baselineRunId,
    metadata: {
      adapterId: input.adapter.id,
      ...input.metadata,
    },
  })

  const results: PromptEvalCaseResult[] = []
  for (const testCase of cases) {
    results.push(
      await runPromptEvalCase({
        runId: input.runId,
        testCase,
        adapter: input.adapter,
        createdAt,
      }),
    )
  }

  const reportInput: AggregatePromptEvalReportInput = {
    runId: input.runId,
    results: results.map((result) => PromptEvalCaseResultSchema.parse(result)),
    baselineResults: input.baselineResults,
    createdAt,
    metadata: input.metadata,
  }

  return {
    manifest,
    results,
    report: aggregatePromptEvalReport(reportInput),
  }
}
