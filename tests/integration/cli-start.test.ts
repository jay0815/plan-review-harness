import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/index.js'

const execFileAsync = promisify(execFile)

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'cli-start-'))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

describe('plan-review CLI start', () => {
  it('runs the start command with sample fixtures', async () => {
    const runDir = await tempRoot()
    try {
      const output: string[] = []
      const exitCode = await runCli(
        [
          'node',
          'plan-review',
          'start',
          '--requirement',
          'fixtures/sample-requirement.md',
          '--plan',
          'fixtures/sample-plan.md',
          '--max-rounds',
          '2',
          '--run-dir',
          runDir,
        ],
        {
          stdout: (line) => output.push(line),
          stderr: (line) => output.push(line),
        },
      )
      const stdout = output.join('\n')

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Run created: run-')
      expect(stdout).toContain('Status: completed')
      const runId = stdout.match(/Run created: (run-[^\n]+)/)?.[1]
      expect(runId).toBeTruthy()
      expect(existsSync(path.join(runDir, runId!, 'state.json'))).toBe(true)
      expect(existsSync(path.join(runDir, runId!, 'final', 'final-report.json'))).toBe(true)
    } finally {
      await cleanup(runDir)
    }
  })

  it('exits non-zero when required start args are missing', async () => {
    const output: string[] = []
    const exitCode = await runCli(['node', 'plan-review', 'start'], {
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
    })

    expect(exitCode).toBe(1)
    expect(output.join('\n')).toContain('Missing required option: --requirement')
  })

  it('runs through the package script used by pnpm plan-review', async () => {
    const runDir = await tempRoot()
    try {
      const { stdout } = await execFileAsync('pnpm', [
        'plan-review',
        'start',
        '--requirement',
        'fixtures/sample-requirement.md',
        '--plan',
        'fixtures/sample-plan.md',
        '--max-rounds',
        '2',
        '--run-dir',
        runDir,
      ])

      expect(stdout).toContain('Run created: run-')
      expect(stdout).toContain('Status: completed')
      const runId = stdout.match(/Run created: (run-[^\n]+)/)?.[1]
      expect(runId).toBeTruthy()
      expect(existsSync(path.join(runDir, runId!, 'final', 'final-report.json'))).toBe(true)
    } finally {
      await cleanup(runDir)
    }
  })
})
