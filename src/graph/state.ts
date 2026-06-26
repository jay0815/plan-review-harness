import type { ArtifactPathBuilder } from '../artifacts/paths.js'
import type { PlanReviewState } from '../schemas/state.js'
import type { WorkerRegistry } from '../workers/WorkerRegistry.js'

export interface NodeContext {
  paths: ArtifactPathBuilder
  workers: WorkerRegistry
}

export type PlanReviewStatePatch = Omit<Partial<PlanReviewState>, 'artifacts'> & {
  artifacts?: Partial<PlanReviewState['artifacts']>
}
