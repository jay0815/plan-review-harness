import { copyFile, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { ArtifactPathBuilder } from '../artifacts/paths.js'
import {
  DecisionQueueSchema,
  UserDecisionsSchema,
  type DecisionQueue,
  type UserDecisions,
} from '../schemas/decision.js'
import { ConvergenceReportSchema, RegressionReportSchema, type ConvergenceReport } from '../schemas/regression.js'
import { RevisionResultSchema, type ReviewResult } from '../schemas/worker.js'
import { type PlanReviewState } from '../schemas/state.js'
import { DisagreementLedgerSchema, IssueLedgerSchema } from '../schemas/ledger.js'
import { FileStateStore } from '../state/FileStateStore.js'
import { atomicWriteJson, atomicWriteText, ensureDir, systemClock, type Clock } from '../utils/fs.js'
import { WorkerRegistry } from '../workers/WorkerRegistry.js'
import type { AgentWorkerAdapter } from '../workers/AgentWorkerAdapter.js'
import { blindReview } from './nodes/blindReview.js'

export interface HarnessConfig {
  runDir: string
  maxRounds: number
  workers: AgentWorkerAdapter[]
  clock?: Clock
}

export interface StartPlanReviewInput {
  requirementPath: string
  initialPlanPath?: string
  maxRounds?: number
}

export interface ResumePlanReviewInput {
  decisionsPath: string
}

export interface WorkflowRunHandle {
  runId: string
  stage: PlanReviewState['stage']
  status: PlanReviewState['status']
  state: PlanReviewState
}

export class WorkflowError extends Error {
  readonly stage: string
  readonly runId: string
  constructor(message: string, options: { cause?: unknown; stage: string; runId: string }) {
    super(message, { cause: options.cause })
    this.name = 'WorkflowError'
    this.stage = options.stage
    this.runId = options.runId
  }
}

export class LangGraphWorkflowRuntime {
  private readonly paths: ArtifactPathBuilder
  private readonly states: FileStateStore
  private readonly workers: WorkerRegistry
  private readonly clock: Clock

  constructor(private readonly config: HarnessConfig) {
    this.paths = new ArtifactPathBuilder(config.runDir)
    this.states = new FileStateStore(this.paths)
    this.workers = new WorkerRegistry()
    this.clock = config.clock ?? systemClock
    for (const worker of config.workers) this.workers.register(worker)
  }

  async start(input: StartPlanReviewInput): Promise<WorkflowRunHandle> {
    const runId = `run-${randomUUID()}`
    const round = 1
    await ensureDir(this.paths.getInputDir(runId))
    await copyFile(input.requirementPath, this.paths.getRequirementPath(runId))
    if (!input.initialPlanPath) throw new Error('initialPlanPath is required by the current skeleton')
    await copyFile(input.initialPlanPath, this.paths.getInitialPlanPath(runId))

    let state: PlanReviewState = {
      runId,
      createdAt: this.clock.now(),
      updatedAt: this.clock.now(),
      stage: 'blind_review',
      status: 'running',
      round,
      maxRounds: input.maxRounds ?? this.config.maxRounds,
      artifacts: {
        requirement: {
          id: 'requirement',
          type: 'requirement',
          runId,
          round: 0,
          path: this.paths.getRequirementPath(runId),
          producedBy: 'loadInput',
        },
        currentPlan: {
          id: 'initial-plan',
          type: 'plan',
          runId,
          round: 0,
          path: this.paths.getInitialPlanPath(runId),
          producedBy: 'loadInput',
        },
        plans: [],
        reviews: {},
      },
      decisions: [],
      confirmedIssues: [],
      errors: [],
    }

    try {
      const reviewPatch = await blindReview({ paths: this.paths, workers: this.workers }, state)
      state = this.merge(state, reviewPatch)
      state = await this.synthesizeAndMaybePause(state)
      await this.states.save(state)
      return this.handle(state)
    } catch (error) {
      await this.saveFailedState(state, error)
      throw new WorkflowError(`${state.stage} failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
        stage: state.stage,
        runId: state.runId,
      })
    }
  }

  async resume(runId: string, input: ResumePlanReviewInput): Promise<WorkflowRunHandle> {
    let state = await this.states.load(runId)
    if (state.status !== 'waiting_for_decision' || !state.artifacts.decisionQueue) {
      throw new Error(`runId=${runId}: run is not waiting for decisions`)
    }
    const queue = DecisionQueueSchema.parse(JSON.parse(await readFile(state.artifacts.decisionQueue.path, 'utf8')))
    const userDecisions = UserDecisionsSchema.parse(JSON.parse(await readFile(input.decisionsPath, 'utf8')))
    this.validateUserDecisions(runId, state.round, queue, userDecisions)

    const userDecisionPath = this.paths.getUserDecisionsPath(runId, state.round)
    await atomicWriteJson(userDecisionPath, {
      runId,
      round: state.round,
      decisions: userDecisions.decisions,
      createdAt: this.clock.now(),
    })

    state = this.merge(state, {
      stage: 'revision',
      status: 'running',
      decisions: [...state.decisions, ...userDecisions.decisions],
      artifacts: {
        userDecisions: {
          id: `user-decisions-${state.round}`,
          type: 'user_decisions',
          runId,
          round: state.round,
          path: userDecisionPath,
          producedBy: 'humanDecisionGate',
        },
      },
    })

    try {
      state = await this.runRevisionRegressionFinal(state)
      await this.states.save(state)
      return this.handle(state)
    } catch (error) {
      await this.saveFailedState(state, error)
      throw new WorkflowError(`${state.stage} failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
        stage: state.stage,
        runId: state.runId,
      })
    }
  }

  private validateUserDecisions(
    runId: string,
    round: number,
    queue: DecisionQueue,
    userDecisions: UserDecisions,
  ): void {
    if (userDecisions.runId !== undefined && userDecisions.runId !== runId) {
      throw new Error(`User decisions runId mismatch: expected ${runId}, received ${userDecisions.runId}`)
    }
    if (userDecisions.round !== undefined && userDecisions.round !== round) {
      throw new Error(`User decisions round mismatch: expected ${round}, received ${userDecisions.round}`)
    }

    const itemsById = new Map(queue.items.map((item) => [item.id, item]))
    const seenItemIds = new Set<string>()
    for (const decision of userDecisions.decisions) {
      const item = itemsById.get(decision.itemId)
      if (!item) throw new Error(`Decision item not found: ${decision.itemId}`)
      if (seenItemIds.has(decision.itemId)) throw new Error(`Duplicate decision for item: ${decision.itemId}`)
      if (!item.options.some((option) => option.key === decision.chosenKey)) {
        throw new Error(`Invalid decision option for item ${decision.itemId}: ${decision.chosenKey}`)
      }
      seenItemIds.add(decision.itemId)
    }

    const missingItemIds = queue.items.filter((item) => !seenItemIds.has(item.id)).map((item) => item.id)
    if (missingItemIds.length > 0) {
      throw new Error(`Missing decision for item(s): ${missingItemIds.join(', ')}`)
    }
  }

  private async synthesizeAndMaybePause(state: PlanReviewState): Promise<PlanReviewState> {
    const reviews = await Promise.all(
      Object.values(state.artifacts.reviews).map(async (ref) => {
        const value = JSON.parse(await readFile(ref.path, 'utf8')) as { result?: unknown }
        return (value.result ?? value) as ReviewResult
      }),
    )
    const issues = reviews.flatMap((review) => review.issues)
    const mergedIssues = this.mergeIssues(issues)
    const issueLedgerPath = this.paths.getIssueLedgerPath(state.runId, state.round)
    await atomicWriteJson(
      issueLedgerPath,
      IssueLedgerSchema.parse({
        runId: state.runId,
        round: state.round,
        issues: mergedIssues,
        createdAt: this.clock.now(),
      }),
    )

    // Derive disagreements and decisionQueue from mergedIssues, not raw issues
    const l3MergedIssues = mergedIssues.filter((issue) => issue.severity === 'blocker')
    const disagreements = l3MergedIssues.map((mergedIssue) => {
      // Find the original issue for claim/confidence/suggestion
      const original = issues.find((i) => mergedIssue.relatedIssueIds.includes(i.id))
      return {
        id: `disagreement-${mergedIssue.id}`,
        issueId: mergedIssue.id,
        title: mergedIssue.title,
        level: 'L3' as const,
        positions: mergedIssue.supportedBy.map((workerId) => ({
          workerId,
          claim: original?.claim ?? '',
          confidence: original?.confidence ?? 0,
          reasoning: original?.suggestion ?? '',
        })),
        humanDecisionRequired: true,
        createdAt: this.clock.now(),
      }
    })
    const disagreementLedgerPath = this.paths.getDisagreementLedgerPath(state.runId, state.round)
    await atomicWriteJson(
      disagreementLedgerPath,
      DisagreementLedgerSchema.parse({
        runId: state.runId,
        round: state.round,
        disagreements,
        createdAt: this.clock.now(),
      }),
    )
    const queue: DecisionQueue = {
      runId: state.runId,
      round: state.round,
      items: l3MergedIssues.map((mergedIssue) => {
        const original = issues.find((i) => mergedIssue.relatedIssueIds.includes(i.id))
        return {
          id: `decision-${mergedIssue.id}`,
          disagreementId: `disagreement-${mergedIssue.id}`,
          title: mergedIssue.title,
          description: original?.claim ?? '',
          options: [
            { key: 'adopt', label: 'Adopt', description: 'Adopt the issue suggestion.' },
            { key: 'reject', label: 'Reject', description: 'Reject the issue suggestion.' },
          ],
          context: {
            positions: mergedIssue.supportedBy.map((workerId) => ({
              workerId,
              claim: original?.claim ?? '',
              confidence: original?.confidence ?? 0,
              reasoning: original?.suggestion ?? '',
            })),
            relatedIssues: [mergedIssue.id],
            impactSummary: original?.impact ?? '',
          },
          createdAt: this.clock.now(),
        }
      }),
      createdAt: this.clock.now(),
    }
    const queuePath = this.paths.getDecisionQueuePath(state.runId, state.round)
    await atomicWriteJson(queuePath, queue)
    const synthesizedState = this.merge(state, {
      stage: 'human_gate',
      status: 'waiting_for_decision',
      artifacts: {
        issueLedger: {
          id: `issue-ledger-${state.round}`,
          type: 'issue_ledger',
          runId: state.runId,
          round: state.round,
          path: issueLedgerPath,
          producedBy: 'synthesis',
        },
        disagreementLedger: {
          id: `disagreement-ledger-${state.round}`,
          type: 'disagreement_ledger',
          runId: state.runId,
          round: state.round,
          path: disagreementLedgerPath,
          producedBy: 'synthesis',
        },
        decisionQueue: {
          id: `decision-queue-${state.round}`,
          type: 'decision_queue',
          runId: state.runId,
          round: state.round,
          path: queuePath,
          producedBy: 'autoResolve',
        },
      },
    })
    synthesizedState.confirmedIssues = mergedIssues.map((issue) => ({
      issueId: issue.id,
      severity: issue.severity as 'blocker' | 'high' | 'medium' | 'low',
      status: issue.status,
      ledgerPath: issueLedgerPath,
      round: state.round,
    }))
    if (l3MergedIssues.length === 0) {
      return this.runRevisionRegressionFinal({ ...synthesizedState, stage: 'revision', status: 'running' })
    }
    return synthesizedState
  }

  private async runRevisionRegressionFinal(state: PlanReviewState): Promise<PlanReviewState> {
    const revision = RevisionResultSchema.parse(
      await this.workers.getRequiredOne('reviser').execute(
        {
          taskId: `revision-${state.runId}-${state.round}`,
          type: 'revise_plan',
          input: { decisions: state.decisions },
        },
        this.paths.buildWorkerContext(state.runId, state.round, 'reviser', 'revision'),
      ),
    )
    const planPath = this.paths.getRevisionPlanPath(state.runId, state.round)
    const revisionLogPath = this.paths.getRevisionLogPath(state.runId, state.round)
    await atomicWriteText(planPath, revision.planMarkdown)
    await atomicWriteJson(revisionLogPath, { ...revision.revisionLog, runId: state.runId, round: state.round })

    const regression = RegressionReportSchema.parse(
      await this.workers
        .getRequiredOne('regression')
        .execute(
          { taskId: `regression-${state.runId}-${state.round}`, type: 'regression_review', input: { planPath } },
          this.paths.buildWorkerContext(state.runId, state.round, 'regression', 'regression'),
        ),
    )
    const regressionPath = this.paths.getRegressionReportPath(state.runId, state.round)
    await atomicWriteJson(regressionPath, { ...regression, runId: state.runId, round: state.round })
    const convergence = this.evaluateConvergence(state, regression.blockerCount, regression.highCount)
    const convergencePath = this.paths.getConvergenceReportPath(state.runId, state.round)
    await atomicWriteJson(convergencePath, ConvergenceReportSchema.parse(convergence))

    if (convergence.nextAction === 'continue') {
      const nextState = this.merge(state, {
        round: state.round + 1,
        stage: 'blind_review',
        artifacts: {
          currentPlan: {
            id: `revised-plan-${state.round}`,
            type: 'plan',
            runId: state.runId,
            round: state.round,
            path: planPath,
            producedBy: 'reviser',
          },
          revisionLog: {
            id: `revision-log-${state.round}`,
            type: 'revision_log',
            runId: state.runId,
            round: state.round,
            path: revisionLogPath,
            producedBy: 'reviser',
          },
          regressionReport: {
            id: `regression-report-${state.round}`,
            type: 'regression_report',
            runId: state.runId,
            round: state.round,
            path: regressionPath,
            producedBy: 'regression',
          },
          convergenceReport: {
            id: `convergence-report-${state.round}`,
            type: 'convergence_report',
            runId: state.runId,
            round: state.round,
            path: convergencePath,
            producedBy: 'convergenceCheck',
          },
          reviews: {},
        },
      })
      const reviewPatch = await blindReview({ paths: this.paths, workers: this.workers }, nextState)
      return this.synthesizeAndMaybePause(this.merge(nextState, reviewPatch))
    }

    const finalPlanPath = this.paths.getFinalPlanPath(state.runId)
    const finalReportPath = this.paths.getFinalReportPath(state.runId)
    await atomicWriteText(finalPlanPath, revision.planMarkdown)
    await atomicWriteJson(finalReportPath, {
      runId: state.runId,
      status: convergence.nextAction === 'blocked' ? 'blocked' : 'completed',
      round: state.round,
      createdAt: this.clock.now(),
    })

    return this.merge(state, {
      stage: 'done',
      status: convergence.nextAction === 'blocked' ? 'blocked' : 'completed',
      artifacts: {
        currentPlan: {
          id: `revised-plan-${state.round}`,
          type: 'plan',
          runId: state.runId,
          round: state.round,
          path: planPath,
          producedBy: 'reviser',
        },
        revisionLog: {
          id: `revision-log-${state.round}`,
          type: 'revision_log',
          runId: state.runId,
          round: state.round,
          path: revisionLogPath,
          producedBy: 'reviser',
        },
        regressionReport: {
          id: `regression-report-${state.round}`,
          type: 'regression_report',
          runId: state.runId,
          round: state.round,
          path: regressionPath,
          producedBy: 'regression',
        },
        convergenceReport: {
          id: `convergence-report-${state.round}`,
          type: 'convergence_report',
          runId: state.runId,
          round: state.round,
          path: convergencePath,
          producedBy: 'convergenceCheck',
        },
        finalReport: {
          id: 'final-report',
          type: 'final_report',
          runId: state.runId,
          round: state.round,
          path: finalReportPath,
          producedBy: 'finalOutput',
        },
      },
    })
  }

  private evaluateConvergence(state: PlanReviewState, blockerCount: number, highCount: number): ConvergenceReport {
    if (blockerCount === 0 && highCount === 0) {
      return {
        runId: state.runId,
        round: state.round,
        converged: true,
        reason: 'No blocker or high severity issues remain.',
        nextAction: 'done',
        blockerCount,
        highCount,
        roundLimitReached: false,
        createdAt: this.clock.now(),
      }
    }
    if (state.round < state.maxRounds) {
      return {
        runId: state.runId,
        round: state.round,
        converged: false,
        reason: 'Regression still has blocker/high issues; continuing.',
        nextAction: 'continue',
        blockerCount,
        highCount,
        roundLimitReached: false,
        createdAt: this.clock.now(),
      }
    }
    return {
      runId: state.runId,
      round: state.round,
      converged: false,
      reason: 'Round limit reached with blocker/high issues remaining.',
      nextAction: 'blocked',
      blockerCount,
      highCount,
      roundLimitReached: true,
      createdAt: this.clock.now(),
    }
  }

  private mergeIssues(issues: ReviewResult['issues']): Array<{
    id: string
    title: string
    dimension: string
    type: string
    severity: string
    confidence: number
    planRef: string
    claim: string
    evidence: string[]
    impact: string
    suggestion: string
    worstCase?: string
    sourceWorkerId?: string
    createdAt: string
    supportedBy: string[]
    status: 'consensus' | 'single_point'
    relatedIssueIds: string[]
  }> {
    const normalizeTitle = (title: string): string =>
      title
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

    const groups = new Map<string, ReviewResult['issues']>()
    for (const issue of issues) {
      const key = normalizeTitle(issue.title)
      const existing = groups.get(key)
      if (existing) existing.push(issue)
      else groups.set(key, [issue])
    }

    return Array.from(groups.values()).map((group) => {
      const first = group[0]
      const supporters = [...new Set(group.map((i) => i.sourceWorkerId ?? 'unknown'))]
      const status = supporters.length >= 2 ? 'consensus' : 'single_point'
      return {
        ...first,
        id: `MERGED-${first.id}`,
        supportedBy: supporters,
        status: status as 'consensus' | 'single_point',
        relatedIssueIds: group.map((i) => i.id),
      }
    })
  }

  private async saveFailedState(state: PlanReviewState, error: unknown): Promise<void> {
    try {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      const failedState = this.merge(state, {
        status: 'failed',
        errors: [
          ...state.errors,
          {
            stage: state.stage,
            message,
            stack,
            createdAt: this.clock.now(),
          },
        ],
      })
      await this.states.save(failedState)
    } catch {
      // Saving failed state itself failed — do not mask the original error
    }
  }

  private merge(
    state: PlanReviewState,
    patch: Omit<Partial<PlanReviewState>, 'artifacts'> & { artifacts?: Partial<PlanReviewState['artifacts']> },
  ): PlanReviewState {
    return {
      ...state,
      ...patch,
      updatedAt: this.clock.now(),
      artifacts: { ...state.artifacts, ...patch.artifacts },
    }
  }

  private handle(state: PlanReviewState): WorkflowRunHandle {
    return { runId: state.runId, stage: state.stage, status: state.status, state }
  }
}
