import { copyFile, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { ArtifactPathBuilder } from '../artifacts/paths.js'
import { DecisionQueueSchema, UserDecisionsSchema, type DecisionQueue } from '../schemas/decision.js'
import { ConvergenceReportSchema, RegressionReportSchema, type ConvergenceReport } from '../schemas/regression.js'
import { RevisionResultSchema, type ReviewResult } from '../schemas/worker.js'
import { type PlanReviewState } from '../schemas/state.js'
import { DisagreementLedgerSchema, IssueLedgerSchema } from '../schemas/ledger.js'
import { FileStateStore } from '../state/FileStateStore.js'
import { atomicWriteJson, atomicWriteText, ensureDir } from '../utils/fs.js'
import { WorkerRegistry } from '../workers/WorkerRegistry.js'
import type { AgentWorkerAdapter } from '../workers/AgentWorkerAdapter.js'
import { blindReview } from './nodes/blindReview.js'

const createdAt = '2026-01-01T00:00:00.000Z'

export interface HarnessConfig {
  runDir: string
  maxRounds: number
  workers: AgentWorkerAdapter[]
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

export class LangGraphWorkflowRuntime {
  private readonly paths: ArtifactPathBuilder
  private readonly states: FileStateStore
  private readonly workers: WorkerRegistry

  constructor(private readonly config: HarnessConfig) {
    this.paths = new ArtifactPathBuilder(config.runDir)
    this.states = new FileStateStore(this.paths)
    this.workers = new WorkerRegistry()
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
      createdAt,
      updatedAt: createdAt,
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

    const reviewPatch = await blindReview({ paths: this.paths, workers: this.workers }, state)
    state = this.merge(state, reviewPatch)
    state = await this.synthesizeAndMaybePause(state)
    await this.states.save(state)
    return this.handle(state)
  }

  async resume(runId: string, input: ResumePlanReviewInput): Promise<WorkflowRunHandle> {
    let state = await this.states.load(runId)
    if (state.status !== 'waiting_for_decision' || !state.artifacts.decisionQueue) {
      throw new Error(`runId=${runId}: run is not waiting for decisions`)
    }
    const queue = DecisionQueueSchema.parse(JSON.parse(await readFile(state.artifacts.decisionQueue.path, 'utf8')))
    const userDecisions = UserDecisionsSchema.parse(JSON.parse(await readFile(input.decisionsPath, 'utf8')))
    const itemIds = new Set(queue.items.map((item) => item.id))
    for (const decision of userDecisions.decisions) {
      if (!itemIds.has(decision.itemId)) throw new Error(`Decision item not found: ${decision.itemId}`)
    }

    const userDecisionPath = this.paths.getUserDecisionsPath(runId, state.round)
    await atomicWriteJson(userDecisionPath, {
      runId,
      round: state.round,
      decisions: userDecisions.decisions,
      createdAt,
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

    state = await this.runRevisionRegressionFinal(state)
    await this.states.save(state)
    return this.handle(state)
  }

  private async synthesizeAndMaybePause(state: PlanReviewState): Promise<PlanReviewState> {
    const reviews = await Promise.all(
      Object.values(state.artifacts.reviews).map(async (ref) => {
        const value = JSON.parse(await readFile(ref.path, 'utf8')) as { result?: unknown }
        return (value.result ?? value) as ReviewResult
      }),
    )
    const issues = reviews.flatMap((review) => review.issues)
    const mergedIssues = issues.map((issue) => ({
      ...issue,
      id: `MERGED-${issue.id}`,
      supportedBy: [issue.sourceWorkerId ?? 'unknown'],
      status: 'single_point' as const,
      relatedIssueIds: [issue.id],
    }))
    const issueLedgerPath = this.paths.getIssueLedgerPath(state.runId, state.round)
    await atomicWriteJson(
      issueLedgerPath,
      IssueLedgerSchema.parse({
        runId: state.runId,
        round: state.round,
        issues: mergedIssues,
        createdAt,
      }),
    )

    const l3Issues = issues.filter((issue) => issue.severity === 'blocker')
    const disagreements = l3Issues.map((issue) => ({
      id: `disagreement-${issue.id}`,
      issueId: `MERGED-${issue.id}`,
      title: issue.title,
      level: 'L3' as const,
      positions: [
        {
          workerId: issue.sourceWorkerId ?? 'unknown',
          claim: issue.claim,
          confidence: issue.confidence,
          reasoning: issue.suggestion,
        },
      ],
      humanDecisionRequired: true,
      createdAt,
    }))
    const disagreementLedgerPath = this.paths.getDisagreementLedgerPath(state.runId, state.round)
    await atomicWriteJson(
      disagreementLedgerPath,
      DisagreementLedgerSchema.parse({
        runId: state.runId,
        round: state.round,
        disagreements,
        createdAt,
      }),
    )
    const queue: DecisionQueue = {
      runId: state.runId,
      round: state.round,
      items: l3Issues.map((issue) => ({
        id: `decision-${issue.id}`,
        disagreementId: `disagreement-${issue.id}`,
        title: issue.title,
        description: issue.claim,
        options: [
          { key: 'adopt', label: 'Adopt', description: 'Adopt the issue suggestion.' },
          { key: 'reject', label: 'Reject', description: 'Reject the issue suggestion.' },
        ],
        context: {
          positions: [
            {
              workerId: issue.sourceWorkerId ?? 'unknown',
              claim: issue.claim,
              confidence: issue.confidence,
              reasoning: issue.suggestion,
            },
          ],
          relatedIssues: [`MERGED-${issue.id}`],
          impactSummary: issue.impact,
        },
        createdAt,
      })),
      createdAt,
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
      severity: issue.severity,
      status: issue.status,
      ledgerPath: issueLedgerPath,
      round: state.round,
    }))
    if (l3Issues.length === 0) {
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
        this.workerContext(state, 'reviser', 'revision'),
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
          this.workerContext(state, 'regression', 'regression'),
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
      createdAt,
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
        createdAt,
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
        createdAt,
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
      createdAt,
    }
  }

  private workerContext(state: PlanReviewState, role: 'reviser' | 'regression', nodeName: string) {
    return {
      runId: state.runId,
      round: state.round,
      nodeName,
      role,
      runDir: this.paths.getRunDir(state.runId),
      workerDir: this.paths.getWorkerDir(state.runId, state.round, role),
      inputDir: this.paths.getWorkerInputDir(state.runId, state.round, role),
      outputDir: this.paths.getWorkerOutputDir(state.runId, state.round, role),
      logDir: this.paths.getWorkerLogDir(state.runId, state.round, role),
    }
  }

  private merge(
    state: PlanReviewState,
    patch: Omit<Partial<PlanReviewState>, 'artifacts'> & { artifacts?: Partial<PlanReviewState['artifacts']> },
  ): PlanReviewState {
    return {
      ...state,
      ...patch,
      updatedAt: createdAt,
      artifacts: { ...state.artifacts, ...patch.artifacts },
    }
  }

  private handle(state: PlanReviewState): WorkflowRunHandle {
    return { runId: state.runId, stage: state.stage, status: state.status, state }
  }
}
