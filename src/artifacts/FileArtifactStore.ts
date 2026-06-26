import { readFile } from 'node:fs/promises'
import type { ZodSchema } from 'zod'
import { ArtifactSchema, type Artifact, type ArtifactRef } from '../schemas/artifact.js'
import { atomicWriteJson } from '../utils/fs.js'
import type { ArtifactStore } from './ArtifactStore.js'
import { stableJsonHash } from './hash.js'
import { ArtifactPathBuilder } from './paths.js'

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly paths: ArtifactPathBuilder) {}

  async save(artifact: Artifact): Promise<ArtifactRef> {
    const contentHash = stableJsonHash(artifact.content)
    const parsed = ArtifactSchema.parse({
      ...artifact,
      contentHash,
    })
    const filePath = this.paths.getArtifactPath(parsed.runId, parsed.round, parsed.id)
    await this.writeJson(filePath, parsed, ArtifactSchema)
    return {
      id: parsed.id,
      type: parsed.type,
      runId: parsed.runId,
      round: parsed.round,
      path: filePath,
      producedBy: parsed.producedBy,
      contentHash,
    }
  }

  async load(ref: ArtifactRef): Promise<Artifact> {
    return this.loadByPath(ref.path, ArtifactSchema)
  }

  async loadByPath<T>(filePath: string, schema?: ZodSchema<T>): Promise<T> {
    const raw = await readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return schema ? schema.parse(parsed) : (parsed as T)
  }

  async writeJson<T>(filePath: string, value: T, schema?: ZodSchema<T>): Promise<void> {
    const parsed = schema ? schema.parse(value) : value
    await atomicWriteJson(filePath, parsed)
  }
}
