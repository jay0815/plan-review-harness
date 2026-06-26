import { z } from 'zod'
import { SeveritySchema } from './common.js'

export const RegressionIssueStatusSchema = z.enum(['resolved', 'unresolved', 'new_issue', 'regressed'])

export const RegressionIssueSchema = z.object({
  issueId: z.string(),
  status: RegressionIssueStatusSchema,
  severity: SeveritySchema,
  summary: z.string(),
})

export const RegressionReportSchema = z.object({
  runId: z.string(),
  round: z.number(),
  checkedIssueIds: z.array(z.string()),
  results: z.array(RegressionIssueSchema),
  blockerCount: z.number(),
  highCount: z.number(),
  newIssueCount: z.number(),
  createdAt: z.string(),
})
export type RegressionReport = z.infer<typeof RegressionReportSchema>

export const ConvergenceReportSchema = z.object({
  runId: z.string(),
  round: z.number(),
  converged: z.boolean(),
  reason: z.string(),
  nextAction: z.enum(['done', 'continue', 'blocked']),
  blockerCount: z.number(),
  highCount: z.number(),
  roundLimitReached: z.boolean(),
  createdAt: z.string(),
})
export type ConvergenceReport = z.infer<typeof ConvergenceReportSchema>
