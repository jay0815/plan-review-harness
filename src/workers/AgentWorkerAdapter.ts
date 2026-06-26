export type AgentWorkerKind = 'mock' | 'manual' | 'shell' | 'pi' | 'codex' | 'claude-code' | 'harness-kit'

export type AgentWorkerRole =
  | 'planner'
  | 'architecture-reviewer'
  | 'execution-reviewer'
  | 'risk-reviewer'
  | 'synthesizer'
  | 'reviser'
  | 'regression'

export type WorkerTaskType =
  | 'generate_plan'
  | 'review_plan'
  | 'synthesize_issues'
  | 'auto_resolve'
  | 'revise_plan'
  | 'regression_review'

export interface AgentWorkerContext {
  runId: string
  round: number
  nodeName: string
  role: AgentWorkerRole
  runDir: string
  workerDir: string
  inputDir: string
  outputDir: string
  logDir: string
  timeoutMs?: number
}

export interface AgentWorkerTask<I = unknown> {
  taskId: string
  type: WorkerTaskType
  input: I
  context?: Record<string, unknown>
}

export interface AgentWorkerAdapter<I = unknown, O = unknown> {
  kind: AgentWorkerKind
  role: AgentWorkerRole
  execute(task: AgentWorkerTask<I>, context: AgentWorkerContext): Promise<O>
}
