import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ArtifactPathBuilder } from '../../src/artifacts/paths.js'
import { FileArtifactStore } from '../../src/artifacts/FileArtifactStore.js'
import { ArtifactSchema, type Artifact } from '../../src/schemas/index.js'

const createdAt = '2026-01-01T00:00:00.000Z'

async function tempRunRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'artifact-store-'))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

describe('FileArtifactStore', () => {
  it('writeJson and loadByPath round-trip through schema validation', async () => {
    const root = await tempRunRoot()
    try {
      const store = new FileArtifactStore(new ArtifactPathBuilder(root))
      const schema = z.object({ ok: z.boolean() })
      const filePath = path.join(root, 'run-1', 'custom.json')

      await store.writeJson(filePath, { ok: true }, schema)

      await expect(store.loadByPath(filePath, schema)).resolves.toEqual({ ok: true })
      await expect(store.writeJson(filePath, { ok: 'yes' } as unknown as { ok: boolean }, schema)).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })

  it('save validates ArtifactSchema and generates a contentHash', async () => {
    const root = await tempRunRoot()
    try {
      const paths = new ArtifactPathBuilder(root)
      const store = new FileArtifactStore(paths)

      const ref = await store.save({
        id: 'artifact-1',
        runId: 'run-1',
        round: 1,
        stage: 'planning',
        producedBy: 'planner',
        type: 'plan',
        content: { planMarkdown: '# Plan' },
        contentHash: '',
        createdAt,
      })

      expect(ref.contentHash).toMatch(/^[a-f0-9]{64}$/)
      expect(ref.path).toBe(path.join(root, 'run-1', 'round-001', 'artifacts', 'artifact-1.json'))
      expect(existsSync(ref.path)).toBe(true)
      await expect(store.load(ref)).resolves.toMatchObject({
        id: 'artifact-1',
        contentHash: ref.contentHash,
      })
    } finally {
      await cleanup(root)
    }
  })

  it('save rejects artifacts that do not satisfy ArtifactSchema', async () => {
    const root = await tempRunRoot()
    try {
      const store = new FileArtifactStore(new ArtifactPathBuilder(root))

      await expect(
        store.save({
          id: 'artifact-1',
          runId: 'run-1',
          round: 1,
          stage: 'not-a-stage',
          producedBy: 'planner',
          type: 'plan',
          content: { planMarkdown: '# Plan' },
          contentHash: '',
          createdAt,
        } as unknown as Artifact),
      ).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })

  it('loadByPath rejects JSON that fails the supplied schema', async () => {
    const root = await tempRunRoot()
    try {
      const store = new FileArtifactStore(new ArtifactPathBuilder(root))
      const filePath = path.join(root, 'run-1', 'artifact.json')

      await store.writeJson(filePath, {
        id: 'artifact-1',
        runId: 'run-1',
        round: 1,
        stage: 'planning',
        producedBy: 'planner',
        type: 'plan',
        content: { planMarkdown: '# Plan' },
        contentHash: 'abc',
        createdAt,
      })

      await expect(store.loadByPath(filePath, ArtifactSchema)).resolves.toMatchObject({ id: 'artifact-1' })
      await store.writeJson(filePath, { id: 'artifact-1' })
      await expect(store.loadByPath(filePath, ArtifactSchema)).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })

  it('writeJson with invalid schema should fail', async () => {
    const root = await tempRunRoot()
    try {
      const store = new FileArtifactStore(new ArtifactPathBuilder(root))
      const filePath = path.join(root, 'run-1', 'custom.json')
      const schema = z.object({ count: z.number().min(1) })

      await expect(store.writeJson(filePath, { count: 0 }, schema)).rejects.toThrow()
      expect(existsSync(filePath)).toBe(false)
    } finally {
      await cleanup(root)
    }
  })

  it('loadByPath with malformed JSON should fail', async () => {
    const root = await tempRunRoot()
    try {
      const store = new FileArtifactStore(new ArtifactPathBuilder(root))
      const filePath = path.join(root, 'run-1', 'malformed.json')
      await mkdir(path.dirname(filePath), { recursive: true })
      await copyFile('tests/fixtures/malformed/malformed-json.json', filePath)

      await expect(store.loadByPath(filePath)).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })

  it('loadByPath with schema mismatch should fail', async () => {
    const root = await tempRunRoot()
    try {
      const store = new FileArtifactStore(new ArtifactPathBuilder(root))
      const filePath = path.join(root, 'run-1', 'artifact.json')
      await mkdir(path.dirname(filePath), { recursive: true })
      await copyFile('tests/fixtures/malformed/artifact-schema-mismatch.json', filePath)

      await expect(store.loadByPath(filePath, ArtifactSchema)).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })

  it('artifact ref pointing to a missing file should fail', async () => {
    const root = await tempRunRoot()
    try {
      const store = new FileArtifactStore(new ArtifactPathBuilder(root))

      await expect(
        store.load({
          id: 'missing-artifact',
          type: 'plan',
          runId: 'run-1',
          round: 1,
          path: path.join(root, 'run-1', 'round-001', 'artifacts', 'missing-artifact.json'),
          producedBy: 'test',
        }),
      ).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })
})
