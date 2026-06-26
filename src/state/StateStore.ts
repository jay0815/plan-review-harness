import type { PlanReviewState } from '../schemas/state.js'

export interface StateStore {
  save(state: PlanReviewState): Promise<void>
  load(runId: string): Promise<PlanReviewState>
  exists(runId: string): Promise<boolean>
  list(): Promise<PlanReviewState[]>
}
