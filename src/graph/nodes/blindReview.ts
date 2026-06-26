import path from 'node:path'
import { ReviewResultSchema } from '../../schemas/worker.js'
import type { ArtifactRef } from '../../schemas/artifact.js'
import type { AgentWorkerRole } from '../../workers/AgentWorkerAdapter.js'
import { atomicWriteJson } from '../../utils/fs.js'
import type { NodeContext, PlanReviewStatePatch } from '../state.js'
import type { PlanReviewState } from '../../schemas/state.js'

type ReviewerRole = 'architecture-reviewer' | 'execution-reviewer' | 'risk-reviewer'

const reviewerRoles: ReviewerRole[] = ['architecture-reviewer', 'execution-reviewer', 'risk-reviewer']

const dimensionByRole: Record<ReviewerRole, 'architecture' | 'execution' | 'risk'> = {
  'architecture-reviewer': 'architecture',
  'execution-reviewer': 'execution',
  'risk-reviewer': 'risk',
}

export async function blindReview(ctx: NodeContext, state: PlanReviewState): Promise<PlanReviewStatePatch> {
  if (!state.artifacts.requirement || !state.artifacts.currentPlan) {
    throw new Error(`runId=${state.runId} stage=blind_review round=${state.round}: missing requirement/currentPlan`)
  }

  const reviewers = ctx.workers.getReviewers()
  const workerByRole = {
    'architecture-reviewer': reviewers.architecture,
    'execution-reviewer': reviewers.execution,
    'risk-reviewer': reviewers.risk,
  }

  const reviewEntries = await Promise.all(
    reviewerRoles.map(async (role) => {
      const outputDir = ctx.paths.getWorkerOutputDir(state.runId, state.round, role)
      const result = await workerByRole[role].execute(
        {
          taskId: `review-${role}-${state.runId}-${state.round}`,
          type: 'review_plan',
          input: {
            requirement: state.artifacts.requirement,
            currentPlan: state.artifacts.currentPlan,
            dimension: dimensionByRole[role],
            suppressionRules: [],
            round: state.round,
          },
        },
        {
          runId: state.runId,
          round: state.round,
          nodeName: 'blindReview',
          role: role as AgentWorkerRole,
          runDir: ctx.paths.getRunDir(state.runId),
          workerDir: ctx.paths.getWorkerDir(state.runId, state.round, role),
          inputDir: ctx.paths.getWorkerInputDir(state.runId, state.round, role),
          outputDir,
          logDir: ctx.paths.getWorkerLogDir(state.runId, state.round, role),
        },
      )

      const parsedResult = ReviewResultSchema.parse(result)
      const resultPath = path.join(outputDir, 'result.json')
      await atomicWriteJson(resultPath, {
        meta: {
          runId: state.runId,
          round: state.round,
          role,
          producedBy: role,
          createdAt: state.updatedAt,
        },
        result: parsedResult,
      })
      const ref: ArtifactRef = {
        id: `review-${role}-round-${state.round}`,
        type: 'review',
        runId: state.runId,
        round: state.round,
        path: resultPath,
        producedBy: role,
      }
      return [role, ref] as const
    }),
  )

  return {
    stage: 'synthesis',
    artifacts: {
      reviews: Object.fromEntries(reviewEntries),
    },
  }
}
