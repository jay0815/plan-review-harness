import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { ArtifactPathBuilder } from '../artifacts/paths.js'
import { PlanReviewStateSchema, type PlanReviewState } from '../schemas/state.js'
import { atomicWriteJson } from '../utils/fs.js'
import type { StateStore } from './StateStore.js'

export class FileStateStore implements StateStore {
  constructor(private readonly paths: ArtifactPathBuilder) {}

  async save(state: PlanReviewState): Promise<void> {
    const parsed = PlanReviewStateSchema.parse(state)
    await atomicWriteJson(this.paths.getStatePath(parsed.runId), parsed)
  }

  async load(runId: string): Promise<PlanReviewState> {
    const raw = await readFile(this.paths.getStatePath(runId), 'utf8')
    return PlanReviewStateSchema.parse(JSON.parse(raw))
  }

  async exists(runId: string): Promise<boolean> {
    try {
      await access(this.paths.getStatePath(runId))
      return true
    } catch {
      return false
    }
  }

  async list(): Promise<PlanReviewState[]> {
    let entries: string[]
    try {
      entries = await readdir(this.paths.getRunRoot())
    } catch {
      return []
    }

    const states = await Promise.all(
      entries.map(async (entry) => {
        try {
          return await this.load(path.basename(entry))
        } catch {
          return undefined
        }
      }),
    )

    return states.filter((state): state is PlanReviewState => state !== undefined)
  }
}
