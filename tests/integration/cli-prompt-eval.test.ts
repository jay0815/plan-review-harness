import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/index.js'

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

describe('plan-review CLI prompt-eval', () => {
  it('runs prompt eval from case and observed output files', async () => {
    const root = await tempRoot('cli-prompt-eval-')
    try {
      const casesDir = path.join(root, 'cases')
      const observedDir = path.join(root, 'observed')
      const outputDir = path.join(root, 'out')

      await writeJson(path.join(casesDir, 'rollback.json'), {
        version: 1,
        id: 'plan-review.rollback',
        suite: 'golden',
        domain: 'plan-review',
        role: 'architecture-reviewer',
        title: 'Detect missing rollback plan',
        input: { kind: 'inline', value: { plan: 'Deploy without rollback.' } },
        expectations: {
          allowedOutcomes: ['issues_found'],
          mustFind: [{ id: 'rollback', title: 'rollback' }],
        },
      })
      await writeJson(path.join(observedDir, 'plan-review.rollback.json'), {
        outcome: 'issues_found',
        findings: [{ id: 'ISSUE-1', title: 'Rollback path is missing' }],
      })

      const output: string[] = []
      const exitCode = await runCli(
        [
          'node',
          'plan-review',
          'prompt-eval',
          '--cases',
          casesDir,
          '--observed-dir',
          observedDir,
          '--output-dir',
          outputDir,
          '--run-id',
          'eval-1',
          '--project-name',
          'plan-review-harness',
        ],
        {
          stdout: (line) => output.push(line),
          stderr: (line) => output.push(line),
        },
      )

      const stdout = output.join('\n')
      expect(exitCode).toBe(0)
      expect(stdout).toContain('Prompt eval run: eval-1')
      expect(stdout).toContain('Passed: 1')
      expect(existsSync(path.join(outputDir, 'run-manifest.json'))).toBe(true)
      expect(existsSync(path.join(outputDir, 'results.json'))).toBe(true)
      expect(existsSync(path.join(outputDir, 'report.json'))).toBe(true)

      const report = JSON.parse(await readFile(path.join(outputDir, 'report.json'), 'utf8')) as {
        totals: { cases: number; passed: number }
      }
      expect(report.totals).toMatchObject({ cases: 1, passed: 1 })
    } finally {
      await cleanup(root)
    }
  })

  it('exits non-zero when required prompt eval args are missing', async () => {
    const output: string[] = []
    const exitCode = await runCli(['node', 'plan-review', 'prompt-eval'], {
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
    })

    expect(exitCode).toBe(1)
    expect(output.join('\n')).toContain('--cases is required')
  })
})
