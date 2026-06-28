import { describe, expect, it } from 'vitest'
import { ArtifactPathBuilder } from '../../src/artifacts/paths.js'

describe('ArtifactPathBuilder.buildWorkerContext', () => {
  it('builds a complete AgentWorkerContext from runId, round, role, nodeName', () => {
    const paths = new ArtifactPathBuilder('/tmp/runs')
    const ctx = paths.buildWorkerContext('run-abc', 2, 'architecture-reviewer', 'blindReview')

    expect(ctx).toEqual({
      runId: 'run-abc',
      round: 2,
      nodeName: 'blindReview',
      role: 'architecture-reviewer',
      runDir: '/tmp/runs/run-abc',
      workerDir: '/tmp/runs/run-abc/round-002/workers/architecture-reviewer',
      inputDir: '/tmp/runs/run-abc/round-002/workers/architecture-reviewer/input',
      outputDir: '/tmp/runs/run-abc/round-002/workers/architecture-reviewer/output',
      logDir: '/tmp/runs/run-abc/round-002/workers/architecture-reviewer/logs',
    })
  })

  it('works for reviser role', () => {
    const paths = new ArtifactPathBuilder('/tmp/runs')
    const ctx = paths.buildWorkerContext('run-1', 1, 'reviser', 'revision')

    expect(ctx.role).toBe('reviser')
    expect(ctx.nodeName).toBe('revision')
    expect(ctx.workerDir).toContain('workers/reviser')
  })

  it('works for regression role', () => {
    const paths = new ArtifactPathBuilder('/tmp/runs')
    const ctx = paths.buildWorkerContext('run-1', 1, 'regression', 'regression')

    expect(ctx.role).toBe('regression')
    expect(ctx.workerDir).toContain('workers/regression')
  })
})
