import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArtifactPathBuilder } from '../../src/artifacts/paths.js'
import { WorkerRegistry } from '../../src/workers/WorkerRegistry.js'
import { MockAgentWorkerAdapter } from '../../src/workers/MockAgentWorkerAdapter.js'
import { blindReview } from '../../src/graph/nodes/blindReview.js'
import type { PlanReviewState } from '../../src/schemas/index.js'
import type {
  AgentWorkerAdapter,
  AgentWorkerContext,
  AgentWorkerRole,
  AgentWorkerTask,
} from '../../src/workers/AgentWorkerAdapter.js'

const createdAt = '2026-01-01T00:00:00.000Z'
type ReviewerRole = 'architecture-reviewer' | 'execution-reviewer' | 'risk-reviewer'

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

async function writeReviewFixture(
  fixtureDir: string,
  fileName: string,
  reviewerId: string,
  dimension: string,
): Promise<void> {
  await mkdir(fixtureDir, { recursive: true })
  await writeFile(
    path.join(fixtureDir, fileName),
    JSON.stringify({
      reviewerId,
      dimension,
      issues: [
        {
          id: `ISSUE-${reviewerId}`,
          title: `${dimension} issue`,
          dimension,
          type: 'risk',
          severity: 'medium',
          confidence: 0.7,
          planRef: 'section:deployment',
          claim: 'A reviewer-only claim.',
          evidence: ['The plan has a deployment section.'],
          impact: 'The issue may affect rollout.',
          suggestion: 'Add detail.',
          sourceWorkerId: reviewerId,
          createdAt,
        },
      ],
    }),
  )
}

function state(runRoot: string): PlanReviewState {
  return {
    runId: 'run-1',
    createdAt,
    updatedAt: createdAt,
    stage: 'blind_review',
    status: 'running',
    round: 1,
    maxRounds: 2,
    artifacts: {
      requirement: {
        id: 'requirement',
        type: 'requirement',
        runId: 'run-1',
        round: 0,
        path: path.join(runRoot, 'run-1', 'input', 'requirement.md'),
        producedBy: 'loadInput',
      },
      currentPlan: {
        id: 'plan',
        type: 'plan',
        runId: 'run-1',
        round: 1,
        path: path.join(runRoot, 'run-1', 'round-001', 'plan', 'current-plan.md'),
        producedBy: 'loadInput',
      },
      plans: [],
      reviews: {},
    },
    decisions: [],
    confirmedIssues: [],
    errors: [],
  }
}

class ReturningReviewWorker implements AgentWorkerAdapter<unknown, unknown> {
  readonly kind = 'manual'

  constructor(
    readonly role: ReviewerRole,
    private readonly dimension: 'architecture' | 'execution' | 'risk',
  ) {}

  async execute(_task: AgentWorkerTask<unknown>, _context: AgentWorkerContext): Promise<unknown> {
    return {
      reviewerId: this.role,
      dimension: this.dimension,
      issues: [],
    }
  }
}

describe('blind review isolation', () => {
  it('passes only requirement/currentPlan/context to each reviewer', async () => {
    const runRoot = await tempRoot('blind-run-')
    const fixtureDir = await tempRoot('blind-fixtures-')
    try {
      await writeReviewFixture(fixtureDir, 'architecture.json', 'architecture-reviewer', 'architecture')
      await writeReviewFixture(fixtureDir, 'execution.json', 'execution-reviewer', 'execution')
      await writeReviewFixture(fixtureDir, 'risk.json', 'risk-reviewer', 'risk')

      const registry = new WorkerRegistry()
      registry.register(
        new MockAgentWorkerAdapter({ role: 'architecture-reviewer', fixtureName: 'architecture.json', fixtureDir }),
      )
      registry.register(
        new MockAgentWorkerAdapter({ role: 'execution-reviewer', fixtureName: 'execution.json', fixtureDir }),
      )
      registry.register(new MockAgentWorkerAdapter({ role: 'risk-reviewer', fixtureName: 'risk.json', fixtureDir }))

      const paths = new ArtifactPathBuilder(runRoot)
      const result = await blindReview({ paths, workers: registry }, state(runRoot))

      expect(result.stage).toBe('synthesis')
      expect(Object.keys(result.artifacts?.reviews ?? {}).sort()).toEqual([
        'architecture-reviewer',
        'execution-reviewer',
        'risk-reviewer',
      ])

      for (const role of ['architecture-reviewer', 'execution-reviewer', 'risk-reviewer']) {
        const manifestPath = path.join(runRoot, 'run-1', 'round-001', 'workers', role, 'task', 'input-manifest.json')
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { input: Record<string, unknown> }
        expect(Object.keys(manifest.input).sort()).toEqual([
          'currentPlan',
          'dimension',
          'requirement',
          'round',
          'suppressionRules',
        ])
        expect(JSON.stringify(manifest.input)).not.toContain('architecture-reviewer/output')
        expect(JSON.stringify(manifest.input)).not.toContain('execution-reviewer/output')
        expect(JSON.stringify(manifest.input)).not.toContain('risk-reviewer/output')
      }
    } finally {
      await cleanup(runRoot)
      await cleanup(fixtureDir)
    }
  })

  it('persists review results returned by workers that do not write output files', async () => {
    const runRoot = await tempRoot('blind-run-')
    try {
      const registry = new WorkerRegistry()
      registry.register(new ReturningReviewWorker('architecture-reviewer', 'architecture'))
      registry.register(new ReturningReviewWorker('execution-reviewer', 'execution'))
      registry.register(new ReturningReviewWorker('risk-reviewer', 'risk'))

      const paths = new ArtifactPathBuilder(runRoot)
      const result = await blindReview({ paths, workers: registry }, state(runRoot))

      for (const [role, ref] of Object.entries(result.artifacts?.reviews ?? {}) as Array<
        [AgentWorkerRole, { path: string }]
      >) {
        expect(existsSync(ref.path)).toBe(true)
        const payload = JSON.parse(await readFile(ref.path, 'utf8')) as { result: { reviewerId: string } }
        expect(payload.result.reviewerId).toBe(role)
      }
    } finally {
      await cleanup(runRoot)
    }
  })
})
