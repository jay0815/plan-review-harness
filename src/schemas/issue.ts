import { z } from 'zod'
import { IssueTypeSchema, ReviewDimensionSchema, SeveritySchema } from './common.js'

export const IssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  dimension: ReviewDimensionSchema,
  type: IssueTypeSchema,
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  planRef: z.string(),
  claim: z.string(),
  evidence: z.array(z.string()).min(1),
  impact: z.string(),
  suggestion: z.string(),
  worstCase: z.string().optional(),
  sourceWorkerId: z.string().optional(),
  createdAt: z.string(),
})
export type Issue = z.infer<typeof IssueSchema>

export const MergedIssueStatusSchema = z.enum([
  'consensus',
  'single_point',
  'disputed',
  'suppressed',
  'resolved',
  'rejected',
])

export const MergedIssueSchema = IssueSchema.extend({
  supportedBy: z.array(z.string()),
  status: MergedIssueStatusSchema,
  relatedIssueIds: z.array(z.string()).default([]),
})
export type MergedIssue = z.infer<typeof MergedIssueSchema>
