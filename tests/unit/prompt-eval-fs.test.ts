import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createPromptEvalFileAdapter,
  loadPromptEvalCases,
  loadPromptEvalObservedOutput,
  persistPromptEvalRun,
  runPromptEvalSuite,
  type PromptEvalCase,
} from '../../src/prompt-eval/index.js'

const createdAt = '2026-01-01T00:00:00.000Z'

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function createCase(id: string): PromptEvalCase {
  return {
    version: 1,
    id,
    suite: 'golden',
    domain: 'plan-review',
    role: 'architecture-reviewer',
    title: `Case ${id}`,
    tags: [],
    input: { kind: 'inline', value: { plan: 'Deploy without rollback.' }, metadata: {} },
    expectations: {
      allowedOutcomes: ['issues_found'],
      mustFind: [{ id: 'rollback', title: 'rollback', evidence: [] }],
      mustNotFind: [],
      requiredEvidence: [],
      notes: [],
    },
    scorers: [{ id: 'deterministic', weight: 1, options: {} }],
    metadata: {},
  }
}

describe('prompt eval filesystem helpers', () => {
  it('loads cases from a JSON file tree', async () => {
    const root = await tempRoot('prompt-eval-cases-')
    try {
      await writeJson(path.join(root, 'b.json'), createCase('case-b'))
      await writeJson(path.join(root, 'nested', 'a.json'), { cases: [createCase('case-a')] })

      const cases = await loadPromptEvalCases(root)

      expect(cases.map((testCase) => testCase.id)).toEqual(['case-b', 'case-a'])
    } finally {
      await cleanup(root)
    }
  })

  it('loads observed output and runs the file adapter', async () => {
    const root = await tempRoot('prompt-eval-observed-')
    try {
      const observedPath = path.join(root, 'case-a.json')
      await writeJson(observedPath, {
        outcome: 'issues_found',
        findings: [{ id: 'ISSUE-1', title: 'Rollback missing' }],
      })

      const observed = await loadPromptEvalObservedOutput(observedPath)
      const adapter = createPromptEvalFileAdapter({ observedDir: root })

      expect(observed.findings[0]?.title).toBe('Rollback missing')
      await expect(adapter.evaluate(createCase('case-a'))).resolves.toMatchObject({
        outcome: 'issues_found',
      })
    } finally {
      await cleanup(root)
    }
  })

  it('persists manifest, result set, and report files', async () => {
    const observedDir = await tempRoot('prompt-eval-observed-')
    const outputDir = await tempRoot('prompt-eval-output-')
    try {
      await writeJson(path.join(observedDir, 'case-a.json'), {
        outcome: 'issues_found',
        findings: [{ id: 'ISSUE-1', title: 'Rollback missing' }],
      })
      const run = await runPromptEvalSuite({
        runId: 'eval-1',
        cases: [createCase('case-a')],
        adapter: createPromptEvalFileAdapter({ observedDir }),
        createdAt,
      })

      await persistPromptEvalRun({ outputDir, run })

      expect(existsSync(path.join(outputDir, 'run-manifest.json'))).toBe(true)
      expect(existsSync(path.join(outputDir, 'results.json'))).toBe(true)
      expect(existsSync(path.join(outputDir, 'report.json'))).toBe(true)
      const report = JSON.parse(await readFile(path.join(outputDir, 'report.json'), 'utf8')) as { runId: string }
      expect(report.runId).toBe('eval-1')
    } finally {
      await cleanup(observedDir)
      await cleanup(outputDir)
    }
  })
})
