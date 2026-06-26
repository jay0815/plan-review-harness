import { z } from 'zod'
import { MergedIssueSchema } from './issue.js'

export const IssueLedgerSchema = z.object({
  runId: z.string(),
  round: z.number(),
  issues: z.array(MergedIssueSchema),
  createdAt: z.string(),
})
export type IssueLedger = z.infer<typeof IssueLedgerSchema>

export const DisagreementLevelSchema = z.enum(['L1', 'L2', 'L3'])
export type DisagreementLevel = z.infer<typeof DisagreementLevelSchema>

export const DisagreementPositionSchema = z.object({
  workerId: z.string(),
  claim: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})
export type DisagreementPosition = z.infer<typeof DisagreementPositionSchema>

export const DisagreementSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  title: z.string(),
  level: DisagreementLevelSchema,
  positions: z.array(DisagreementPositionSchema),
  autoResolution: z.string().optional(),
  humanDecisionRequired: z.boolean(),
  createdAt: z.string(),
})
export type Disagreement = z.infer<typeof DisagreementSchema>

export const DisagreementLedgerSchema = z.object({
  runId: z.string(),
  round: z.number(),
  disagreements: z.array(DisagreementSchema),
  createdAt: z.string(),
})
export type DisagreementLedger = z.infer<typeof DisagreementLedgerSchema>
