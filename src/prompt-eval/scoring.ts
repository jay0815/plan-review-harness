import {
  PromptEvalCaseResultSchema,
  PromptEvalCaseSchema,
  PromptEvalCheckSchema,
  PromptEvalObservedOutputSchema,
  PromptEvalReportSchema,
  type PromptEvalCase,
  type PromptEvalCaseResult,
  type PromptEvalCheck,
  type PromptEvalFindingExpectation,
  type PromptEvalNegativeExpectation,
  type PromptEvalObservedEvidence,
  type PromptEvalObservedFinding,
  type PromptEvalObservedOutput,
  type PromptEvalReport,
} from './schemas.js'

export interface CreatePromptEvalCaseResultInput {
  runId: string
  case: PromptEvalCase
  observed: PromptEvalObservedOutput
  checks?: PromptEvalCheck[]
  artifacts?: Record<string, string>
  createdAt?: string
  metadata?: Record<string, unknown>
}

export interface AggregatePromptEvalReportInput {
  runId: string
  results: PromptEvalCaseResult[]
  baselineResults?: PromptEvalCaseResult[]
  createdAt?: string
  metadata?: Record<string, unknown>
}

function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase()
}

function containsText(value: unknown, expected: string): boolean {
  return normalize(value).includes(normalize(expected))
}

function evidenceText(evidence: PromptEvalObservedEvidence): string {
  return [evidence.path, evidence.quote, evidence.text, JSON.stringify(evidence.metadata || {})]
    .filter(Boolean)
    .join('\n')
}

function findingSearchText(finding: PromptEvalObservedFinding): string {
  return [
    finding.id,
    finding.title,
    finding.text,
    finding.severity,
    JSON.stringify(finding.metadata || {}),
    ...finding.evidence.map(evidenceText),
  ]
    .filter(Boolean)
    .join('\n')
}

function matchesPositiveExpectation(
  finding: PromptEvalObservedFinding,
  expectation: PromptEvalFindingExpectation,
): boolean {
  if (expectation.outputId && finding.id !== expectation.outputId) {
    return false
  }
  if (expectation.title && !containsText(finding.title, expectation.title)) {
    return false
  }
  if (expectation.text && !containsText(findingSearchText(finding), expectation.text)) {
    return false
  }
  return true
}

function matchesNegativeExpectation(
  finding: PromptEvalObservedFinding,
  expectation: PromptEvalNegativeExpectation,
): boolean {
  if (expectation.outputId && finding.id !== expectation.outputId) {
    return false
  }
  if (expectation.title && !containsText(finding.title, expectation.title)) {
    return false
  }
  if (expectation.text && !containsText(findingSearchText(finding), expectation.text)) {
    return false
  }
  return true
}

function evidenceMatches(
  observed: PromptEvalObservedEvidence[],
  expected: PromptEvalFindingExpectation['evidence'],
): boolean {
  return expected.every((expectedItem) =>
    observed.some((observedItem) => {
      const text = evidenceText(observedItem)
      if (expectedItem.path && observedItem.path !== expectedItem.path) {
        return false
      }
      if (expectedItem.quote && !containsText(text, expectedItem.quote)) {
        return false
      }
      if (expectedItem.text && !containsText(text, expectedItem.text)) {
        return false
      }
      return true
    }),
  )
}

function check(
  value: Omit<PromptEvalCheck, 'category' | 'weight' | 'details'> & {
    category?: PromptEvalCheck['category']
    weight?: number
    details?: Record<string, unknown>
  },
): PromptEvalCheck {
  return PromptEvalCheckSchema.parse({
    category: 'deterministic',
    weight: 1,
    details: {},
    ...value,
  })
}

export function scoreChecks(checks: PromptEvalCheck[], category?: PromptEvalCheck['category']): number {
  const scored = checks.filter((item) => item.status !== 'skip' && (!category || item.category === category))
  const totalWeight = scored.reduce((sum, item) => sum + item.weight, 0)
  if (!totalWeight) {
    return 1
  }
  return Number((scored.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight).toFixed(4))
}

export function statusFromChecks(checks: PromptEvalCheck[]): PromptEvalCaseResult['status'] {
  if (!checks.length || checks.every((item) => item.status === 'skip')) {
    return 'skipped'
  }
  if (checks.some((item) => item.status === 'fail')) {
    return 'failed'
  }
  if (checks.some((item) => item.status === 'warn')) {
    return 'warning'
  }
  return 'passed'
}

function categoryScore(checks: PromptEvalCheck[], category: PromptEvalCheck['category']): number | undefined {
  if (!checks.some((item) => item.category === category)) {
    return undefined
  }
  return scoreChecks(checks, category)
}

export function scoreDeterministicExpectations(
  testCase: PromptEvalCase,
  observedOutput: PromptEvalObservedOutput,
): PromptEvalCheck[] {
  const parsedCase = PromptEvalCaseSchema.parse(testCase)
  const observed = PromptEvalObservedOutputSchema.parse(observedOutput)
  const checks: PromptEvalCheck[] = []

  if (parsedCase.expectations.allowedOutcomes.length) {
    const passed = Boolean(observed.outcome && parsedCase.expectations.allowedOutcomes.includes(observed.outcome))
    checks.push(
      check({
        id: 'outcome.allowed',
        status: passed ? 'pass' : 'fail',
        score: passed ? 1 : 0,
        message: passed
          ? `Outcome "${observed.outcome}" is allowed.`
          : `Outcome "${observed.outcome || 'missing'}" is not allowed.`,
        details: {
          allowedOutcomes: parsedCase.expectations.allowedOutcomes,
          observedOutcome: observed.outcome || null,
        },
      }),
    )
  }

  for (const expectation of parsedCase.expectations.mustFind) {
    const found = observed.findings.find((finding) => matchesPositiveExpectation(finding, expectation))
    if (!found) {
      checks.push(
        check({
          id: `must_find.${expectation.id}`,
          expectationId: expectation.id,
          status: 'fail',
          score: 0,
          message: `Expected finding was not present: ${expectation.title || expectation.text || expectation.outputId}`,
        }),
      )
      continue
    }
    const severityMatches = !expectation.severity || found.severity === expectation.severity
    const evidenceIsPresent = evidenceMatches(found.evidence, expectation.evidence)
    const passed = severityMatches && evidenceIsPresent
    checks.push(
      check({
        id: `must_find.${expectation.id}`,
        expectationId: expectation.id,
        status: passed ? 'pass' : 'fail',
        score: passed ? 1 : 0,
        message: passed
          ? `Expected finding was present: ${expectation.id}`
          : `Expected finding ${expectation.id} was present but did not satisfy severity or evidence requirements.`,
        details: {
          observedFindingId: found.id || null,
          expectedSeverity: expectation.severity || null,
          observedSeverity: found.severity || null,
          severityMatches,
          evidenceIsPresent,
        },
      }),
    )
  }

  for (const expectation of parsedCase.expectations.mustNotFind) {
    const found = observed.findings.find((finding) => matchesNegativeExpectation(finding, expectation))
    checks.push(
      check({
        id: `must_not_find.${expectation.id}`,
        expectationId: expectation.id,
        status: found ? 'fail' : 'pass',
        score: found ? 0 : 1,
        message: found
          ? `Forbidden finding was present: ${expectation.title || expectation.text || expectation.outputId}`
          : `Forbidden finding was absent: ${expectation.id}`,
        details: {
          observedFindingId: found?.id || null,
        },
      }),
    )
  }

  for (const expectation of parsedCase.expectations.requiredEvidence) {
    const found = observed.findings.some((finding) => evidenceMatches(finding.evidence, [expectation]))
    checks.push(
      check({
        id: `required_evidence.${expectation.id || expectation.path || expectation.quote || expectation.text}`,
        expectationId: expectation.id,
        status: found ? 'pass' : 'fail',
        score: found ? 1 : 0,
        message: found ? 'Required evidence was present.' : 'Required evidence was missing.',
        details: {
          expectation,
        },
      }),
    )
  }

  if (!checks.length) {
    checks.push(
      check({
        id: 'deterministic.no_expectations',
        status: 'skip',
        score: 1,
        message: 'No deterministic expectations were configured.',
        weight: 0,
      }),
    )
  }

  return checks
}

export function createPromptEvalCaseResult(input: CreatePromptEvalCaseResultInput): PromptEvalCaseResult {
  const parsedCase = PromptEvalCaseSchema.parse(input.case)
  const observed = PromptEvalObservedOutputSchema.parse(input.observed)
  const checks = [
    ...scoreDeterministicExpectations(parsedCase, observed),
    ...(input.checks || []).map((item) => PromptEvalCheckSchema.parse(item)),
  ]
  return PromptEvalCaseResultSchema.parse({
    version: 1,
    runId: input.runId,
    caseId: parsedCase.id,
    suite: parsedCase.suite,
    domain: parsedCase.domain,
    role: parsedCase.role,
    prompt: parsedCase.prompt,
    status: statusFromChecks(checks),
    scores: {
      contract: categoryScore(checks, 'contract'),
      deterministic: categoryScore(checks, 'deterministic'),
      judge: categoryScore(checks, 'judge'),
      human: categoryScore(checks, 'human'),
      total: scoreChecks(checks),
    },
    checks,
    observed,
    artifacts: input.artifacts || {},
    createdAt: input.createdAt || new Date().toISOString(),
    metadata: input.metadata || {},
  })
}

interface ReportBucket {
  cases: number
  passed: number
  failed: number
  warning: number
  skipped: number
  passRate: number
  averageScore: number
}

function emptyBucket(): ReportBucket {
  return {
    cases: 0,
    passed: 0,
    failed: 0,
    warning: 0,
    skipped: 0,
    passRate: 0,
    averageScore: 0,
  }
}

function finalizeBucket(bucket: ReportBucket, totalScore: number): ReportBucket {
  return {
    ...bucket,
    passRate: bucket.cases ? Number((bucket.passed / bucket.cases).toFixed(4)) : 0,
    averageScore: bucket.cases ? Number((totalScore / bucket.cases).toFixed(4)) : 0,
  }
}

function statusRank(status: PromptEvalCaseResult['status']): number {
  switch (status) {
    case 'failed':
      return 0
    case 'warning':
      return 1
    case 'skipped':
      return 2
    case 'passed':
      return 3
  }
}

function compareWithBaseline(
  results: PromptEvalCaseResult[],
  baselineResults: PromptEvalCaseResult[] = [],
): { regressions: string[]; improvements: string[] } {
  const baselineByCaseId = new Map(
    baselineResults.map((item) => {
      const parsed = PromptEvalCaseResultSchema.parse(item)
      return [parsed.caseId, parsed]
    }),
  )
  const regressions: string[] = []
  const improvements: string[] = []

  for (const result of results) {
    const baseline = baselineByCaseId.get(result.caseId)
    if (!baseline) {
      continue
    }
    if (baseline.status === 'skipped' || result.status === 'skipped') {
      continue
    }
    const previous = statusRank(baseline.status)
    const current = statusRank(result.status)
    if (current < previous) {
      regressions.push(result.caseId)
    } else if (current > previous) {
      improvements.push(result.caseId)
    }
  }

  return { regressions, improvements }
}

export function aggregatePromptEvalReport(input: AggregatePromptEvalReportInput): PromptEvalReport {
  const runId = input.runId
  const createdAt = input.createdAt || new Date().toISOString()
  const results = input.results.map((item) => PromptEvalCaseResultSchema.parse(item))
  const totals = emptyBucket()
  const bySuite: Record<string, ReportBucket> = {}
  const bySuiteScore: Record<string, number> = {}
  let totalScore = 0

  for (const result of results) {
    totals.cases += 1
    totals[result.status] += 1
    totalScore += result.scores.total
    bySuite[result.suite] ||= emptyBucket()
    bySuiteScore[result.suite] ||= 0
    bySuite[result.suite].cases += 1
    bySuite[result.suite][result.status] += 1
    bySuiteScore[result.suite] += result.scores.total
  }
  const { regressions, improvements } = compareWithBaseline(results, input.baselineResults)

  return PromptEvalReportSchema.parse({
    version: 1,
    runId,
    createdAt,
    totals: finalizeBucket(totals, totalScore),
    bySuite: Object.fromEntries(
      Object.entries(bySuite).map(([suite, bucket]) => [suite, finalizeBucket(bucket, bySuiteScore[suite] || 0)]),
    ),
    regressions,
    improvements,
    metadata: input.metadata || {},
  })
}
