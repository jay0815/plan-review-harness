import { z } from 'zod'
import { DisagreementPositionSchema } from './ledger.js'

export const DecisionOptionSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  tradeoff: z.string().optional(),
})

export const DecisionItemSchema = z.object({
  id: z.string(),
  disagreementId: z.string(),
  title: z.string(),
  description: z.string(),
  options: z.array(DecisionOptionSchema),
  context: z.object({
    positions: z.array(DisagreementPositionSchema),
    relatedIssues: z.array(z.string()),
    impactSummary: z.string(),
  }),
  createdAt: z.string(),
})
export type DecisionItem = z.infer<typeof DecisionItemSchema>

export const DecisionSchema = z.object({
  decisionId: z.string(),
  itemId: z.string(),
  chosenKey: z.string(),
  customText: z.string().optional(),
  rationale: z.string().optional(),
  decidedAt: z.string(),
  decidedBy: z.string(),
})
export type Decision = z.infer<typeof DecisionSchema>

export const DecisionQueueSchema = z.object({
  runId: z.string(),
  round: z.number(),
  items: z.array(DecisionItemSchema),
  createdAt: z.string(),
})
export type DecisionQueue = z.infer<typeof DecisionQueueSchema>

export const UserDecisionsSchema = z.object({
  runId: z.string().optional(),
  round: z.number().optional(),
  decisions: z.array(DecisionSchema),
  createdAt: z.string().optional(),
})
export type UserDecisions = z.infer<typeof UserDecisionsSchema>
