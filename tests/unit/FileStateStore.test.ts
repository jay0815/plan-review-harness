import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArtifactPathBuilder } from '../../src/artifacts/paths.js'
import type { PlanReviewState } from '../../src/schemas/index.js'
import { FileStateStore } from '../../src/state/FileStateStore.js'

const createdAt = '2026-01-01T00:00:00.000Z'

async function tempRunRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'state-store-'))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

function validState(): PlanReviewState {
  return {
    runId: 'run-1',
    createdAt,
    updatedAt: createdAt,
    stage: 'idle',
    status: 'initialized',
    round: 1,
    maxRounds: 2,
    artifacts: {
      plans: [],
      reviews: {},
    },
    decisions: [],
    confirmedIssues: [],
    errors: [],
  }
}

describe('FileStateStore', () => {
  it('saves and loads PlanReviewState through state.json', async () => {
    const root = await tempRunRoot()
    try {
      const paths = new ArtifactPathBuilder(root)
      const store = new FileStateStore(paths)

      await store.save(validState())

      const loaded = await store.load('run-1')
      expect(loaded.runId).toBe('run-1')
      expect(loaded.artifacts.plans).toEqual([])
      expect(loaded.artifacts.reviews).toEqual({})
    } finally {
      await cleanup(root)
    }
  })

  it('writes state.json to runs/<run-id>/state.json', async () => {
    const root = await tempRunRoot()
    try {
      const paths = new ArtifactPathBuilder(root)
      const store = new FileStateStore(paths)

      await store.save(validState())

      expect(paths.getStatePath('run-1')).toBe(path.join(root, 'run-1', 'state.json'))
      expect(existsSync(path.join(root, 'run-1', 'state.json'))).toBe(true)
    } finally {
      await cleanup(root)
    }
  })

  it('validates schema on save and rejects invalid state', async () => {
    const root = await tempRunRoot()
    try {
      const store = new FileStateStore(new ArtifactPathBuilder(root))

      await expect(
        store.save({
          ...validState(),
          stage: 'reviewing',
        } as unknown as PlanReviewState),
      ).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })

  it('validates schema on load and rejects corrupted state.json', async () => {
    const root = await tempRunRoot()
    try {
      const paths = new ArtifactPathBuilder(root)
      const store = new FileStateStore(paths)

      await store.save(validState())
      await store.save({
        ...validState(),
        runId: 'run-2',
      })

      await expect(store.load('run-2')).resolves.toMatchObject({ runId: 'run-2' })
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(paths.getStatePath('run-2'), JSON.stringify({ runId: 'run-2', stage: 'bad' })),
      )

      await expect(store.load('run-2')).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })

  it('load malformed JSON should fail', async () => {
    const root = await tempRunRoot()
    try {
      const paths = new ArtifactPathBuilder(root)
      const store = new FileStateStore(paths)
      await store.save(validState())
      await copyFile('tests/fixtures/malformed/malformed-json.json', paths.getStatePath('run-1'))

      await expect(store.load('run-1')).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })

  it('load state with missing required field should fail', async () => {
    const root = await tempRunRoot()
    try {
      const paths = new ArtifactPathBuilder(root)
      const store = new FileStateStore(paths)
      await store.save(validState())
      await copyFile('tests/fixtures/malformed/state-missing-required.json', paths.getStatePath('run-1'))

      await expect(store.load('run-1')).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })

  it('load state with invalid stage/status should fail', async () => {
    const root = await tempRunRoot()
    try {
      const paths = new ArtifactPathBuilder(root)
      const store = new FileStateStore(paths)
      await store.save(validState())
      await copyFile('tests/fixtures/malformed/state-invalid-stage-status.json', paths.getStatePath('run-1'))

      await expect(store.load('run-1')).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })

  it('save invalid status should fail', async () => {
    const root = await tempRunRoot()
    try {
      const store = new FileStateStore(new ArtifactPathBuilder(root))

      await expect(
        store.save({
          ...validState(),
          status: 'paused',
        } as unknown as PlanReviewState),
      ).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })
})
