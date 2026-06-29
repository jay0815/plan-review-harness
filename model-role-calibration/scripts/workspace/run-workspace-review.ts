#!/usr/bin/env node

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { ROOT, isMainScript, parseArgs, requireArg, parseJsonFile, writeGenerated, slug } from '../lib/lib.js'
import { parseAssistantOutput, runCommand } from '../cli/run-model.js'
import { validateJsonText } from '../mcp/json-validator-mcp.js'
import { lintPlan } from './plan-authoring-lint.js'
import {
  REVIEW_ROLES,
  FACT_CHECK_ROLE,
  JSON_VALIDATOR_TOOL,
  MAX_EXECUTOR_RETRIES,
  loadWorkspaceReviewFromArgs,
  validateProjectRoot,
  buildRoleReadScope,
  buildFactCheckReadScope,
  copyScopedWorkspace,
  compactPlanForReview,
  createPlanReferenceManifest,
  buildWorkspacePrompt,
  workspaceSchemaForRole,
  buildClaudeWorkspaceArgs,
  appendExecutionLog,
  updateState,
  withoutAnthropicApiKey,
} from '../lib/workspace-review-lib.js'
import {
  requireRunManifest,
  updateRunManifest,
  markManifestRunning,
  markManifestFinished,
  recordResolvedExecution,
  archiveResolvedExecutionAttempt,
} from '../lib/workspace-review-manifest.js'

type JsonRecord = Record<string, unknown>

interface ReviewerIssue extends JsonRecord {
  title?: string
  severity?: string
  type?: string
  blocks_execution?: boolean
  source_finding_ids?: string[]
}

interface ReviewerOutput extends JsonRecord {
  issues?: ReviewerIssue[]
}

interface RoleResult extends JsonRecord {
  role?: string
  model?: string
  output?: JsonRecord
  output_file?: string
  summary?: JsonRecord
  summary_file?: string
}

interface InfraError extends JsonRecord {
  role?: string
  model?: string
  type?: string
  message?: string
}

interface WorkspaceRequest extends JsonRecord {
  run_id: string
  project_root: string
  plan: string
  review_plan?: string
  context?: string
  roles?: string[]
  plan_compaction?: JsonRecord
  proposed_artifacts?: ProposedArtifact[]
  review_plan_refs?: JsonRecord | null
  authoring_lint?: LintPlanLike
}

interface WorkspaceConfig extends JsonRecord {
  claude_bin: string
  models: Record<string, { settings_file: string }>
  roles: Record<string, string>
  execution: {
    max_concurrency: number
    timeout_ms: number
    max_buffer_bytes: number
    compact_plan: boolean
    isolate_reviewers: boolean
    read_scope_max_files: number
  }
}

interface ProposedArtifact extends JsonRecord {
  block_index?: number | null
  language?: string
  relative_path: string
  source_file?: string | null
  line_count?: number | null
  char_count?: number | null
  content?: string | null
  origin?: string
  review_semantics?: string
  expected_completeness?: string
}

interface ReadBoundary extends JsonRecord {
  mode: string
  source_root?: string
  exposed_root: string
  files: string[]
  proposed_artifacts?: ProposedArtifact[]
  blocked_refs: string[]
  skipped_refs: string[]
}

interface PreparedReadBoundary {
  promptRoot: string
  claudeRoot: string
  boundary: ReadBoundary
  cleanup: () => void
}

type WorkspaceReadScope = Parameters<typeof copyScopedWorkspace>[1]

interface RunCommandResult {
  stdout: string
  stderr: string
  status: number | null
  signal: NodeJS.Signals | null
  error: NodeJS.ErrnoException | null
}

interface ParsedAssistantOutput {
  output: JsonRecord
}

interface RetryState extends JsonRecord {
  status?: string
  retry_counts?: Record<string, unknown>
}

interface ReviewerStageFailure extends Error {
  infraErrors: InfraError[]
  completedReviewerRoles: string[]
  failedReviewerRoles: string[]
}

interface LintPlanLike extends JsonRecord {
  errors: unknown[]
  warnings: unknown[]
  complexity: {
    level?: unknown
  }
  metrics: {
    total_lines?: unknown
  }
}

interface RetryResult extends JsonRecord {
  retry_counts: Record<string, number>
}

interface SettledResult<T> {
  ok: boolean
  result?: T
  error?: unknown
  role?: string
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorStackOrMessage(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error)
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeMirroredTitle(value: unknown): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/["“”„‟＂'‘’‚‛＇]/g, '')
}

function hasSubstantiveRequiredPlanChange(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!text) {
    return false
  }
  return !/^(?:无|无需|不需要|无需(?:新增)?(?:修订|修改计划|补充计划)?|none|n\/a|not applicable)[。.!！\s]*$/i.test(
    text,
  )
}

function asReviewerOutput(value: unknown): ReviewerOutput {
  return isRecord(value) ? (value as ReviewerOutput) : {}
}

function asRunCommandResult(value: unknown): RunCommandResult {
  return value as RunCommandResult
}

function asParsedAssistantOutput(value: unknown): ParsedAssistantOutput {
  return value as ParsedAssistantOutput
}

function reviewerOutputEntries(reviewerResults: RoleResult[]): Array<[string, ReviewerOutput]> {
  return reviewerResults
    .filter((item) => typeof item.role === 'string' && item.role.length > 0)
    .map((item): [string, ReviewerOutput] => [SOURCE_NAME_BY_ROLE[item.role as string], asReviewerOutput(item.output)])
    .filter(([source]) => typeof source === 'string' && source.length > 0)
}

const SOURCE_NAME_BY_ROLE: Record<string, string> = {
  risk: 'Risk Reviewer',
  architecture: 'Architecture Reviewer',
  execution: 'Execution Reviewer',
  rebuttal: 'Rebuttal Reviewer',
}

const SEVERITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocker: 4,
}

const EXECUTION_BOUNDARIES_BY_ISSUE_TYPE: Record<string, string[]> = {
  step: ['main_path', 'step_order', 'rollback_or_recovery'],
  dependency: ['dependencies', 'compatibility_or_release'],
  input: ['inputs', 'implementation_discretion'],
  output: ['outputs'],
  acceptance: ['acceptance'],
  test: ['tests', 'acceptance'],
  ambiguity: ['inputs', 'outputs', 'failure_semantics'],
  plan_bloat: ['plan_bloat'],
  preference: ['implementation_discretion'],
}

const EXECUTION_REQUIRED_BOUNDARIES = Object.freeze([
  'main_path',
  'step_order',
  'dependencies',
  'inputs',
  'outputs',
  'acceptance',
  'tests',
  'failure_semantics',
  'rollback_or_recovery',
  'compatibility_or_release',
  'implementation_discretion',
  'plan_bloat',
])

function writeJson(file: string, value: unknown): void {
  writeGenerated(file, JSON.stringify(value, null, 2) + '\n')
}

function writeRoleMetadata(runDir: string, roleDir: string, metadata: JsonRecord): void {
  const metadataFile = path.join(roleDir, 'metadata.json')
  writeJson(metadataFile, metadata)
  recordResolvedExecution(runDir, metadata, {
    status: String(metadata.status || ''),
    metadata_file: path.relative(runDir, metadataFile),
  })
}

function reviewerSeverityByIssueId(reviewerOutputs: Record<string, ReviewerOutput> = {}): Map<string, string> {
  const severities = new Map<string, string>()
  for (const [source, reviewerOutput] of Object.entries(reviewerOutputs || {})) {
    const issues = Array.isArray(reviewerOutput?.issues) ? reviewerOutput.issues : []
    issues.forEach((issue, index) => {
      const issueId = `${slug(source)}-${String(index + 1).padStart(3, '0')}`
      if (typeof issue?.severity === 'string') {
        severities.set(issueId, issue.severity)
      }
    })
  }
  return severities
}

function validateSynthesisSemantics(
  output: JsonRecord,
  factCheckOutput: JsonRecord | null | undefined,
  reviewerOutputs: Record<string, ReviewerOutput> = {},
): void {
  const findings = recordArray(output.source_findings)
  const byId = new Map<string, JsonRecord>()
  const byIssueId = new Map<string, JsonRecord>()
  for (const finding of findings) {
    const findingId = String(finding.id || '')
    if (byId.has(findingId)) {
      throw new Error(`Synthesis semantic validation failed: duplicate source finding id ${finding.id}`)
    }
    byId.set(findingId, finding)
    const sourceIssueId = typeof finding.source_issue_id === 'string' ? finding.source_issue_id : ''
    if (sourceIssueId) {
      if (byIssueId.has(sourceIssueId)) {
        const previous = byIssueId.get(sourceIssueId)
        throw new Error(
          `Synthesis semantic validation failed: duplicate source_issue_id ${sourceIssueId} on findings ${previous?.id} and ${finding.id}`,
        )
      }
      byIssueId.set(sourceIssueId, finding)
    }
  }

  const checkedIssues = recordArray(factCheckOutput?.checked_issues)
  const checkedIds = new Set<string>()
  for (const checked of checkedIssues) {
    const issueId = String(checked.issue_id || '')
    if (checkedIds.has(issueId)) {
      throw new Error(`Synthesis semantic validation failed: duplicate fact_check issue_id ${checked.issue_id}`)
    }
    checkedIds.add(issueId)
    const finding = byIssueId.get(issueId)
    if (!finding) {
      throw new Error(`Synthesis semantic validation failed: missing source finding for issue_id ${checked.issue_id}`)
    }
    if (finding.source !== checked.source) {
      throw new Error(
        `Synthesis semantic validation failed: ${finding.id} source ${finding.source} != ${checked.source} for issue_id ${checked.issue_id}`,
      )
    }
    if (normalizeMirroredTitle(finding.source_title) !== normalizeMirroredTitle(checked.issue_title)) {
      throw new Error(
        `Synthesis semantic validation failed: ${finding.id} source_title ${finding.source_title} != ${checked.issue_title} for issue_id ${checked.issue_id}`,
      )
    }
    if (finding.fact_check_status !== checked.status) {
      throw new Error(
        `Synthesis semantic validation failed: ${finding.id} fact_check_status ` +
          `${finding.fact_check_status} != ${checked.status}`,
      )
    }
    if (finding.scope_status !== checked.scope_status) {
      throw new Error(
        `Synthesis semantic validation failed: ${finding.id} scope_status ` +
          `${finding.scope_status} != ${checked.scope_status}`,
      )
    }
    const requiredDisposition =
      checked.scope_status === 'out_of_scope'
        ? 'out_of_scope'
        : ['unsupported', 'contradicted', 'unverifiable'].includes(String(checked.status))
          ? String(checked.status)
          : null
    if (requiredDisposition && finding.disposition !== requiredDisposition) {
      throw new Error(`Synthesis semantic validation failed: ${finding.id} must use disposition ${requiredDisposition}`)
    }
    if (
      !requiredDisposition &&
      ['verified', 'partially_verified'].includes(String(checked.status)) &&
      !['retained', 'merged', 'duplicate'].includes(String(finding.disposition))
    ) {
      throw new Error(
        `Synthesis semantic validation failed: ${finding.id} verified finding cannot use disposition ${finding.disposition}`,
      )
    }
  }

  for (const finding of findings) {
    const sourceIssueId = typeof finding.source_issue_id === 'string' ? finding.source_issue_id : ''
    if (sourceIssueId && !checkedIds.has(sourceIssueId)) {
      throw new Error(
        `Synthesis semantic validation failed: source finding ${finding.id} has no matching fact_check entry for issue_id ${finding.source_issue_id}`,
      )
    }
  }

  const referencedIds = (items: unknown, field: string = 'source_finding_ids') =>
    recordArray(items).flatMap((item) => stringArray(item[field]))
  const activeIds = [
    ...referencedIds(output.consensus_issues),
    ...referencedIds(output.disagreements),
    ...referencedIds(output.revision_instructions),
  ]
  const excludedDispositions = new Set(['duplicate', 'unsupported', 'contradicted', 'unverifiable', 'out_of_scope'])
  for (const id of [...activeIds, ...referencedIds(output.likely_false_positives)]) {
    if (!byId.has(id)) {
      throw new Error(`Synthesis semantic validation failed: unknown source finding id ${id}`)
    }
  }
  for (const id of activeIds) {
    const finding = byId.get(id)
    if (finding && excludedDispositions.has(String(finding.disposition))) {
      throw new Error(`Synthesis semantic validation failed: excluded finding ${id} re-entered active conclusions`)
    }
  }
  for (const id of referencedIds(output.likely_false_positives)) {
    const finding = byId.get(id)
    if (finding && !excludedDispositions.has(String(finding.disposition))) {
      throw new Error(
        `Synthesis semantic validation failed: likely_false_positives cannot reference retained finding ${id}`,
      )
    }
  }

  const processMap = isRecord(output.process_map) ? output.process_map : {}
  const processNodes = recordArray(processMap.nodes)
  const nodeIds = new Set<string>()
  for (const node of processNodes) {
    const nodeId = String(node.id || '')
    if (nodeIds.has(nodeId)) {
      throw new Error(`Synthesis semantic validation failed: duplicate process_map node id ${node.id}`)
    }
    nodeIds.add(nodeId)
  }
  if (!/^flowchart\s+(TD|LR)\b/.test(String(processMap.mermaid || '').trim())) {
    throw new Error(
      'Synthesis semantic validation failed: process_map.mermaid must start with flowchart TD or flowchart LR',
    )
  }
  const issueTitles = new Set<string>([
    ...recordArray(output.consensus_issues).map((item) => String(item.title || '')),
    ...recordArray(output.disagreements).map((item) => String(item.title || '')),
  ])
  for (const node of processNodes) {
    for (const title of stringArray(node.related_issue_titles)) {
      if (!issueTitles.has(title)) {
        throw new Error(
          `Synthesis semantic validation failed: process_map node ${node.id} references unknown issue title ${title}`,
        )
      }
    }
  }
  for (const item of [...recordArray(output.consensus_issues), ...recordArray(output.disagreements)]) {
    for (const nodeId of stringArray(item.affected_nodes)) {
      if (!nodeIds.has(nodeId)) {
        throw new Error(
          `Synthesis semantic validation failed: ${item.title} references unknown process_map node ${nodeId}`,
        )
      }
    }
  }

  for (const item of recordArray(output.consensus_issues)) {
    if (!hasSubstantiveRequiredPlanChange(item.required_plan_change)) {
      throw new Error(
        `Synthesis semantic validation failed: ${item.title} consensus issue must include substantive required_plan_change`,
      )
    }
    const sources = new Set<string>(
      stringArray(item.source_finding_ids)
        .map((id) => byId.get(id)?.source)
        .filter((source): source is string => typeof source === 'string' && source.length > 0),
    )
    const mergedFrom = new Set<string>(stringArray(item.merged_from))
    for (const source of sources) {
      if (!mergedFrom.has(source)) {
        throw new Error(`Synthesis semantic validation failed: ${item.title} merged_from missing source ${source}`)
      }
    }
    for (const source of mergedFrom) {
      if (!sources.has(source)) {
        throw new Error(
          `Synthesis semantic validation failed: ${item.title} merged_from includes source without finding ${source}`,
        )
      }
    }
  }

  const reviewerSeverities = reviewerSeverityByIssueId(reviewerOutputs)
  for (const instruction of recordArray(output.revision_instructions)) {
    for (const id of stringArray(instruction.source_finding_ids)) {
      const finding = byId.get(id)
      if (!finding || !['verified', 'partially_verified'].includes(String(finding.fact_check_status))) {
        throw new Error(
          `Synthesis semantic validation failed: revision instruction references non-verified finding ${id}`,
        )
      }
      if (finding.fact_check_status !== 'partially_verified') {
        continue
      }
      const reviewerSeverity =
        typeof finding.source_issue_id === 'string' ? reviewerSeverities.get(finding.source_issue_id) : null
      if (!reviewerSeverity) {
        continue
      }
      const reviewerRank = SEVERITY_RANK[reviewerSeverity] || 0
      const linkedConsensus = recordArray(output.consensus_issues).filter((item) =>
        stringArray(item.source_finding_ids).includes(id),
      )
      for (const consensus of linkedConsensus) {
        const consensusRank = SEVERITY_RANK[String(consensus.severity || '')] || 0
        if (consensusRank > reviewerRank) {
          throw new Error(
            `Synthesis semantic validation failed: partially_verified finding ${id} severity ${consensus.severity} exceeds reviewer severity ${reviewerSeverity}`,
          )
        }
      }
    }
  }
  for (const disagreement of recordArray(output.disagreements)) {
    const shouldNeedHuman = disagreement.level === 'L3_direction_decision'
    if (disagreement.needs_human_decision !== shouldNeedHuman) {
      throw new Error(
        `Synthesis semantic validation failed: ${disagreement.title} needs_human_decision ` +
          `must be ${shouldNeedHuman} for ${disagreement.level}`,
      )
    }
  }
}

function validateExecutionSemantics(output: JsonRecord): void {
  const coverageDeclaration = isRecord(output.coverage_declaration) ? output.coverage_declaration : {}
  const reviewed = recordArray(coverageDeclaration.reviewed_boundaries)
  const coveredBoundaries = new Set<string>()
  const declaredBoundaries = new Set<string>()
  for (const item of reviewed) {
    const boundary = String(item.boundary || '')
    if (declaredBoundaries.has(boundary)) {
      throw new Error(`Execution semantic validation failed: duplicate coverage boundary ${item.boundary}`)
    }
    declaredBoundaries.add(boundary)
    if (['covered', 'partially_covered'].includes(String(item.status))) {
      coveredBoundaries.add(boundary)
    }
  }
  for (const boundary of EXECUTION_REQUIRED_BOUNDARIES) {
    if (!declaredBoundaries.has(boundary)) {
      throw new Error(`Execution semantic validation failed: coverage_declaration missing boundary ${boundary}`)
    }
  }
  for (const issue of recordArray(output.issues)) {
    if (issue.type === 'preference' && issue.blocks_execution) {
      throw new Error(`Execution semantic validation failed: preference issue "${issue.title}" cannot block execution`)
    }
    const expected = EXECUTION_BOUNDARIES_BY_ISSUE_TYPE[String(issue.type || '')] || []
    if (!expected.some((boundary) => coveredBoundaries.has(boundary))) {
      throw new Error(
        `Execution semantic validation failed: issue "${issue.title}" type ${issue.type} ` +
          `is not covered by coverage_declaration`,
      )
    }
  }
}

function validateWorkspaceOutput(
  role: string,
  output: JsonRecord,
  context: { factCheckOutput?: JsonRecord; reviewerOutputs?: Record<string, ReviewerOutput> } = {},
): void {
  const validation = validateJsonText(JSON.stringify(output), parseJsonFile<unknown>(workspaceSchemaForRole(role)))
  if (!validation.valid) {
    const details = (validation.errors || [])
      .slice(0, 5)
      .map((item) => `${item.path}: ${item.message}`)
      .join('; ')
    throw new Error(`Schema validation failed for ${role}: ${details || validation.stage}`)
  }
  if (role === 'execution') {
    validateExecutionSemantics(output)
  }
  if (role === 'synthesis') {
    validateSynthesisSemantics(output, context.factCheckOutput, context.reviewerOutputs)
  }
}

function materializeProposedArtifacts(runDir: string, artifacts: ProposedArtifact[] = []): ProposedArtifact[] {
  return artifacts.map((artifact) => {
    const relativePath = artifact.relative_path
    if (
      typeof relativePath !== 'string' ||
      !relativePath.startsWith('proposed-code/') ||
      relativePath.includes('\0') ||
      relativePath.split('/').includes('..')
    ) {
      throw new Error(`Invalid proposed artifact path: ${relativePath}`)
    }
    const sourceFile = path.join(runDir, relativePath)
    writeGenerated(sourceFile, artifact.content || '')
    return {
      block_index: artifact.block_index,
      language: artifact.language,
      relative_path: relativePath,
      source_file: sourceFile,
      line_count: artifact.line_count,
      char_count: artifact.char_count,
    }
  })
}

function countBy(items: JsonRecord[], key: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items || []) {
    const value = String(item?.[key] || 'unknown')
    counts[value] = (counts[value] || 0) + 1
  }
  return counts
}

function summarizeFactCheckOutput(output: JsonRecord): JsonRecord {
  const checkedIssues = recordArray(output.checked_issues)
  const statusCounts = countBy(checkedIssues, 'status')
  const scopeStatusCounts = countBy(checkedIssues, 'scope_status')
  const evidenceStatusCounts = countBy(checkedIssues, 'evidence_status')
  const claimSupportCounts = countBy(checkedIssues, 'claim_support')
  const total = checkedIssues.length
  const challenged = ['partially_verified', 'unsupported', 'contradicted', 'unverifiable'].reduce(
    (sum, key) => sum + (statusCounts[key] || 0),
    0,
  )
  const verified = statusCounts.verified || 0
  return {
    total_checked: total,
    status_counts: statusCounts,
    scope_status_counts: scopeStatusCounts,
    evidence_status_counts: evidenceStatusCounts,
    claim_support_counts: claimSupportCounts,
    verified_ratio: total ? Number((verified / total).toFixed(4)) : null,
    challenged_count: challenged,
    strictness_signal: total === 0 ? 'no_issues_checked' : challenged === 0 ? 'all_verified' : 'challenged_some_claims',
    limits_count: Array.isArray(output?.limits) ? output.limits.length : 0,
  }
}

function summarizeReviewOutcome(
  reviewerResults: RoleResult[],
  factCheck: RoleResult,
  synthesis: RoleResult,
  infraErrors: InfraError[],
  authoringLint: JsonRecord | null = null,
): JsonRecord {
  const reviewerIssueCount = reviewerResults.reduce(
    (sum, item) => sum + (Array.isArray(item.output?.issues) ? item.output.issues.length : 0),
    0,
  )
  const consensusCount = Array.isArray(synthesis.output?.consensus_issues)
    ? synthesis.output.consensus_issues.length
    : 0
  const disagreementCount = Array.isArray(synthesis.output?.disagreements) ? synthesis.output.disagreements.length : 0
  const revisionCount = Array.isArray(synthesis.output?.revision_instructions)
    ? synthesis.output.revision_instructions.length
    : 0
  const factChecked = factCheck.summary?.total_checked || 0
  const challenged = factCheck.summary?.challenged_count || 0
  const authoringErrorCount = Array.isArray(authoringLint?.errors) ? authoringLint.errors.length : 0
  const authoringWarningCount = Array.isArray(authoringLint?.warnings) ? authoringLint.warnings.length : 0
  if (authoringErrorCount > 0) {
    return {
      status: 'needs_revision',
      message: infraErrors.length
        ? 'Plan 结构检查存在错误，且审查存在基础设施错误；必须先修订计划，当前结果也不是全角色完整审查。'
        : 'Plan 结构检查存在错误；必须先修订计划再执行。',
      reviewer_issue_count: reviewerIssueCount,
      consensus_issue_count: consensusCount,
      disagreement_count: disagreementCount,
      revision_instruction_count: revisionCount,
      fact_checked_issue_count: factChecked,
      fact_check_challenged_count: challenged,
      authoring_lint_error_count: authoringErrorCount,
      authoring_lint_warning_count: authoringWarningCount,
      infra_error_count: infraErrors.length,
    }
  }
  if (infraErrors.length) {
    return {
      status: 'review_completed_with_infra_errors',
      message: '审查已完成，但存在 Reviewer/模型输出基础设施错误；不能视为全角色完整审查。',
      reviewer_issue_count: reviewerIssueCount,
      consensus_issue_count: consensusCount,
      disagreement_count: disagreementCount,
      revision_instruction_count: revisionCount,
      fact_checked_issue_count: factChecked,
      fact_check_challenged_count: challenged,
      authoring_lint_error_count: authoringErrorCount,
      authoring_lint_warning_count: authoringWarningCount,
      infra_error_count: infraErrors.length,
    }
  }
  if (consensusCount === 0 && disagreementCount === 0 && revisionCount === 0) {
    return {
      status: 'plan_ready',
      message: '未发现需要修订的共识问题、分歧或修订指令；当前计划可以进入执行或保持原计划。',
      reviewer_issue_count: reviewerIssueCount,
      consensus_issue_count: consensusCount,
      disagreement_count: disagreementCount,
      revision_instruction_count: revisionCount,
      fact_checked_issue_count: factChecked,
      fact_check_challenged_count: challenged,
      authoring_lint_error_count: authoringErrorCount,
      authoring_lint_warning_count: authoringWarningCount,
      infra_error_count: 0,
    }
  }
  return {
    status: 'needs_revision',
    message: '审查发现需要处理的问题、分歧或修订指令；应先修订计划再执行。',
    reviewer_issue_count: reviewerIssueCount,
    consensus_issue_count: consensusCount,
    disagreement_count: disagreementCount,
    revision_instruction_count: revisionCount,
    fact_checked_issue_count: factChecked,
    fact_check_challenged_count: challenged,
    authoring_lint_error_count: authoringErrorCount,
    authoring_lint_warning_count: authoringWarningCount,
    infra_error_count: 0,
  }
}

function readJsonIfExists<T = JsonRecord>(file: string): T | null {
  if (!fs.existsSync(file)) {
    return null
  }
  return parseJsonFile<T>(file)
}

function completedReviewerResult(runDir: string, role: string): RoleResult | null {
  const roleDir = path.join(runDir, 'roles', role)
  const outputFile = path.join(roleDir, 'output.json')
  const metadataFile = path.join(roleDir, 'metadata.json')
  if (!fs.existsSync(outputFile) || !fs.existsSync(metadataFile)) {
    return null
  }
  const metadata = parseJsonFile<JsonRecord>(metadataFile)
  if (metadata.status !== 'completed') {
    return null
  }
  return {
    role,
    model: String(metadata.model || ''),
    output: parseJsonFile<JsonRecord>(outputFile),
    output_file: path.relative(runDir, outputFile),
  }
}

function loadCompletedReviewerResults(runDir: string, roles: string[], retryStage: string = 'synthesis'): RoleResult[] {
  return roles.map((role) => {
    const result = completedReviewerResult(runDir, role)
    if (!result) {
      throw new Error(`Cannot retry ${retryStage}: reviewer ${role} is not completed`)
    }
    return result
  })
}

function loadCompletedFactCheckResult(runDir: string, retryStage: string = 'synthesis'): RoleResult {
  const roleDir = path.join(runDir, 'roles', FACT_CHECK_ROLE)
  const outputFile = path.join(roleDir, 'output.json')
  const summaryFile = path.join(roleDir, 'fact-check-summary.json')
  const metadataFile = path.join(roleDir, 'metadata.json')
  if (!fs.existsSync(outputFile)) {
    throw new Error(`Cannot retry ${retryStage}: missing fact_check output: ${outputFile}`)
  }
  if (!fs.existsSync(summaryFile)) {
    throw new Error(`Cannot retry ${retryStage}: missing fact_check summary: ${summaryFile}`)
  }
  if (!fs.existsSync(metadataFile)) {
    throw new Error(`Cannot retry ${retryStage}: missing fact_check metadata: ${metadataFile}`)
  }
  const metadata = parseJsonFile<JsonRecord>(metadataFile)
  if (metadata.status !== 'completed') {
    throw new Error(`Cannot retry ${retryStage}: fact_check status is ${metadata.status || 'unknown'}`)
  }
  return {
    role: FACT_CHECK_ROLE,
    model: String(metadata.model || ''),
    output: parseJsonFile<JsonRecord>(outputFile),
    output_file: path.relative(runDir, outputFile),
    summary: parseJsonFile<JsonRecord>(summaryFile),
    summary_file: path.relative(runDir, summaryFile),
  }
}

function loadRequestForRun(_config: WorkspaceConfig, runDir: string): { request: WorkspaceRequest; roles: string[] } {
  const requestFile = path.join(runDir, 'request.json')
  if (!fs.existsSync(requestFile)) {
    throw new Error(`Missing workspace review request: ${requestFile}`)
  }
  const request = parseJsonFile<WorkspaceRequest>(requestFile)
  request.project_root = validateProjectRoot(request.project_root)
  request.review_plan = fs.existsSync(path.join(runDir, 'review-plan.md'))
    ? fs.readFileSync(path.join(runDir, 'review-plan.md'), 'utf8')
    : request.plan
  request.plan_compaction = readJsonIfExists(path.join(runDir, 'plan-compaction.json')) || undefined
  const proposedManifest = readJsonIfExists<{ artifacts?: ProposedArtifact[] }>(
    path.join(runDir, 'proposed-code-manifest.json'),
  )
  request.proposed_artifacts = Array.isArray(proposedManifest?.artifacts) ? proposedManifest.artifacts : []
  request.review_plan_refs = readJsonIfExists(path.join(runDir, 'review-plan-refs.json')) || undefined
  request.authoring_lint = readJsonIfExists<LintPlanLike>(path.join(runDir, 'plan-authoring-lint.json')) || undefined
  if (!request.authoring_lint) {
    request.authoring_lint = lintPlan({
      plan: request.plan,
      projectRoot: request.project_root,
    }) as unknown as LintPlanLike
    writeJson(path.join(runDir, 'plan-authoring-lint.json'), request.authoring_lint)
  }
  const roles: string[] = Array.isArray(request.roles) && request.roles.length ? request.roles : [...REVIEW_ROLES]
  for (const role of roles) {
    if (!(REVIEW_ROLES as readonly string[]).includes(role)) {
      throw new Error(`Invalid workspace review role: ${role}`)
    }
  }
  if (!request.plan_compaction) {
    request.plan_compaction = {
      original_chars: String(request.plan || '').length,
      compacted_chars: String(request.review_plan || request.plan || '').length,
      saved_chars: String(request.plan || '').length - String(request.review_plan || request.plan || '').length,
      code_blocks: 0,
      compacted_blocks: 0,
      preserved_blocks: 0,
      proposed_artifact_count: request.proposed_artifacts.length,
      proposed_artifact_chars: 0,
    }
  }
  return { request, roles }
}

function writeWorkspaceReport(
  runDir: string,
  request: WorkspaceRequest,
  reviewerResults: RoleResult[],
  factCheck: RoleResult,
  synthesis: RoleResult,
  infraErrors: InfraError[] = [],
): JsonRecord {
  const outcome = summarizeReviewOutcome(reviewerResults, factCheck, synthesis, infraErrors, request.authoring_lint)
  const report = {
    run_id: request.run_id,
    project_root: request.project_root,
    created_at: new Date().toISOString(),
    plan_compaction: request.plan_compaction,
    authoring_lint: request.authoring_lint,
    outcome,
    reviewers: Object.fromEntries(
      reviewerResults.map((item) => [
        item.role,
        {
          model: item.model,
          output_file: item.output_file,
          output: item.output,
        },
      ]),
    ),
    infra_errors: infraErrors,
    fact_check: {
      model: factCheck.model,
      output_file: factCheck.output_file,
      summary_file: factCheck.summary_file,
      summary: factCheck.summary,
      output: factCheck.output,
    },
    synthesis: {
      model: synthesis.model,
      output_file: synthesis.output_file,
      output: synthesis.output,
    },
  }
  writeJson(path.join(runDir, 'report.json'), report)
  return report
}

function extractFinalOutputText(stdout: unknown): string {
  const lines = String(stdout || '')
    .trim()
    .split(/\n/)
    .filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let event: unknown
    try {
      event = JSON.parse(lines[index])
    } catch {
      continue
    }
    if (isRecord(event) && event.type === 'result' && typeof event.result === 'string') {
      return event.result
    }
    const content = isRecord(event) && isRecord(event.message) ? event.message.content : undefined
    if (Array.isArray(content)) {
      for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
        const block = content[contentIndex]
        if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
          return block.text
        }
      }
    }
  }
  return ''
}

function reviewerInfraError(role: string, model: string, error: unknown, runDir: string): InfraError {
  const message = errorMessage(error)
  return {
    role,
    model,
    type: /invalid output|valid JSON|Probe mismatch/i.test(message) ? 'invalid_output' : 'agent_failed',
    message,
    metadata_file: path.relative(runDir, path.join(runDir, 'roles', role, 'metadata.json')),
    stdout_file: path.relative(runDir, path.join(runDir, 'roles', role, 'stdout.jsonl')),
    stderr_file: path.relative(runDir, path.join(runDir, 'roles', role, 'stderr.log')),
  }
}

function prepareReadBoundary(
  config: WorkspaceConfig,
  request: WorkspaceRequest,
  runDir: string,
  role: string,
  readScope: WorkspaceReadScope,
): PreparedReadBoundary {
  if (config.execution.isolate_reviewers === false) {
    return {
      promptRoot: request.project_root,
      claudeRoot: request.project_root,
      boundary: {
        ...readScope,
        mode: 'prompt_only',
        source_root: request.project_root,
        exposed_root: request.project_root,
      } as ReadBoundary,
      cleanup: () => {},
    }
  }
  const workspaceParent = fs.mkdtempSync(path.join(os.tmpdir(), `plan-review-${role}-scope-`))
  const boundary = {
    ...readScope,
    ...copyScopedWorkspace(request.project_root, readScope, workspaceParent),
  }
  appendExecutionLog(runDir, 'read_scope_prepared', {
    role,
    mode: boundary.mode,
    files: boundary.files.length,
    proposed_artifacts: (boundary.proposed_artifacts || []).length,
    blocked_refs: boundary.blocked_refs.length,
    skipped_refs: boundary.skipped_refs.length,
  })
  return {
    promptRoot: boundary.exposed_root,
    claudeRoot: boundary.exposed_root,
    boundary,
    cleanup: () => fs.rmSync(workspaceParent, { recursive: true, force: true }),
  }
}

async function runRole(
  config: WorkspaceConfig,
  request: WorkspaceRequest,
  role: string,
  runDir: string,
): Promise<RoleResult> {
  const model = config.roles[role]
  const startedMs = Date.now()
  const roleDir = path.join(runDir, 'roles', role)
  fs.mkdirSync(roleDir, { recursive: true })
  const readScope = buildRoleReadScope(role, request.project_root, request.review_plan || request.plan, {
    maxFiles: config.execution.read_scope_max_files,
    proposedArtifacts: request.proposed_artifacts || [],
  })
  const readBoundary = prepareReadBoundary(config, request, runDir, role, readScope)
  writeJson(path.join(roleDir, 'read-scope.json'), readBoundary.boundary)
  const prompt = buildWorkspacePrompt(
    role,
    readBoundary.promptRoot,
    request.review_plan || request.plan,
    request.context || '',
    null,
    null,
    readBoundary.boundary as Parameters<typeof buildWorkspacePrompt>[6],
  )
  const promptFile = path.join(roleDir, 'prompt.md')
  const validatorLogFile = path.join(roleDir, 'validator.log')
  writeGenerated(promptFile, prompt)
  const args = buildClaudeWorkspaceArgs(
    config as unknown as Parameters<typeof buildClaudeWorkspaceArgs>[0],
    model,
    role,
    readBoundary.claudeRoot,
    {
      validatorLogFile,
    },
  )
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-role-'))
  const startedAt = new Date().toISOString()
  appendExecutionLog(runDir, 'agent_started', {
    role,
    model,
  })
  let child: RunCommandResult
  try {
    child = asRunCommandResult(
      await runCommand(config.claude_bin, args, {
        cwd: workDir,
        env: withoutAnthropicApiKey(process.env),
        input: prompt,
        timeoutMs: config.execution.timeout_ms,
        killSignal: 'SIGKILL',
        maxBuffer: config.execution.max_buffer_bytes,
        validatorLogFile,
      }),
    )
  } catch (error: unknown) {
    appendExecutionLog(runDir, 'agent_failed', {
      role,
      model,
      elapsed_ms: Date.now() - startedMs,
    })
    writeRoleMetadata(runDir, roleDir, {
      role,
      model,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      timed_out: /timed out/i.test(errorMessage(error)),
      exit_code: null,
      signal: null,
      error: errorMessage(error),
      prompt_file: path.relative(runDir, promptFile),
      settings_file: config.models[model].settings_file,
      allowed_tools: ['Read', 'Glob', 'Grep'],
      json_validator_enabled: true,
      validator_tool: JSON_VALIDATOR_TOOL,
      validator_log_file: path.relative(runDir, validatorLogFile),
      schema_file: path.relative(ROOT, workspaceSchemaForRole(role)),
      project_root: request.project_root,
      read_boundary: {
        mode: readBoundary.boundary.mode,
        source_root: readBoundary.boundary.source_root,
        exposed_root: readBoundary.boundary.exposed_root,
        file_count: readBoundary.boundary.files.length,
        proposed_artifacts: readBoundary.boundary.proposed_artifacts || [],
        read_scope_file: path.relative(runDir, path.join(roleDir, 'read-scope.json')),
      },
      status: 'failed',
    })
    throw error
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
    readBoundary.cleanup()
  }

  writeGenerated(path.join(roleDir, 'stdout.jsonl'), child.stdout || '')
  writeGenerated(path.join(roleDir, 'stderr.log'), child.stderr || '')
  const metadata = {
    role,
    model,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timed_out: child.error?.code === 'ETIMEDOUT',
    exit_code: child.status,
    signal: child.signal,
    error: child.error ? child.error.message : null,
    prompt_file: path.relative(runDir, promptFile),
    settings_file: config.models[model].settings_file,
    allowed_tools: ['Read', 'Glob', 'Grep'],
    json_validator_enabled: true,
    validator_tool: JSON_VALIDATOR_TOOL,
    validator_log_file: path.relative(runDir, validatorLogFile),
    schema_file: path.relative(ROOT, workspaceSchemaForRole(role)),
    project_root: request.project_root,
    read_boundary: {
      mode: readBoundary.boundary.mode,
      source_root: readBoundary.boundary.source_root,
      exposed_root: readBoundary.boundary.exposed_root,
      file_count: readBoundary.boundary.files.length,
      proposed_artifacts: readBoundary.boundary.proposed_artifacts || [],
      read_scope_file: path.relative(runDir, path.join(roleDir, 'read-scope.json')),
    },
  }
  if (child.error || child.status !== 0) {
    appendExecutionLog(runDir, 'agent_failed', {
      role,
      model,
      elapsed_ms: Date.now() - startedMs,
    })
    writeRoleMetadata(runDir, roleDir, {
      ...metadata,
      status: 'failed',
    })
    throw new Error(`${role}/${model} failed: ${child.error?.message || `exit ${child.status}`}`)
  }

  let parsed: ParsedAssistantOutput
  try {
    parsed = asParsedAssistantOutput(parseAssistantOutput(child.stdout, role))
    validateWorkspaceOutput(role, parsed.output)
  } catch (error: unknown) {
    writeGenerated(path.join(roleDir, 'output.invalid.txt'), extractFinalOutputText(child.stdout))
    appendExecutionLog(runDir, 'agent_invalid_output', {
      role,
      model,
      elapsed_ms: Date.now() - startedMs,
    })
    writeRoleMetadata(runDir, roleDir, {
      ...metadata,
      status: 'failed',
      error: errorMessage(error),
      failure_kind: 'invalid_output',
      invalid_output_file: path.relative(runDir, path.join(roleDir, 'output.invalid.txt')),
    })
    throw new Error(`${role}/${model} returned invalid output: ${errorMessage(error)}`)
  }
  writeJson(path.join(roleDir, 'output.json'), parsed.output)
  writeRoleMetadata(runDir, roleDir, {
    ...metadata,
    status: 'completed',
    error: null,
  })
  appendExecutionLog(runDir, 'agent_completed', {
    role,
    model,
    elapsed_ms: Date.now() - startedMs,
  })
  return {
    role,
    model,
    output: parsed.output,
    output_file: path.relative(runDir, path.join(roleDir, 'output.json')),
  }
}

async function runFactCheck(
  config: WorkspaceConfig,
  request: WorkspaceRequest,
  reviewerResults: RoleResult[],
  runDir: string,
): Promise<RoleResult> {
  const role = FACT_CHECK_ROLE
  const model = config.roles[role]
  const startedMs = Date.now()
  const roleDir = path.join(runDir, 'roles', role)
  fs.mkdirSync(roleDir, { recursive: true })
  const reviewerOutputs = Object.fromEntries(reviewerOutputEntries(reviewerResults)) as Record<string, ReviewerOutput>
  const readScope = buildFactCheckReadScope(request.project_root, reviewerOutputs, {
    maxFiles: config.execution.read_scope_max_files,
    proposedArtifacts: request.proposed_artifacts || [],
    plan: request.review_plan || request.plan,
  })
  const readBoundary = prepareReadBoundary(config, request, runDir, role, readScope)
  writeJson(path.join(roleDir, 'read-scope.json'), readBoundary.boundary)
  const prompt = buildWorkspacePrompt(
    role,
    readBoundary.promptRoot,
    request.review_plan || request.plan,
    request.context || '',
    reviewerOutputs,
    null,
    readBoundary.boundary as Parameters<typeof buildWorkspacePrompt>[6],
  )
  const promptFile = path.join(roleDir, 'prompt.md')
  const validatorLogFile = path.join(roleDir, 'validator.log')
  writeGenerated(promptFile, prompt)
  const args = buildClaudeWorkspaceArgs(
    config as unknown as Parameters<typeof buildClaudeWorkspaceArgs>[0],
    model,
    role,
    readBoundary.claudeRoot,
    {
      tools: 'Read',
      allowProjectRead: true,
      validatorLogFile,
      systemPrompt: [
        'You are a non-interactive evidence verification agent.',
        'Read only files explicitly cited by reviewer evidence.',
        'Never search for new issues, modify files, or execute shell commands.',
        'Return only one raw JSON object that conforms to the provided schema.',
      ].join(' '),
    },
  )
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-fact-check-'))
  const startedAt = new Date().toISOString()
  appendExecutionLog(runDir, 'fact_check_started', {
    role,
    model,
    reviewer_count: reviewerResults.length,
  })
  let child: RunCommandResult
  try {
    child = asRunCommandResult(
      await runCommand(config.claude_bin, args, {
        cwd: workDir,
        env: withoutAnthropicApiKey(process.env),
        input: prompt,
        timeoutMs: config.execution.timeout_ms,
        killSignal: 'SIGKILL',
        maxBuffer: config.execution.max_buffer_bytes,
        validatorLogFile,
      }),
    )
  } catch (error: unknown) {
    appendExecutionLog(runDir, 'fact_check_failed', {
      role,
      model,
      elapsed_ms: Date.now() - startedMs,
    })
    writeRoleMetadata(runDir, roleDir, {
      role,
      model,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      timed_out: /timed out/i.test(errorMessage(error)),
      exit_code: null,
      signal: null,
      error: errorMessage(error),
      prompt_file: path.relative(runDir, promptFile),
      settings_file: config.models[model].settings_file,
      allowed_tools: ['Read'],
      json_validator_enabled: true,
      validator_tool: JSON_VALIDATOR_TOOL,
      validator_log_file: path.relative(runDir, validatorLogFile),
      schema_file: path.relative(ROOT, workspaceSchemaForRole(role)),
      project_root: request.project_root,
      read_boundary: {
        mode: readBoundary.boundary.mode,
        source_root: readBoundary.boundary.source_root,
        exposed_root: readBoundary.boundary.exposed_root,
        file_count: readBoundary.boundary.files.length,
        proposed_artifacts: readBoundary.boundary.proposed_artifacts || [],
        read_scope_file: path.relative(runDir, path.join(roleDir, 'read-scope.json')),
      },
      status: 'failed',
    })
    throw error
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
    readBoundary.cleanup()
  }

  writeGenerated(path.join(roleDir, 'stdout.jsonl'), child.stdout || '')
  writeGenerated(path.join(roleDir, 'stderr.log'), child.stderr || '')
  const metadata = {
    role,
    model,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timed_out: child.error?.code === 'ETIMEDOUT',
    exit_code: child.status,
    signal: child.signal,
    error: child.error ? child.error.message : null,
    prompt_file: path.relative(runDir, promptFile),
    settings_file: config.models[model].settings_file,
    allowed_tools: ['Read'],
    json_validator_enabled: true,
    validator_tool: JSON_VALIDATOR_TOOL,
    validator_log_file: path.relative(runDir, validatorLogFile),
    schema_file: path.relative(ROOT, workspaceSchemaForRole(role)),
    project_root: request.project_root,
    read_boundary: {
      mode: readBoundary.boundary.mode,
      source_root: readBoundary.boundary.source_root,
      exposed_root: readBoundary.boundary.exposed_root,
      file_count: readBoundary.boundary.files.length,
      proposed_artifacts: readBoundary.boundary.proposed_artifacts || [],
      read_scope_file: path.relative(runDir, path.join(roleDir, 'read-scope.json')),
    },
  }
  if (child.error || child.status !== 0) {
    appendExecutionLog(runDir, 'fact_check_failed', {
      role,
      model,
      elapsed_ms: Date.now() - startedMs,
    })
    writeRoleMetadata(runDir, roleDir, {
      ...metadata,
      status: 'failed',
    })
    throw new Error(`${role}/${model} failed: ${child.error?.message || `exit ${child.status}`}`)
  }

  let parsed: ParsedAssistantOutput
  try {
    parsed = asParsedAssistantOutput(parseAssistantOutput(child.stdout, role))
    validateWorkspaceOutput(role, parsed.output)
  } catch (error: unknown) {
    appendExecutionLog(runDir, 'fact_check_invalid_output', {
      role,
      model,
      elapsed_ms: Date.now() - startedMs,
    })
    writeRoleMetadata(runDir, roleDir, {
      ...metadata,
      status: 'failed',
      error: errorMessage(error),
    })
    throw new Error(`${role}/${model} returned invalid output: ${errorMessage(error)}`)
  }
  writeJson(path.join(roleDir, 'output.json'), parsed.output)
  const factCheckSummary = summarizeFactCheckOutput(parsed.output)
  writeJson(path.join(roleDir, 'fact-check-summary.json'), factCheckSummary)
  writeRoleMetadata(runDir, roleDir, {
    ...metadata,
    fact_check_summary_file: path.relative(runDir, path.join(roleDir, 'fact-check-summary.json')),
    status: 'completed',
    error: null,
  })
  appendExecutionLog(runDir, 'fact_check_summary', factCheckSummary)
  appendExecutionLog(runDir, 'fact_check_completed', {
    role,
    model,
    elapsed_ms: Date.now() - startedMs,
  })
  return {
    role,
    model,
    output: parsed.output,
    output_file: path.relative(runDir, path.join(roleDir, 'output.json')),
    summary: factCheckSummary,
    summary_file: path.relative(runDir, path.join(roleDir, 'fact-check-summary.json')),
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  async function consume() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) {
        return
      }
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => consume()))
  return results
}

async function runReviewers(
  config: WorkspaceConfig,
  request: WorkspaceRequest,
  roles: string[],
  runDir: string,
): Promise<{ reviewerResults: RoleResult[]; infraErrors: InfraError[] }> {
  const settled = await runWithConcurrency<string, SettledResult<RoleResult>>(
    roles,
    config.execution.max_concurrency,
    async (role) => {
      const model = config.roles[role]
      try {
        return {
          ok: true,
          result: await runRole(config, request, role, runDir),
        }
      } catch (error: unknown) {
        return {
          ok: false,
          error: reviewerInfraError(role, model, error, runDir),
        }
      }
    },
  )
  return {
    reviewerResults: settled.filter((item) => item.ok).map((item) => item.result as RoleResult),
    infraErrors: settled.filter((item) => !item.ok).map((item) => item.error as InfraError),
  }
}

function reviewerStageError(reviewerResults: RoleResult[], infraErrors: InfraError[]): ReviewerStageFailure | null {
  if (!infraErrors.length) {
    return null
  }
  const completedRoles = reviewerResults.map((item) => item.role).filter((role): role is string => Boolean(role))
  const failedRoles = infraErrors.map((item) => item.role).filter((role): role is string => Boolean(role))
  const detail = infraErrors
    .map((item) => {
      const roleModel = [item.role, item.model].filter(Boolean).join('/')
      return `${roleModel || 'reviewer'}: ${item.message || item.type || 'failed'}`
    })
    .join('; ')
  const error = new Error(
    `Reviewer stage failed before fact_check; retry reviewers first: ${detail}`,
  ) as ReviewerStageFailure
  error.infraErrors = infraErrors
  error.completedReviewerRoles = completedRoles
  error.failedReviewerRoles = failedRoles
  return error
}

async function runSynthesis(
  config: WorkspaceConfig,
  request: WorkspaceRequest,
  reviewerResults: RoleResult[],
  factCheckResult: RoleResult,
  runDir: string,
): Promise<RoleResult> {
  const role = 'synthesis'
  const model = config.roles.synthesis
  const startedMs = Date.now()
  const roleDir = path.join(runDir, 'roles', role)
  fs.mkdirSync(roleDir, { recursive: true })
  const reviewerOutputs = Object.fromEntries(reviewerOutputEntries(reviewerResults)) as Record<string, ReviewerOutput>
  const prompt = buildWorkspacePrompt(
    role,
    request.project_root,
    request.review_plan || request.plan,
    request.context || '',
    reviewerOutputs,
    factCheckResult.output,
  )
  const promptFile = path.join(roleDir, 'prompt.md')
  const validatorLogFile = path.join(roleDir, 'validator.log')
  writeGenerated(promptFile, prompt)
  const args = buildClaudeWorkspaceArgs(
    config as unknown as Parameters<typeof buildClaudeWorkspaceArgs>[0],
    model,
    role,
    request.project_root,
    {
      tools: '',
      allowProjectRead: false,
      validatorLogFile,
    },
  )
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-synthesis-'))
  const startedAt = new Date().toISOString()
  appendExecutionLog(runDir, 'synthesis_started', {
    role,
    model,
    reviewer_count: reviewerResults.length,
  })
  let child: RunCommandResult
  try {
    child = asRunCommandResult(
      await runCommand(config.claude_bin, args, {
        cwd: workDir,
        env: withoutAnthropicApiKey(process.env),
        input: prompt,
        timeoutMs: config.execution.timeout_ms,
        killSignal: 'SIGKILL',
        maxBuffer: config.execution.max_buffer_bytes,
        validatorLogFile,
      }),
    )
  } catch (error: unknown) {
    appendExecutionLog(runDir, 'synthesis_failed', {
      role,
      model,
      elapsed_ms: Date.now() - startedMs,
    })
    writeRoleMetadata(runDir, roleDir, {
      role,
      model,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      timed_out: /timed out/i.test(errorMessage(error)),
      exit_code: null,
      signal: null,
      error: errorMessage(error),
      prompt_file: path.relative(runDir, promptFile),
      settings_file: config.models[model].settings_file,
      allowed_tools: [],
      json_validator_enabled: true,
      validator_tool: JSON_VALIDATOR_TOOL,
      validator_log_file: path.relative(runDir, validatorLogFile),
      schema_file: path.relative(ROOT, workspaceSchemaForRole(role)),
      project_root: null,
      status: 'failed',
    })
    throw error
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }

  writeGenerated(path.join(roleDir, 'stdout.jsonl'), child.stdout || '')
  writeGenerated(path.join(roleDir, 'stderr.log'), child.stderr || '')
  const metadata = {
    role,
    model,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timed_out: child.error?.code === 'ETIMEDOUT',
    exit_code: child.status,
    signal: child.signal,
    error: child.error ? child.error.message : null,
    prompt_file: path.relative(runDir, promptFile),
    settings_file: config.models[model].settings_file,
    allowed_tools: [],
    json_validator_enabled: true,
    validator_tool: JSON_VALIDATOR_TOOL,
    validator_log_file: path.relative(runDir, validatorLogFile),
    schema_file: path.relative(ROOT, workspaceSchemaForRole(role)),
    project_root: null,
  }
  if (child.error || child.status !== 0) {
    appendExecutionLog(runDir, 'synthesis_failed', {
      role,
      model,
      elapsed_ms: Date.now() - startedMs,
    })
    writeRoleMetadata(runDir, roleDir, {
      ...metadata,
      status: 'failed',
    })
    throw new Error(`synthesis/${model} failed: ${child.error?.message || `exit ${child.status}`}`)
  }
  let parsed: ParsedAssistantOutput
  try {
    parsed = asParsedAssistantOutput(parseAssistantOutput(child.stdout, role))
    validateWorkspaceOutput(role, parsed.output, {
      factCheckOutput: factCheckResult.output,
      reviewerOutputs,
    })
  } catch (error: unknown) {
    appendExecutionLog(runDir, 'synthesis_invalid_output', {
      role,
      model,
      elapsed_ms: Date.now() - startedMs,
    })
    writeRoleMetadata(runDir, roleDir, {
      ...metadata,
      status: 'failed',
      error: errorMessage(error),
    })
    throw new Error(`synthesis/${model} returned invalid output: ${errorMessage(error)}`)
  }
  writeJson(path.join(roleDir, 'output.json'), parsed.output)
  writeRoleMetadata(runDir, roleDir, {
    ...metadata,
    status: 'completed',
    error: null,
  })
  appendExecutionLog(runDir, 'synthesis_completed', {
    role,
    model,
    elapsed_ms: Date.now() - startedMs,
  })
  return {
    role,
    model,
    output: parsed.output,
    output_file: path.relative(runDir, path.join(roleDir, 'output.json')),
  }
}

function archiveRoleAttempt(runDir: string, role: string): string | null {
  const roleDir = path.join(runDir, 'roles', role)
  if (!fs.existsSync(roleDir)) {
    return null
  }
  const attemptsDir = path.join(runDir, 'roles', `${role}-attempts`)
  fs.mkdirSync(attemptsDir, { recursive: true })
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  let target = path.join(attemptsDir, stamp)
  let index = 2
  while (fs.existsSync(target)) {
    target = path.join(attemptsDir, `${stamp}-${index}`)
    index += 1
  }
  fs.renameSync(roleDir, target)
  const archivedRoleDir = path.relative(runDir, target)
  archiveResolvedExecutionAttempt(runDir, role, archivedRoleDir)
  return archivedRoleDir
}

function normalizedRetryCounts(state: RetryState): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const role of [...REVIEW_ROLES, FACT_CHECK_ROLE, 'synthesis']) {
    const value = Number(state.retry_counts?.[role] || 0)
    counts[role] = Number.isInteger(value) && value >= 0 ? value : 0
  }
  return counts
}

function assertRetryAvailable(retryCounts: Record<string, number>, executors: string[]): void {
  const exhausted = [...new Set<string>(executors)].filter((executor) => retryCounts[executor] >= MAX_EXECUTOR_RETRIES)
  if (exhausted.length) {
    throw new Error(`Retry limit reached (${MAX_EXECUTOR_RETRIES}) for executor(s): ${exhausted.join(', ')}`)
  }
}

function consumeExecutorRetries(runDir: string, retryCounts: Record<string, number>, executors: string[]): void {
  for (const executor of [...new Set<string>(executors)]) {
    retryCounts[executor] += 1
  }
  updateState(runDir, {
    retry_counts: retryCounts,
  })
  appendExecutionLog(runDir, 'executor_retries_consumed', {
    executors: [...new Set<string>(executors)],
    retry_counts: retryCounts,
    retry_limit: MAX_EXECUTOR_RETRIES,
  })
}

function updateRunRetryManifest(runDir: string, stage: string, retryRoles: string[]): void {
  updateRunManifest(runDir, {
    retry_stage: stage,
    retry_roles: retryRoles,
    retry_started_at: new Date().toISOString(),
  })
}

async function retryWorkspaceReviewStage(
  config: WorkspaceConfig,
  runDir: string,
  stage: string,
  options: JsonRecord = {},
): Promise<RetryResult> {
  if (!['reviewers', FACT_CHECK_ROLE, 'synthesis'].includes(stage)) {
    throw new Error(`Unsupported retry stage: ${stage}. Expected reviewers, ${FACT_CHECK_ROLE}, or synthesis.`)
  }
  const absoluteRunDir = path.resolve(runDir)
  const state: RetryState = readJsonIfExists<RetryState>(path.join(absoluteRunDir, 'state.json')) || {}
  if (state.status === 'running' && !options.force) {
    throw new Error(
      'Cannot retry while run status is running. Use force only if the previous process is known to be dead.',
    )
  }
  const { request, roles } = loadRequestForRun(config, absoluteRunDir)
  requireRunManifest(absoluteRunDir)
  const runRoleStage = (options.runRole || runRole) as typeof runRole
  const runFactCheckStage = (options.runFactCheck || runFactCheck) as typeof runFactCheck
  const runSynthesisStage = (options.runSynthesis || runSynthesis) as typeof runSynthesis
  const completedReviewers = new Map<string, RoleResult>(
    roles
      .map((role) => completedReviewerResult(absoluteRunDir, role))
      .filter((result): result is RoleResult & { role: string } => Boolean(result?.role))
      .map((result) => [result.role, result]),
  )
  const retryRoles = stage === 'reviewers' ? roles.filter((role) => !completedReviewers.has(role)) : []
  if (stage === 'reviewers' && !retryRoles.length) {
    throw new Error('Cannot retry reviewers: all requested reviewers are already completed')
  }
  if (stage !== 'reviewers') {
    loadCompletedReviewerResults(absoluteRunDir, roles, stage)
  }
  const retryCounts = normalizedRetryCounts(state)
  const plannedExecutors =
    stage === 'reviewers'
      ? [...retryRoles, FACT_CHECK_ROLE, 'synthesis']
      : stage === FACT_CHECK_ROLE
        ? [FACT_CHECK_ROLE, 'synthesis']
        : ['synthesis']
  assertRetryAvailable(retryCounts, plannedExecutors)

  const archivedAttempts: Record<string, string | null> = {}
  if (stage === 'reviewers') {
    for (const role of retryRoles) {
      archivedAttempts[role] = archiveRoleAttempt(absoluteRunDir, role)
    }
  } else if (stage === FACT_CHECK_ROLE) {
    archivedAttempts[FACT_CHECK_ROLE] = archiveRoleAttempt(absoluteRunDir, FACT_CHECK_ROLE)
    archivedAttempts.synthesis = archiveRoleAttempt(absoluteRunDir, 'synthesis')
  } else {
    archivedAttempts.synthesis = archiveRoleAttempt(absoluteRunDir, 'synthesis')
  }

  updateState(absoluteRunDir, {
    status: 'running',
    pid: process.pid,
    retry_stage: stage,
    retry_started_at: new Date().toISOString(),
    finished_at: undefined,
    project_root: request.project_root,
    roles,
    error: null,
    report_file: null,
    infra_errors: [],
  })
  markManifestRunning(absoluteRunDir, request)
  updateRunRetryManifest(absoluteRunDir, stage, retryRoles)
  appendExecutionLog(absoluteRunDir, 'stage_retry_started', {
    stage,
    retry_roles: retryRoles,
    archived_attempts: archivedAttempts,
  })
  try {
    let reviewerResults: RoleResult[]
    if (stage === 'reviewers') {
      consumeExecutorRetries(absoluteRunDir, retryCounts, retryRoles)
      const settled = await runWithConcurrency<string, SettledResult<RoleResult>>(
        retryRoles,
        config.execution.max_concurrency,
        async (role) => {
          try {
            return {
              ok: true,
              result: await runRoleStage(config, request, role, absoluteRunDir),
            }
          } catch (error: unknown) {
            return {
              ok: false,
              role,
              error,
            }
          }
        },
      )
      const failures = settled.filter((item) => !item.ok)
      if (failures.length) {
        throw new Error(
          `Reviewer retry failed: ${failures.map((item) => `${item.role}: ${errorMessage(item.error)}`).join('; ')}`,
        )
      }
      for (const item of settled) {
        if (item.result?.role) {
          completedReviewers.set(item.result.role, item.result)
        }
      }
      reviewerResults = roles
        .map((role) => completedReviewers.get(role))
        .filter((item): item is RoleResult => Boolean(item))
      archivedAttempts[FACT_CHECK_ROLE] = archiveRoleAttempt(absoluteRunDir, FACT_CHECK_ROLE)
      archivedAttempts.synthesis = archiveRoleAttempt(absoluteRunDir, 'synthesis')
      appendExecutionLog(absoluteRunDir, 'stage_retry_downstream_invalidated', {
        stage,
        archived_attempts: {
          fact_check: archivedAttempts[FACT_CHECK_ROLE],
          synthesis: archivedAttempts.synthesis,
        },
      })
    } else {
      reviewerResults = loadCompletedReviewerResults(absoluteRunDir, roles, stage)
    }

    let factCheck
    if (stage === 'synthesis') {
      factCheck = loadCompletedFactCheckResult(absoluteRunDir, stage)
    } else {
      if (stage === FACT_CHECK_ROLE) {
        consumeExecutorRetries(absoluteRunDir, retryCounts, [FACT_CHECK_ROLE])
      }
      factCheck = await runFactCheckStage(config, request, reviewerResults, absoluteRunDir)
    }
    if (stage === 'synthesis') {
      consumeExecutorRetries(absoluteRunDir, retryCounts, ['synthesis'])
    }
    const synthesis = await runSynthesisStage(config, request, reviewerResults, factCheck, absoluteRunDir)
    writeWorkspaceReport(absoluteRunDir, request, reviewerResults, factCheck, synthesis, [])
    updateState(absoluteRunDir, {
      status: 'completed',
      finished_at: new Date().toISOString(),
      report_file: 'report.json',
      error: null,
      retry_stage: null,
      infra_errors: [],
    })
    markManifestFinished(absoluteRunDir, 'completed', {
      retry_stage: null,
      infra_errors: [],
    })
    appendExecutionLog(absoluteRunDir, 'stage_retry_completed', {
      stage,
    })
    appendExecutionLog(absoluteRunDir, 'run_completed', {
      run_id: request.run_id,
      reviewer_count: reviewerResults.length,
      infra_error_count: 0,
    })
    return {
      run_id: request.run_id,
      stage,
      status: 'completed',
      retried_reviewers: retryRoles,
      retry_counts: retryCounts,
      retry_limit: MAX_EXECUTOR_RETRIES,
      archived_attempt: archivedAttempts[stage] || null,
      archived_attempts: archivedAttempts,
      report_file: path.join(absoluteRunDir, 'report.json'),
    }
  } catch (error: unknown) {
    appendExecutionLog(absoluteRunDir, 'stage_retry_failed', {
      stage,
    })
    appendExecutionLog(absoluteRunDir, 'run_failed', {
      run_id: request.run_id,
    })
    updateState(absoluteRunDir, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: errorStackOrMessage(error),
      retry_stage: null,
    })
    markManifestFinished(absoluteRunDir, 'failed', {
      retry_stage: null,
      error: errorStackOrMessage(error),
    })
    throw error
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const runDir = path.resolve(requireArg(args, 'run-dir'))
  const config = loadWorkspaceReviewFromArgs(args) as WorkspaceConfig
  const { request, roles } = loadRequestForRun(config, runDir)
  requireRunManifest(runDir)
  const reviewPlan = config.execution.compact_plan
    ? compactPlanForReview(request.plan)
    : {
        text: request.plan,
        stats: {
          original_chars: String(request.plan).length,
          compacted_chars: String(request.plan).length,
          saved_chars: 0,
          code_blocks: 0,
          compacted_blocks: 0,
          preserved_blocks: 0,
          original_lines: String(request.plan).split('\n').length,
          implementation_detail_chars: 0,
          implementation_detail_lines: 0,
          implementation_detail_ratio: 0,
          plan_bloat_warning: false,
          proposed_artifact_count: 0,
          proposed_artifact_chars: 0,
        },
        artifacts: [],
      }
  request.review_plan = reviewPlan.text
  request.plan_compaction = reviewPlan.stats
  request.proposed_artifacts = materializeProposedArtifacts(runDir, reviewPlan.artifacts || [])
  request.review_plan_refs = createPlanReferenceManifest(request.project_root, request.plan, request.proposed_artifacts)
  writeGenerated(path.join(runDir, 'review-plan.md'), request.review_plan)
  writeJson(path.join(runDir, 'plan-compaction.json'), request.plan_compaction)
  writeJson(path.join(runDir, 'proposed-code-manifest.json'), {
    artifact_count: request.proposed_artifacts.length,
    artifacts: request.proposed_artifacts,
  })
  writeJson(path.join(runDir, 'review-plan-refs.json'), request.review_plan_refs)
  markManifestRunning(runDir, request)

  updateState(runDir, {
    status: 'running',
    pid: process.pid,
    started_at: new Date().toISOString(),
    finished_at: undefined,
    roles,
    project_root: request.project_root,
    error: null,
    report_file: null,
    infra_errors: [],
  })
  appendExecutionLog(runDir, 'run_started', {
    run_id: request.run_id,
    pid: process.pid,
    roles,
    max_concurrency: config.execution.max_concurrency,
  })
  appendExecutionLog(runDir, 'plan_compacted', request.plan_compaction)
  const authoringLint = request.authoring_lint
  appendExecutionLog(runDir, 'plan_authoring_linted', {
    errors: authoringLint?.errors.length || 0,
    warnings: authoringLint?.warnings.length || 0,
    complexity: authoringLint?.complexity.level || null,
    total_lines: authoringLint?.metrics.total_lines || null,
  })
  appendExecutionLog(runDir, 'proposed_artifacts_prepared', {
    artifacts: request.proposed_artifacts.length,
  })

  try {
    const { reviewerResults, infraErrors } = await runReviewers(config, request, roles, runDir)
    const reviewerFailure = reviewerStageError(reviewerResults, infraErrors)
    if (reviewerFailure) {
      appendExecutionLog(runDir, 'reviewers_failed', {
        completed_roles: reviewerFailure.completedReviewerRoles,
        failed_roles: reviewerFailure.failedReviewerRoles,
        infra_error_count: infraErrors.length,
      })
      throw reviewerFailure
    }
    const factCheck = await runFactCheck(config, request, reviewerResults, runDir)
    const synthesis = await runSynthesis(config, request, reviewerResults, factCheck, runDir)
    writeWorkspaceReport(runDir, request, reviewerResults, factCheck, synthesis, infraErrors)
    updateState(runDir, {
      status: 'completed',
      finished_at: new Date().toISOString(),
      report_file: 'report.json',
      error: null,
      infra_errors: infraErrors,
    })
    markManifestFinished(runDir, 'completed', {
      infra_errors: infraErrors,
    })
    appendExecutionLog(runDir, 'run_completed', {
      run_id: request.run_id,
      reviewer_count: reviewerResults.length,
      infra_error_count: infraErrors.length,
    })
  } catch (error: unknown) {
    const infraErrors = isRecord(error) && Array.isArray(error.infraErrors) ? (error.infraErrors as InfraError[]) : []
    appendExecutionLog(runDir, 'run_failed', {
      run_id: request.run_id,
      infra_error_count: infraErrors.length,
    })
    updateState(runDir, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: errorStackOrMessage(error),
      infra_errors: infraErrors,
    })
    markManifestFinished(runDir, 'failed', {
      error: errorStackOrMessage(error),
      infra_errors: infraErrors,
    })
    throw error
  }
}

if (isMainScript(__filename)) {
  main().catch((error: unknown) => {
    console.error(errorStackOrMessage(error))
    process.exitCode = 1
  })
}

export {
  runRole,
  runWithConcurrency,
  summarizeReviewOutcome,
  reviewerStageError,
  runSynthesis,
  retryWorkspaceReviewStage,
  completedReviewerResult,
  normalizedRetryCounts,
  assertRetryAvailable,
  loadCompletedReviewerResults,
  loadCompletedFactCheckResult,
  writeWorkspaceReport,
  validateWorkspaceOutput,
  validateSynthesisSemantics,
}
