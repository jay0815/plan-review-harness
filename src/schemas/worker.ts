import { z } from 'zod'
import { ReviewDimensionSchema } from './common.js'
import { IssueSchema } from './issue.js'
import { RevisionLogSchema } from './revision.js'
import { RegressionReportSchema } from './regression.js'

export const PlannerResultSchema = z.object({
  planMarkdown: z.string(),
})
export type PlannerResult = z.infer<typeof PlannerResultSchema>

export const ReviewResultSchema = z.object({
  reviewerId: z.string(),
  dimension: ReviewDimensionSchema,
  issues: z.array(IssueSchema),
})
export type ReviewResult = z.infer<typeof ReviewResultSchema>

export const RevisionResultSchema = z.object({
  planMarkdown: z.string(),
  revisionLog: RevisionLogSchema,
})
export type RevisionResult = z.infer<typeof RevisionResultSchema>

export const RegressionResultSchema = RegressionReportSchema
export type RegressionResult = z.infer<typeof RegressionResultSchema>
