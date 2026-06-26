import { describe, expect, it } from 'vitest'
import type { AgentWorkerAdapter, AgentWorkerContext, AgentWorkerTask } from '../../src/workers/AgentWorkerAdapter.js'
import { WorkerRegistry } from '../../src/workers/WorkerRegistry.js'

function fakeWorker(role: AgentWorkerAdapter['role']): AgentWorkerAdapter {
  return {
    kind: 'mock',
    role,
    async execute(_task: AgentWorkerTask, _context: AgentWorkerContext): Promise<unknown> {
      return { role }
    },
  }
}

describe('WorkerRegistry', () => {
  it('throws when planner is missing', () => {
    const registry = new WorkerRegistry()

    expect(() => registry.getRequiredOne('planner')).toThrow(/planner/)
  })

  it('throws when any required blind reviewer is missing', () => {
    const registry = new WorkerRegistry()
    registry.register(fakeWorker('architecture-reviewer'))
    registry.register(fakeWorker('execution-reviewer'))

    expect(() => registry.getReviewers()).toThrow(/risk-reviewer/)
  })

  it('returns workers by role and required single worker', () => {
    const registry = new WorkerRegistry()
    const planner = fakeWorker('planner')
    const reviser = fakeWorker('reviser')

    registry.register(planner)
    registry.register(reviser)

    expect(registry.getByRole('planner')).toEqual([planner])
    expect(registry.getRequiredOne('reviser')).toBe(reviser)
  })

  it('returns all three blind reviewers by dimension role', () => {
    const registry = new WorkerRegistry()
    const architecture = fakeWorker('architecture-reviewer')
    const execution = fakeWorker('execution-reviewer')
    const risk = fakeWorker('risk-reviewer')

    registry.register(architecture)
    registry.register(execution)
    registry.register(risk)

    expect(registry.getReviewers()).toEqual({ architecture, execution, risk })
  })

  it('does not depend on a concrete worker implementation class', async () => {
    const registry = new WorkerRegistry()
    const customWorker: AgentWorkerAdapter = {
      kind: 'shell',
      role: 'planner',
      async execute(_task, _context) {
        return { planMarkdown: '# Custom' }
      },
    }

    registry.register(customWorker)

    expect(registry.getRequiredOne('planner')).toBe(customWorker)
  })
})
