import { z } from 'zod'
import { WorkflowStageSchema } from './common.js'
import { ArtifactRefSchema } from './artifact.js'
import { DecisionSchema } from './decision.js'
import { SeveritySchema } from './common.js'

export const PlanReviewStatusSchema = z.enum([
  'initialized',
  'running',
  'waiting_for_decision',
  'completed',
  'blocked',
  'failed',
])
export type PlanReviewStatus = z.infer<typeof PlanReviewStatusSchema>

export const ConfirmedIssueRefSchema = z.object({
  issueId: z.string(),
  severity: SeveritySchema,
  status: z.string(),
  ledgerPath: z.string(),
  round: z.number(),
})
export type ConfirmedIssueRef = z.infer<typeof ConfirmedIssueRefSchema>

export const PlanReviewStateSchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stage: WorkflowStageSchema,
  status: PlanReviewStatusSchema,
  round: z.number(),
  maxRounds: z.number(),
  artifacts: z.object({
    requirement: ArtifactRefSchema.optional(),
    currentPlan: ArtifactRefSchema.optional(),
    plans: z.array(ArtifactRefSchema).default([]),
    reviews: z.record(z.string(), ArtifactRefSchema).default({}),
    issueLedger: ArtifactRefSchema.optional(),
    disagreementLedger: ArtifactRefSchema.optional(),
    decisionQueue: ArtifactRefSchema.optional(),
    userDecisions: ArtifactRefSchema.optional(),
    revisionLog: ArtifactRefSchema.optional(),
    regressionReport: ArtifactRefSchema.optional(),
    convergenceReport: ArtifactRefSchema.optional(),
    finalReport: ArtifactRefSchema.optional(),
  }),
  decisions: z.array(DecisionSchema).default([]),
  confirmedIssues: z.array(ConfirmedIssueRefSchema).default([]),
  errors: z
    .array(
      z.object({
        stage: WorkflowStageSchema,
        message: z.string(),
        stack: z.string().optional(),
        createdAt: z.string(),
      }),
    )
    .default([]),
})
export type PlanReviewState = z.infer<typeof PlanReviewStateSchema>
