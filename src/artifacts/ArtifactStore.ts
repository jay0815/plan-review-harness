import type { ZodSchema } from 'zod'
import type { Artifact, ArtifactRef } from '../schemas/artifact.js'

export interface ArtifactStore {
  save(artifact: Artifact): Promise<ArtifactRef>
  load(ref: ArtifactRef): Promise<Artifact>
  loadByPath<T>(filePath: string, schema?: ZodSchema<T>): Promise<T>
  writeJson<T>(filePath: string, value: T, schema?: ZodSchema<T>): Promise<void>
}
