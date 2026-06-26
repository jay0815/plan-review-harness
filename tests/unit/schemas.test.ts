import { describe, expect, it } from 'vitest'
import {
  DecisionQueueSchema,
  DisagreementLedgerSchema,
  IssueLedgerSchema,
  IssueSchema,
  PlanReviewStateSchema,
  PlannerResultSchema,
  RegressionReportSchema,
  RevisionLogSchema,
  ReviewResultSchema,
} from '../../src/schemas/index.js'
import type { ZodSchema } from 'zod'

const createdAt = '2026-01-01T00:00:00.000Z'

const issue = {
  id: 'ISSUE-1',
  title: 'Rollback path is missing',
  dimension: 'architecture',
  type: 'risk',
  severity: 'high',
  confidence: 0.86,
  planRef: 'section:deployment',
  claim: 'The plan does not define rollback triggers.',
  evidence: ['Deployment section only describes forward rollout.'],
  impact: 'Failed releases may take longer to recover.',
  suggestion: 'Add rollback trigger, owner, and rollback steps.',
  sourceWorkerId: 'architecture-reviewer',
  createdAt,
} as const

const mergedIssue = {
  ...issue,
  id: 'MERGED-ISSUE-1',
  supportedBy: ['architecture-reviewer'],
  status: 'single_point',
  relatedIssueIds: ['ISSUE-1'],
} as const

const position = {
  workerId: 'architecture-reviewer',
  claim: 'Rollback is required before rollout.',
  confidence: 0.86,
  reasoning: 'The release plan needs an explicit recovery path.',
} as const

function expectInvalid(schema: ZodSchema, value: unknown): void {
  expect(() => schema.parse(value)).toThrow()
}

describe('core schemas', () => {
  it('validates IssueSchema and requires planRef/evidence', () => {
    expect(IssueSchema.parse(issue)).toMatchObject({
      id: 'ISSUE-1',
      planRef: 'section:deployment',
    })

    expect(() => IssueSchema.parse({ ...issue, planRef: undefined })).toThrow()
    expect(() => IssueSchema.parse({ ...issue, evidence: [] })).toThrow()
  })

  it('rejects IssueSchema confidence outside the closed 0..1 range', () => {
    expect(() => IssueSchema.parse({ ...issue, confidence: -0.01 })).toThrow()
    expect(() => IssueSchema.parse({ ...issue, confidence: 1.01 })).toThrow()
  })

  it('validates IssueLedgerSchema with merged issue metadata', () => {
    const parsed = IssueLedgerSchema.parse({
      runId: 'run-1',
      round: 1,
      issues: [mergedIssue],
      createdAt,
    })

    expect(parsed.issues[0]?.supportedBy).toEqual(['architecture-reviewer'])
    expect(parsed.issues[0]?.status).toBe('single_point')
  })

  it('rejects IssueLedgerSchema entries that are plain issues, not merged issues', () => {
    expect(() =>
      IssueLedgerSchema.parse({
        runId: 'run-1',
        round: 1,
        issues: [issue],
        createdAt,
      }),
    ).toThrow()
  })

  it('validates DisagreementLedgerSchema positions and L3 gate flag', () => {
    const parsed = DisagreementLedgerSchema.parse({
      runId: 'run-1',
      round: 1,
      disagreements: [
        {
          id: 'DISAGREE-1',
          issueId: 'MERGED-ISSUE-1',
          title: 'Rollback severity disagreement',
          level: 'L3',
          positions: [position],
          humanDecisionRequired: true,
          createdAt,
        },
      ],
      createdAt,
    })

    expect(parsed.disagreements[0]?.humanDecisionRequired).toBe(true)
  })

  it('rejects DisagreementLedgerSchema invalid disagreement levels', () => {
    expect(() =>
      DisagreementLedgerSchema.parse({
        runId: 'run-1',
        round: 1,
        disagreements: [
          {
            id: 'DISAGREE-1',
            issueId: 'MERGED-ISSUE-1',
            title: 'Rollback severity disagreement',
            level: 'L4',
            positions: [position],
            humanDecisionRequired: true,
            createdAt,
          },
        ],
        createdAt,
      }),
    ).toThrow()
  })

  it('validates DecisionQueueSchema with options and decision context', () => {
    const parsed = DecisionQueueSchema.parse({
      runId: 'run-1',
      round: 1,
      items: [
        {
          id: 'DECISION-1',
          disagreementId: 'DISAGREE-1',
          title: 'Choose rollback requirement',
          description: 'Decide whether rollback must block rollout.',
          options: [
            {
              key: 'adopt',
              label: 'Adopt',
              description: 'Require rollback before rollout.',
              tradeoff: 'More upfront work.',
            },
          ],
          context: {
            positions: [position],
            relatedIssues: ['MERGED-ISSUE-1'],
            impactSummary: 'Release recovery depends on this decision.',
          },
          createdAt,
        },
      ],
      createdAt,
    })

    expect(parsed.items[0]?.options[0]?.key).toBe('adopt')
  })

  it('rejects DecisionQueueSchema items without context', () => {
    expect(() =>
      DecisionQueueSchema.parse({
        runId: 'run-1',
        round: 1,
        items: [
          {
            id: 'DECISION-1',
            disagreementId: 'DISAGREE-1',
            title: 'Choose rollback requirement',
            description: 'Decide whether rollback must block rollout.',
            options: [],
            createdAt,
          },
        ],
        createdAt,
      }),
    ).toThrow()
  })

  it('validates RevisionLogSchema adopted/rejected/pending decisions', () => {
    const parsed = RevisionLogSchema.parse({
      runId: 'run-1',
      round: 1,
      adopted: [{ issueId: 'MERGED-ISSUE-1', changeDescription: 'Added rollback trigger.' }],
      rejected: [{ issueId: 'MERGED-ISSUE-2', reason: 'Out of scope for this plan.' }],
      pendingDecision: ['DECISION-1'],
      createdAt,
    })

    expect(parsed.pendingDecision).toEqual(['DECISION-1'])
  })

  it('rejects RevisionLogSchema adopted entries without issueId', () => {
    expect(() =>
      RevisionLogSchema.parse({
        runId: 'run-1',
        round: 1,
        adopted: [{ changeDescription: 'Added rollback trigger.' }],
        rejected: [],
        pendingDecision: [],
        createdAt,
      }),
    ).toThrow()
  })

  it('validates RegressionReportSchema results and severity counts', () => {
    const parsed = RegressionReportSchema.parse({
      runId: 'run-1',
      round: 1,
      checkedIssueIds: ['MERGED-ISSUE-1'],
      results: [
        {
          issueId: 'MERGED-ISSUE-1',
          status: 'resolved',
          severity: 'high',
          summary: 'Rollback path is now present.',
        },
      ],
      blockerCount: 0,
      highCount: 0,
      newIssueCount: 0,
      createdAt,
    })

    expect(parsed.results[0]?.status).toBe('resolved')
  })

  it('rejects RegressionReportSchema invalid regression statuses', () => {
    expect(() =>
      RegressionReportSchema.parse({
        runId: 'run-1',
        round: 1,
        checkedIssueIds: ['MERGED-ISSUE-1'],
        results: [
          {
            issueId: 'MERGED-ISSUE-1',
            status: 'fixed',
            severity: 'high',
            summary: 'Rollback path is now present.',
          },
        ],
        blockerCount: 0,
        highCount: 0,
        newIssueCount: 0,
        createdAt,
      }),
    ).toThrow()
  })

  it('validates PlanReviewStateSchema and applies artifact defaults', () => {
    const parsed = PlanReviewStateSchema.parse({
      runId: 'run-1',
      createdAt,
      updatedAt: createdAt,
      stage: 'blind_review',
      status: 'running',
      round: 1,
      maxRounds: 2,
      artifacts: {
        requirement: {
          id: 'requirement',
          type: 'requirement',
          runId: 'run-1',
          round: 0,
          path: 'runs/run-1/input/requirement.md',
          producedBy: 'loadInput',
        },
      },
    })

    expect(parsed.artifacts.plans).toEqual([])
    expect(parsed.artifacts.reviews).toEqual({})
    expect(parsed.decisions).toEqual([])
    expect(parsed.confirmedIssues).toEqual([])
  })

  it('rejects PlanReviewStateSchema invalid stage names', () => {
    expect(() =>
      PlanReviewStateSchema.parse({
        runId: 'run-1',
        createdAt,
        updatedAt: createdAt,
        stage: 'reviewing',
        status: 'running',
        round: 1,
        maxRounds: 2,
        artifacts: {},
      }),
    ).toThrow()
  })

  it('rejects malformed IssueSchema variants', () => {
    expectInvalid(IssueSchema, { ...issue, title: undefined })
    expectInvalid(IssueSchema, { ...issue, confidence: '0.8' })
    expectInvalid(IssueSchema, { ...issue, severity: 'critical' })
    expectInvalid(IssueSchema, { ...issue, type: 'bug' })
    expectInvalid(IssueSchema, { ...issue, dimension: 'security' })
    expectInvalid(IssueSchema, { ...issue, confidence: -0.1 })
    expectInvalid(IssueSchema, { ...issue, confidence: 1.1 })
    expectInvalid(IssueSchema, { ...issue, evidence: [] })
  })

  it('rejects malformed IssueLedgerSchema variants', () => {
    const ledger = { runId: 'run-1', round: 1, issues: [mergedIssue], createdAt }

    expectInvalid(IssueLedgerSchema, { ...ledger, runId: undefined })
    expectInvalid(IssueLedgerSchema, { ...ledger, round: '1' })
    expectInvalid(IssueLedgerSchema, { ...ledger, issues: 'not-an-array' })
    expectInvalid(IssueLedgerSchema, { ...ledger, issues: [{ ...mergedIssue, status: 'accepted' }] })
    expectInvalid(IssueLedgerSchema, { ...ledger, issues: [{ ...mergedIssue, confidence: 2 }] })
  })

  it('rejects malformed DisagreementLedgerSchema variants', () => {
    const disagreement = {
      id: 'DISAGREE-1',
      issueId: 'MERGED-ISSUE-1',
      title: 'Rollback severity disagreement',
      level: 'L3',
      positions: [position],
      humanDecisionRequired: true,
      createdAt,
    }
    const ledger = { runId: 'run-1', round: 1, disagreements: [disagreement], createdAt }

    expectInvalid(DisagreementLedgerSchema, { ...ledger, runId: undefined })
    expectInvalid(DisagreementLedgerSchema, { ...ledger, round: '1' })
    expectInvalid(DisagreementLedgerSchema, { ...ledger, disagreements: [{ ...disagreement, level: 'L4' }] })
    expectInvalid(DisagreementLedgerSchema, {
      ...ledger,
      disagreements: [{ ...disagreement, humanDecisionRequired: 'true' }],
    })
    expectInvalid(DisagreementLedgerSchema, {
      ...ledger,
      disagreements: [{ ...disagreement, positions: [{ ...position, confidence: 1.5 }] }],
    })
  })

  it('rejects malformed DecisionQueueSchema variants', () => {
    const item = {
      id: 'DECISION-1',
      disagreementId: 'DISAGREE-1',
      title: 'Choose rollback requirement',
      description: 'Decide whether rollback must block rollout.',
      options: [{ key: 'adopt', label: 'Adopt', description: 'Require rollback before rollout.' }],
      context: {
        positions: [position],
        relatedIssues: ['MERGED-ISSUE-1'],
        impactSummary: 'Release recovery depends on this decision.',
      },
      createdAt,
    }
    const queue = { runId: 'run-1', round: 1, items: [item], createdAt }

    expectInvalid(DecisionQueueSchema, { ...queue, runId: undefined })
    expectInvalid(DecisionQueueSchema, { ...queue, round: '1' })
    expectInvalid(DecisionQueueSchema, { ...queue, items: [{ ...item, disagreementId: undefined }] })
    expectInvalid(DecisionQueueSchema, { ...queue, items: [{ ...item, options: [{ ...item.options[0], key: 7 }] }] })
    expectInvalid(DecisionQueueSchema, {
      ...queue,
      items: [{ ...item, context: { ...item.context, positions: [{ ...position, confidence: -0.01 }] } }],
    })
  })

  it('rejects malformed RevisionLogSchema variants', () => {
    const log = {
      runId: 'run-1',
      round: 1,
      adopted: [{ issueId: 'MERGED-ISSUE-1', changeDescription: 'Added rollback trigger.' }],
      rejected: [{ issueId: 'MERGED-ISSUE-2', reason: 'Out of scope for this plan.' }],
      pendingDecision: ['DECISION-1'],
      createdAt,
    }

    expectInvalid(RevisionLogSchema, { ...log, runId: undefined })
    expectInvalid(RevisionLogSchema, { ...log, round: '1' })
    expectInvalid(RevisionLogSchema, { ...log, adopted: [{ changeDescription: 'Missing issue id.' }] })
    expectInvalid(RevisionLogSchema, { ...log, rejected: [{ issueId: 'MERGED-ISSUE-2' }] })
    expectInvalid(RevisionLogSchema, { ...log, pendingDecision: [123] })
  })

  it('rejects malformed RegressionReportSchema variants', () => {
    const result = {
      issueId: 'MERGED-ISSUE-1',
      status: 'resolved',
      severity: 'high',
      summary: 'Rollback path is now present.',
    }
    const report = {
      runId: 'run-1',
      round: 1,
      checkedIssueIds: ['MERGED-ISSUE-1'],
      results: [result],
      blockerCount: 0,
      highCount: 0,
      newIssueCount: 0,
      createdAt,
    }

    expectInvalid(RegressionReportSchema, { ...report, runId: undefined })
    expectInvalid(RegressionReportSchema, { ...report, blockerCount: '0' })
    expectInvalid(RegressionReportSchema, { ...report, results: [{ ...result, status: 'fixed' }] })
    expectInvalid(RegressionReportSchema, { ...report, results: [{ ...result, severity: 'critical' }] })
    expectInvalid(RegressionReportSchema, { ...report, checkedIssueIds: [123] })
  })

  it('rejects malformed PlanReviewStateSchema variants', () => {
    const state = {
      runId: 'run-1',
      createdAt,
      updatedAt: createdAt,
      stage: 'blind_review',
      status: 'running',
      round: 1,
      maxRounds: 2,
      artifacts: { plans: [], reviews: {} },
      decisions: [],
      confirmedIssues: [],
      errors: [],
    }

    expectInvalid(PlanReviewStateSchema, { ...state, runId: undefined })
    expectInvalid(PlanReviewStateSchema, { ...state, round: '1' })
    expectInvalid(PlanReviewStateSchema, { ...state, stage: 'reviewing' })
    expectInvalid(PlanReviewStateSchema, { ...state, status: 'paused' })
    expectInvalid(PlanReviewStateSchema, { ...state, artifacts: { reviews: [] } })
  })

  it('rejects malformed worker result schemas', () => {
    const review = {
      reviewerId: 'architecture-reviewer',
      dimension: 'architecture',
      issues: [issue],
    }

    expectInvalid(PlannerResultSchema, {})
    expectInvalid(PlannerResultSchema, { planMarkdown: 7 })
    expectInvalid(ReviewResultSchema, { ...review, reviewerId: undefined })
    expectInvalid(ReviewResultSchema, { ...review, issues: 'not-an-array' })
    expectInvalid(ReviewResultSchema, { ...review, dimension: 'security' })
    expectInvalid(ReviewResultSchema, { ...review, issues: [{ ...issue, confidence: 1.2 }] })
    expectInvalid(ReviewResultSchema, { ...review, issues: [{ ...issue, severity: 'critical' }] })
  })
})
