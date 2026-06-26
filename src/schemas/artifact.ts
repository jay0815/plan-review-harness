import { z } from 'zod'
import { WorkflowStageSchema } from './common.js'

export const ArtifactTypeSchema = z.enum([
  'requirement',
  'plan',
  'review',
  'issue_ledger',
  'disagreement_ledger',
  'decision_queue',
  'user_decisions',
  'revision_log',
  'regression_report',
  'convergence_report',
  'final_report',
  'worker_result',
])
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>

export const ArtifactRefSchema = z.object({
  id: z.string(),
  type: ArtifactTypeSchema,
  runId: z.string(),
  round: z.number(),
  path: z.string(),
  producedBy: z.string(),
  contentHash: z.string().optional(),
})
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>

export const ArtifactSchema = z.object({
  id: z.string(),
  runId: z.string(),
  round: z.number(),
  stage: WorkflowStageSchema,
  producedBy: z.string(),
  type: ArtifactTypeSchema,
  content: z.unknown(),
  contentHash: z.string(),
  createdAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type Artifact = z.infer<typeof ArtifactSchema>
