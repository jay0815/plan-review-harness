import path from 'node:path'

export class ArtifactPathBuilder {
  constructor(private readonly runRoot = 'runs') {}

  getRunRoot(): string {
    return this.runRoot
  }

  getRunDir(runId: string): string {
    return path.join(this.runRoot, runId)
  }

  getStatePath(runId: string): string {
    return path.join(this.getRunDir(runId), 'state.json')
  }

  getRoundDir(runId: string, round: number): string {
    return path.join(this.getRunDir(runId), `round-${String(round).padStart(3, '0')}`)
  }

  getArtifactPath(runId: string, round: number, artifactId: string): string {
    return path.join(this.getRoundDir(runId, round), 'artifacts', `${artifactId}.json`)
  }

  getWorkerDir(runId: string, round: number, role: string): string {
    return path.join(this.getRoundDir(runId, round), 'workers', role)
  }

  getWorkerInputDir(runId: string, round: number, role: string): string {
    return path.join(this.getWorkerDir(runId, round, role), 'input')
  }

  getWorkerOutputDir(runId: string, round: number, role: string): string {
    return path.join(this.getWorkerDir(runId, round, role), 'output')
  }

  getWorkerLogDir(runId: string, round: number, role: string): string {
    return path.join(this.getWorkerDir(runId, round, role), 'logs')
  }

  getInputDir(runId: string): string {
    return path.join(this.getRunDir(runId), 'input')
  }

  getRequirementPath(runId: string): string {
    return path.join(this.getInputDir(runId), 'requirement.md')
  }

  getInitialPlanPath(runId: string): string {
    return path.join(this.getInputDir(runId), 'initial-plan.md')
  }

  getDecisionQueuePath(runId: string, round: number): string {
    return path.join(this.getRoundDir(runId, round), 'decisions', 'decision-queue.json')
  }

  getIssueLedgerPath(runId: string, round: number): string {
    return path.join(this.getRoundDir(runId, round), 'ledgers', 'issue-ledger.json')
  }

  getDisagreementLedgerPath(runId: string, round: number): string {
    return path.join(this.getRoundDir(runId, round), 'ledgers', 'disagreement-ledger.json')
  }

  getUserDecisionsPath(runId: string, round: number): string {
    return path.join(this.getRoundDir(runId, round), 'decisions', 'user-decisions.json')
  }

  getRevisionPlanPath(runId: string, round: number): string {
    return path.join(this.getRoundDir(runId, round), 'revision', 'revised-plan.md')
  }

  getRevisionLogPath(runId: string, round: number): string {
    return path.join(this.getRoundDir(runId, round), 'revision', 'revision-log.json')
  }

  getRegressionReportPath(runId: string, round: number): string {
    return path.join(this.getRoundDir(runId, round), 'regression', 'regression-report.json')
  }

  getConvergenceReportPath(runId: string, round: number): string {
    return path.join(this.getRoundDir(runId, round), 'convergence', 'convergence-report.json')
  }

  getFinalPlanPath(runId: string): string {
    return path.join(this.getRunDir(runId), 'final', 'final-plan.md')
  }

  getFinalReportPath(runId: string): string {
    return path.join(this.getRunDir(runId), 'final', 'final-report.json')
  }
}
