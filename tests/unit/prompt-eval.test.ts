import { describe, expect, it } from 'vitest'
import {
  PromptEvalExpectationsSchema,
  PromptEvalFindingExpectationSchema,
  PromptEvalObservedOutputSchema,
  PromptEvalCaseSchema,
  aggregatePromptEvalReport,
  createPromptEvalCaseResult,
  runPromptEvalSuite,
  type PromptEvalAdapter,
  type PromptEvalCase,
  type PromptEvalObservedOutput,
} from '../../src/prompt-eval/index.js'

const createdAt = '2026-01-01T00:00:00.000Z'

function createCase(overrides: Partial<PromptEvalCase> = {}): PromptEvalCase {
  return PromptEvalCaseSchema.parse({
    version: 1,
    id: 'plan-review.rollback',
    suite: 'golden',
    domain: 'plan-review',
    role: 'architecture-reviewer',
    title: 'Detect missing rollback plan',
    prompt: {
      id: 'architecture-reviewer',
      version: 'v1',
      hash: 'sha256:prompt',
      source: 'prompts/architecture.md',
    },
    input: {
      kind: 'inline',
      value: {
        plan: 'Deploy directly to production without rollback steps.',
      },
    },
    expectations: {
      allowedOutcomes: ['issues_found'],
      mustFind: [
        {
          id: 'rollback-missing',
          title: 'rollback',
          severity: 'high',
          evidence: [{ path: 'plan.md', quote: 'rollback' }],
        },
      ],
      mustNotFind: [{ id: 'no-kubernetes-claim', text: 'Kubernetes' }],
      requiredEvidence: [{ path: 'plan.md', quote: 'rollback' }],
    },
    ...overrides,
  })
}

function passingObserved(): PromptEvalObservedOutput {
  return PromptEvalObservedOutputSchema.parse({
    outcome: 'issues_found',
    findings: [
      {
        id: 'ISSUE-1',
        title: 'Rollback path is missing',
        text: 'The plan describes production deployment but does not define rollback steps.',
        severity: 'high',
        evidence: [{ path: 'plan.md', quote: 'without rollback steps' }],
      },
    ],
  })
}

function missingObserved(): PromptEvalObservedOutput {
  return PromptEvalObservedOutputSchema.parse({
    outcome: 'issues_found',
    findings: [],
  })
}

describe('prompt eval schemas', () => {
  it('parses a portable case and fills deterministic defaults', () => {
    const testCase = createCase()

    expect(testCase.scorers).toEqual([{ id: 'deterministic', weight: 1, options: {} }])
    expect(testCase.input.kind).toBe('inline')
  })

  it('rejects a finding expectation without a matcher', () => {
    const result = PromptEvalFindingExpectationSchema.safeParse({ id: 'empty' })

    expect(result.success).toBe(false)
  })

  it('rejects duplicate expectation ids across positive and negative expectations', () => {
    const result = PromptEvalExpectationsSchema.safeParse({
      mustFind: [{ id: 'duplicate', text: 'rollback' }],
      mustNotFind: [{ id: 'duplicate', text: 'Kubernetes' }],
    })

    expect(result.success).toBe(false)
  })
})

describe('prompt eval deterministic scoring', () => {
  it('passes when outcome, finding, severity, and evidence match', () => {
    const result = createPromptEvalCaseResult({
      runId: 'run-1',
      case: createCase(),
      observed: passingObserved(),
      createdAt,
    })

    expect(result.status).toBe('passed')
    expect(result.scores.total).toBe(1)
    expect(result.checks.every((check) => check.status === 'pass')).toBe(true)
  })

  it('fails when a required finding is missing', () => {
    const result = createPromptEvalCaseResult({
      runId: 'run-1',
      case: createCase(),
      observed: missingObserved(),
      createdAt,
    })

    expect(result.status).toBe('failed')
    expect(result.checks.some((check) => check.id === 'must_find.rollback-missing')).toBe(true)
  })

  it('fails when a forbidden finding is present', () => {
    const testCase = createCase({
      id: 'plan-review.no-hallucination',
      expectations: {
        allowedOutcomes: [],
        mustFind: [],
        mustNotFind: [{ id: 'no-kubernetes-claim', text: 'Kubernetes' }],
        requiredEvidence: [],
        notes: [],
      },
    })
    const result = createPromptEvalCaseResult({
      runId: 'run-1',
      case: testCase,
      observed: PromptEvalObservedOutputSchema.parse({
        findings: [{ id: 'ISSUE-1', title: 'Runtime risk', text: 'Kubernetes rollout is unsafe.' }],
      }),
      createdAt,
    })

    expect(result.status).toBe('failed')
    expect(result.checks[0]?.id).toBe('must_not_find.no-kubernetes-claim')
  })

  it('fails when required evidence is absent', () => {
    const testCase = createCase({
      id: 'plan-review.evidence',
      expectations: {
        allowedOutcomes: [],
        mustFind: [],
        mustNotFind: [],
        requiredEvidence: [{ id: 'source-quote', path: 'plan.md', quote: 'rollback' }],
        notes: [],
      },
    })
    const result = createPromptEvalCaseResult({
      runId: 'run-1',
      case: testCase,
      observed: PromptEvalObservedOutputSchema.parse({
        findings: [{ id: 'ISSUE-1', title: 'Rollback missing', evidence: [] }],
      }),
      createdAt,
    })

    expect(result.status).toBe('failed')
    expect(result.checks[0]?.id).toBe('required_evidence.source-quote')
  })
})

describe('prompt eval report aggregation', () => {
  it('summarizes totals and only marks regressions against a baseline', () => {
    const caseA = createCase({ id: 'case-a' })
    const caseB = createCase({ id: 'case-b' })
    const passedA = createPromptEvalCaseResult({
      runId: 'baseline',
      case: caseA,
      observed: passingObserved(),
      createdAt,
    })
    const failedA = createPromptEvalCaseResult({
      runId: 'current',
      case: caseA,
      observed: missingObserved(),
      createdAt,
    })
    const failedB = createPromptEvalCaseResult({
      runId: 'baseline',
      case: caseB,
      observed: missingObserved(),
      createdAt,
    })
    const passedB = createPromptEvalCaseResult({
      runId: 'current',
      case: caseB,
      observed: passingObserved(),
      createdAt,
    })

    const noBaseline = aggregatePromptEvalReport({
      runId: 'current',
      results: [failedA, passedB],
      createdAt,
    })
    const withBaseline = aggregatePromptEvalReport({
      runId: 'current',
      results: [failedA, passedB],
      baselineResults: [passedA, failedB],
      createdAt,
    })

    expect(noBaseline.regressions).toEqual([])
    expect(withBaseline.regressions).toEqual(['case-a'])
    expect(withBaseline.improvements).toEqual(['case-b'])
    expect(withBaseline.totals.passRate).toBe(0.5)
  })

  it('does not treat skipped cases as regressions or improvements', () => {
    const skippedCase = createCase({
      id: 'case-skipped',
      expectations: {
        allowedOutcomes: [],
        mustFind: [],
        mustNotFind: [],
        requiredEvidence: [],
        notes: [],
      },
    })
    const failedBaseline = createPromptEvalCaseResult({
      runId: 'baseline',
      case: createCase({ id: 'case-skipped' }),
      observed: missingObserved(),
      createdAt,
    })
    const skippedCurrent = createPromptEvalCaseResult({
      runId: 'current',
      case: skippedCase,
      observed: PromptEvalObservedOutputSchema.parse({}),
      createdAt,
    })

    const report = aggregatePromptEvalReport({
      runId: 'current',
      results: [skippedCurrent],
      baselineResults: [failedBaseline],
      createdAt,
    })

    expect(report.regressions).toEqual([])
    expect(report.improvements).toEqual([])
    expect(report.totals.skipped).toBe(1)
  })
})

describe('prompt eval runner', () => {
  it('runs cases through a project adapter and returns manifest, results, and report', async () => {
    const adapter: PromptEvalAdapter = {
      id: 'fake-adapter',
      evaluate: () => passingObserved(),
    }

    const run = await runPromptEvalSuite({
      runId: 'run-1',
      cases: [createCase()],
      adapter,
      createdAt,
      project: { name: 'plan-review-harness' },
      metadata: { dryRun: true },
    })

    expect(run.manifest.caseIds).toEqual(['plan-review.rollback'])
    expect(run.manifest.metadata.adapterId).toBe('fake-adapter')
    expect(run.results[0]?.status).toBe('passed')
    expect(run.results[0]?.metadata.adapterId).toBe('fake-adapter')
    expect(run.report.totals.passed).toBe(1)
  })

  it('includes project checks returned by the adapter', async () => {
    const adapter: PromptEvalAdapter = {
      id: 'fake-adapter',
      evaluate: () => ({
        observed: PromptEvalObservedOutputSchema.parse({ findings: [] }),
        checks: [
          {
            id: 'change-assurance.coverage',
            category: 'contract',
            status: 'fail',
            message: 'Required coverage area was missing.',
            score: 0,
            weight: 1,
            details: { missingAreas: ['src/payment.js'] },
          },
        ],
        artifacts: {},
        metadata: {},
      }),
    }

    const run = await runPromptEvalSuite({
      runId: 'run-1',
      cases: [
        createCase({
          id: 'change-assurance.coverage',
          expectations: {
            allowedOutcomes: [],
            mustFind: [],
            mustNotFind: [],
            requiredEvidence: [],
            notes: [],
          },
        }),
      ],
      adapter,
      createdAt,
    })

    expect(run.results[0]?.status).toBe('failed')
    expect(run.results[0]?.scores.contract).toBe(0)
    expect(run.results[0]?.checks.some((check) => check.id === 'change-assurance.coverage')).toBe(true)
    expect(run.report.totals.failed).toBe(1)
  })

  it('rejects duplicate case ids before executing the adapter', async () => {
    let calls = 0
    const adapter: PromptEvalAdapter = {
      id: 'fake-adapter',
      evaluate: () => {
        calls += 1
        return passingObserved()
      },
    }

    await expect(
      runPromptEvalSuite({
        runId: 'run-1',
        cases: [createCase(), createCase()],
        adapter,
        createdAt,
      }),
    ).rejects.toThrow('Duplicate prompt eval case id')
    expect(calls).toBe(0)
  })
})
