import { z } from 'zod'

export const AdoptedChangeSchema = z.object({
  issueId: z.string(),
  changeDescription: z.string(),
})

export const RejectedChangeSchema = z.object({
  issueId: z.string(),
  reason: z.string(),
})

export const RevisionLogSchema = z.object({
  runId: z.string(),
  round: z.number(),
  adopted: z.array(AdoptedChangeSchema),
  rejected: z.array(RejectedChangeSchema),
  pendingDecision: z.array(z.string()),
  createdAt: z.string(),
})
export type RevisionLog = z.infer<typeof RevisionLogSchema>
