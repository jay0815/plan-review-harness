import { z } from 'zod'

export const SeveritySchema = z.enum(['blocker', 'high', 'medium', 'low'])
export type Severity = z.infer<typeof SeveritySchema>

export const IssueTypeSchema = z.enum(['defect', 'risk', 'assumption', 'open_question', 'preference'])
export type IssueType = z.infer<typeof IssueTypeSchema>

export const ReviewDimensionSchema = z.enum(['architecture', 'execution', 'risk', 'custom'])
export type ReviewDimension = z.infer<typeof ReviewDimensionSchema>

export const WorkflowStageSchema = z.enum([
  'idle',
  'load_input',
  'planning',
  'blind_review',
  'synthesis',
  'auto_resolve',
  'human_gate',
  'revision',
  'regression',
  'convergence_check',
  'final_output',
  'done',
  'blocked',
  'error',
])
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>
