import type { AgentWorkerAdapter, AgentWorkerRole } from './AgentWorkerAdapter.js'

export class WorkerRegistry {
  private readonly workers = new Map<AgentWorkerRole, AgentWorkerAdapter[]>()

  register(worker: AgentWorkerAdapter): void {
    const existing = this.workers.get(worker.role) ?? []
    this.workers.set(worker.role, [...existing, worker])
  }

  getByRole(role: AgentWorkerRole): AgentWorkerAdapter[] {
    return this.workers.get(role) ?? []
  }

  getRequiredOne(role: AgentWorkerRole): AgentWorkerAdapter {
    const worker = this.getByRole(role)[0]
    if (!worker) {
      throw new Error(`Required worker missing for role: ${role}`)
    }
    return worker
  }

  getReviewers(): {
    architecture: AgentWorkerAdapter
    execution: AgentWorkerAdapter
    risk: AgentWorkerAdapter
  } {
    return {
      architecture: this.getRequiredOne('architecture-reviewer'),
      execution: this.getRequiredOne('execution-reviewer'),
      risk: this.getRequiredOne('risk-reviewer'),
    }
  }
}
