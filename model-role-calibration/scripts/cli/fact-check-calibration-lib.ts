import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { ROOT, ensureDir, parseJsonFile, readText, slug, writeFileNew, writeGenerated } from '../lib/lib.js'

type JsonObject = Record<string, unknown>

interface WorkspaceRunOptions {
  runId?: string
  runDir?: string
}

interface CreateCaseOptions extends WorkspaceRunOptions {
  caseId: string
}

interface GeneratePromptsOptions {
  run: string
  caseId: string
  models: string[]
}

interface IngestOutputOptions {
  run: string
  caseId: string
  model: string
  file: string
}

interface ScoreOutputOptions {
  run: string
  caseId: string
  model: string
}

interface ReviewerOutput {
  issues?: Array<{
    title?: string
    [key: string]: unknown
  }>
  [key: string]: unknown
}

interface ReviewerReportItem {
  output?: ReviewerOutput
}

interface WorkspaceReport {
  run_id?: string
  project_root?: string
  reviewers?: Record<string, ReviewerReportItem>
  fact_check?: {
    output?: FactCheckOutput
  }
}

interface WorkspaceRequest {
  run_id?: string
  project_root?: string
  plan_file?: string
  plan?: string
  context?: string
}

interface FactCheckIssue {
  issue_id?: string
  source: string
  issue_title: string
  status: string
  evidence_status: string
  claim_support: string
  reason?: string
  [key: string]: unknown
}

interface FactCheckOutput extends JsonObject {
  probe: 'fact_check'
  checked_issues: FactCheckIssue[]
}

interface CaseIssue {
  id: string
  source: string
  issue_title: string
  reviewer_issue_index: number
  seed_status: string | null
  seed_evidence_status: string | null
  seed_claim_support: string | null
  expected_status: string | null
  expected_evidence_status: string | null
  expected_claim_support: string | null
  label_notes: string
}

interface FactCheckCase extends JsonObject {
  version: number
  case_id: string
  created_at: string
  label_status: string
  label_instructions: string[]
  source_workspace_run: JsonObject
  plan: {
    plan_file: string | null
    context: string
    review_plan: string
  }
  reviewer_outputs: Record<string, ReviewerOutput | undefined>
  issues: CaseIssue[]
}

interface NormalizedOutput extends JsonObject {
  case_id: string
  model: string
  ingested_at: string
  output: FactCheckOutput
}

interface ScoreRow {
  id: string
  source: string
  issue_title: string
  actual_issue_id: string | null
  expected_status: string
  actual_status: string
  status_match: boolean
  expected_evidence_status: string | null
  actual_evidence_status: string | null
  evidence_status_match: boolean | null
  expected_claim_support: string | null
  actual_claim_support: string | null
  claim_support_match: boolean | null
  reason: string
}

interface ScoreResult extends JsonObject {
  run: string
  case_id: string
  model: string
  scored_at: string
  totals: {
    expected: number
    actual: number
    extra: number
    missing: number
    status_matches: number
    challenged_expected: number
    challenged_hits: number
    false_verified: number
    over_challenged: number
  }
  metrics: {
    status_accuracy: number | null
    challenge_recall: number | null
    evidence_status_accuracy: number | null
    claim_support_accuracy: number | null
    extra_rate: number
    missing_rate: number | null
  }
  rows: ScoreRow[]
  extra_issues: Array<{
    issue_id: string | null
    source: string
    issue_title: string
    status: string
  }>
}

interface ModelSummary {
  model: string
  cases: string[]
  avg_status_accuracy: number | null
  avg_challenge_recall: number | null
  total_false_verified: number
  total_over_challenged: number
  total_extra: number
  total_missing: number
}

interface FactCheckSummary extends JsonObject {
  run: string
  generated_at: string
  scores: ScoreResult[]
  model_summaries: ModelSummary[]
  recommendation: string | null
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export const FACT_CHECK_ROOT = process.env.MODEL_ROLE_CALIBRATION_FACT_CHECK_ROOT
  ? path.resolve(process.env.MODEL_ROLE_CALIBRATION_FACT_CHECK_ROOT)
  : path.join(ROOT, 'fact-check-calibration')
const DEFAULT_WORKSPACE_RUNS_DIR = path.join(os.homedir(), '.claude', 'plan-review-harness', 'mcp', 'workspace-runs')
const REVIEWER_SOURCE_BY_ROLE: Record<string, string> = {
  risk: 'Risk Reviewer',
  architecture: 'Architecture Reviewer',
  execution: 'Execution Reviewer',
  rebuttal: 'Rebuttal Reviewer',
}
const SOURCE_ALIAS_BY_NORMALIZED = new Map<string, string>(
  Object.entries({
    risk: 'Risk Reviewer',
    riskreviewer: 'Risk Reviewer',
    architecture: 'Architecture Reviewer',
    architecturereviewer: 'Architecture Reviewer',
    execution: 'Execution Reviewer',
    executionreviewer: 'Execution Reviewer',
    rebuttal: 'Rebuttal Reviewer',
    rebuttalreviewer: 'Rebuttal Reviewer',
  }),
)
const STATUSES = new Set(['verified', 'partially_verified', 'unsupported', 'contradicted', 'unverifiable'])
const EVIDENCE_STATUSES = new Set([
  'quote_matches',
  'quote_mismatch',
  'citation_missing',
  'file_missing',
  'line_missing',
  'plan_only',
  'not_checked',
])
const CLAIM_SUPPORTS = new Set(['direct', 'partial', 'none', 'contradicted', 'unverifiable'])

export function assertFactCheckCaseId(caseId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(caseId)) {
    throw new Error(`Invalid fact-check calibration case id: ${caseId}`)
  }
}

export function resolveWorkspaceRunDir({ runId, runDir }: WorkspaceRunOptions): string {
  if (runId && runDir) {
    throw new Error('Use either --run-id or --run-dir, not both.')
  }
  if (runDir) {
    return path.resolve(runDir)
  }
  if (!runId) {
    throw new Error('Missing required argument: --run-id or --run-dir')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new Error(`Invalid workspace review run id: ${runId}`)
  }
  return path.join(DEFAULT_WORKSPACE_RUNS_DIR, runId)
}

function caseDir(caseId: string): string {
  assertFactCheckCaseId(caseId)
  return path.join(FACT_CHECK_ROOT, 'cases', caseId)
}

export function caseFile(caseId: string): string {
  return path.join(caseDir(caseId), 'case.json')
}

export function loadCase(caseId: string): FactCheckCase {
  const file = caseFile(caseId)
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown fact-check calibration case: ${file}`)
  }
  return parseJsonFile<FactCheckCase>(file)
}

function runCaseDir(run: string, caseId: string): string {
  assertFactCheckCaseId(caseId)
  return path.join(FACT_CHECK_ROOT, 'runs', run, caseId)
}

export function normalizedOutputFile(run: string, caseId: string, model: string): string {
  return path.join(runCaseDir(run, caseId), 'outputs', 'normalized', `${slug(model)}.json`)
}

function scoreFile(run: string, caseId: string, model: string): string {
  return path.join(runCaseDir(run, caseId), 'scores', `${slug(model)}.score.json`)
}

function normalizeSource(source: unknown): string {
  const value = String(source || '').trim()
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return SOURCE_ALIAS_BY_NORMALIZED.get(normalized) || value
}

function checkedIssueKey(source: unknown, title: unknown): string {
  return `${normalizeSource(source)}\u0000${title}`
}

function reviewerOutputsFromReport(report: WorkspaceReport): Record<string, ReviewerOutput | undefined> {
  return Object.fromEntries(
    Object.entries(report.reviewers || {}).map(([role, item]) => [REVIEWER_SOURCE_BY_ROLE[role] || role, item.output]),
  )
}

function issueRowsFromReviewers(
  reviewerOutputs: Record<string, ReviewerOutput | undefined>,
  factCheckOutput: FactCheckOutput | null,
): CaseIssue[] {
  const checkedIssues = factCheckOutput?.checked_issues || []
  const factRowsById = new Map<string, FactCheckIssue>(
    checkedIssues.filter((item) => item.issue_id).map((item) => [item.issue_id as string, item]),
  )
  const factRowsByText = new Map<string, FactCheckIssue>(
    checkedIssues.map((item) => [checkedIssueKey(item.source, item.issue_title), item]),
  )
  const rows: CaseIssue[] = []
  for (const [source, output] of Object.entries(reviewerOutputs)) {
    const issues = Array.isArray(output?.issues) ? output.issues : []
    issues.forEach((issue, index) => {
      const id = `${slug(source)}-${String(index + 1).padStart(3, '0')}`
      const fact = factRowsById.get(id) || factRowsByText.get(checkedIssueKey(source, issue.title))
      rows.push({
        id,
        source,
        issue_title: stringValue(issue.title),
        reviewer_issue_index: index,
        seed_status: fact?.status || null,
        seed_evidence_status: fact?.evidence_status || null,
        seed_claim_support: fact?.claim_support || null,
        expected_status: null,
        expected_evidence_status: null,
        expected_claim_support: null,
        label_notes: '',
      })
    })
  }
  return rows
}

export function createCaseFromWorkspaceRun({ runId, runDir, caseId }: CreateCaseOptions): {
  case_file: string
  issue_count: number
} {
  assertFactCheckCaseId(caseId)
  const absoluteRunDir = resolveWorkspaceRunDir({ runId, runDir })
  const requestFile = path.join(absoluteRunDir, 'request.json')
  const reportFile = path.join(absoluteRunDir, 'report.json')
  const reviewPlanFile = path.join(absoluteRunDir, 'review-plan.md')
  if (!fs.existsSync(requestFile)) {
    throw new Error(`Missing workspace request: ${requestFile}`)
  }
  if (!fs.existsSync(reportFile)) {
    throw new Error(`Missing completed workspace report: ${reportFile}`)
  }
  const request = parseJsonFile<WorkspaceRequest>(requestFile)
  const report = parseJsonFile<WorkspaceReport>(reportFile)
  const reviewerOutputs = reviewerOutputsFromReport(report)
  const factCheckOutput = report.fact_check?.output || null
  const fixture: FactCheckCase = {
    version: 1,
    case_id: caseId,
    created_at: new Date().toISOString(),
    label_status: 'draft',
    label_instructions: [
      'Fill expected_status for every issue before scoring.',
      'Do not use seed_status as ground truth without human review.',
      'Allowed expected_status: verified, partially_verified, unsupported, contradicted, unverifiable.',
    ],
    source_workspace_run: {
      run_id: report.run_id || request.run_id || runId || path.basename(absoluteRunDir),
      run_dir: absoluteRunDir,
      project_root: report.project_root || request.project_root || null,
      report_file: reportFile,
    },
    plan: {
      plan_file: request.plan_file || null,
      context: request.context || '',
      review_plan: fs.existsSync(reviewPlanFile) ? readText(reviewPlanFile) : String(request.plan || ''),
    },
    reviewer_outputs: reviewerOutputs,
    issues: issueRowsFromReviewers(reviewerOutputs, factCheckOutput),
  }
  const target = caseFile(caseId)
  writeFileNew(target, JSON.stringify(fixture, null, 2) + '\n')
  return {
    case_file: target,
    issue_count: fixture.issues.length,
  }
}

function renderFactCheckInput(fixture: FactCheckCase): string {
  const issueIds = (fixture.issues || []).map((item) => ({
    issue_id: item.id,
    source: item.source,
    issue_title: item.issue_title,
    reviewer_issue_index: item.reviewer_issue_index,
  }))
  const sourceSections = Object.entries(fixture.reviewer_outputs || {})
    .map(([source, output]) => [`## ${source}`, '', '```json', JSON.stringify(output, null, 2), '```'].join('\n'))
    .join('\n\n')
  return [
    '# Fact Check Calibration Case',
    '',
    '## 校准目标',
    '',
    '你只需要校验 Reviewer 已输出 issue 的 evidence 是否支持 claim。禁止发现新问题，禁止提出修复建议。',
    '',
    '## 读取边界',
    '',
    '- 使用输入计划、Reviewer JSON 和 Reviewer evidence 中明确引用的文件/行号/片段。',
    '- 如果 evidence 不足以定位或当前 prompt 不含可核验内容，标记为 `unverifiable` 或 `unsupported`。',
    '- 禁止为了补证据而搜索新的文件、符号或需求。',
    '',
    '## Reviewer Issue IDs',
    '',
    '输出 `checked_issues` 时必须使用下列 `issue_id` 作为匹配主键；`source` 与 `issue_title` 也必须与这里逐字一致。',
    '',
    '```json',
    JSON.stringify(issueIds, null, 2),
    '```',
    '',
    '## 待评审计划',
    '',
    fixture.plan.review_plan.trim(),
    fixture.plan.context ? `\n## 补充上下文\n\n${fixture.plan.context.trim()}` : '',
    '',
    '# Reviewer 意见',
    '',
    sourceSections,
  ]
    .filter(Boolean)
    .join('\n')
}

export function renderFactCheckPrompt(fixture: FactCheckCase): string {
  const template = readText(path.join(ROOT, 'prompts', 'probe-fact_check.md'))
  return template.replace('{{INPUT}}', renderFactCheckInput(fixture))
}

export function generatePrompts({ run, caseId, models }: GeneratePromptsOptions): {
  prompt_dir: string
  models: string[]
} {
  const fixture = loadCase(caseId)
  const prompt = renderFactCheckPrompt(fixture)
  const promptDir = path.join(runCaseDir(run, caseId), 'prompts')
  ensureDir(promptDir)
  for (const model of models) {
    writeGenerated(path.join(promptDir, `${slug(model)}-fact_check.md`), prompt)
  }
  return {
    prompt_dir: promptDir,
    models,
  }
}

export function ingestOutput({ run, caseId, model, file }: IngestOutputOptions): {
  raw_file: string
  normalized_file: string
} {
  const absoluteFile = path.resolve(file)
  if (!fs.existsSync(absoluteFile)) {
    throw new Error(`Input file does not exist: ${absoluteFile}`)
  }
  const rawDir = path.join(runCaseDir(run, caseId), 'outputs', 'raw')
  const normalizedDir = path.join(runCaseDir(run, caseId), 'outputs', 'normalized')
  ensureDir(rawDir)
  ensureDir(normalizedDir)
  const modelSlug = slug(model)
  const rawTarget = path.join(rawDir, `${modelSlug}${path.extname(absoluteFile) || '.json'}`)
  if (fs.existsSync(rawTarget)) {
    throw new Error(`Refusing to overwrite existing raw output: ${rawTarget}`)
  }
  fs.copyFileSync(absoluteFile, rawTarget)
  const output = JSON.parse(readText(absoluteFile)) as unknown
  validateFactCheckOutput(output)
  const normalizedTarget = normalizedOutputFile(run, caseId, model)
  if (fs.existsSync(normalizedTarget)) {
    throw new Error(`Refusing to overwrite existing normalized output: ${normalizedTarget}`)
  }
  writeGenerated(
    normalizedTarget,
    JSON.stringify(
      {
        case_id: caseId,
        model,
        ingested_at: new Date().toISOString(),
        output,
      },
      null,
      2,
    ) + '\n',
  )
  return {
    raw_file: rawTarget,
    normalized_file: normalizedTarget,
  }
}

function validateFactCheckOutput(output: unknown): asserts output is FactCheckOutput {
  if (!isJsonObject(output)) {
    throw new Error('Fact Check output must be a JSON object')
  }
  if (output.probe !== 'fact_check') {
    throw new Error(`Fact Check output probe must be "fact_check", got "${output.probe}"`)
  }
  if (!Array.isArray(output.checked_issues)) {
    throw new Error('Fact Check output must contain checked_issues array')
  }
  for (const item of output.checked_issues) {
    if (!isJsonObject(item)) {
      throw new Error('Each checked issue must be a JSON object')
    }
    if (item.issue_id !== undefined && typeof item.issue_id !== 'string') {
      throw new Error(`Each checked issue issue_id must be a string for "${item.issue_title || 'unknown'}"`)
    }
    if (typeof item.source !== 'string' || !item.source || typeof item.issue_title !== 'string' || !item.issue_title) {
      throw new Error('Each checked issue must contain source and issue_title')
    }
    if (typeof item.status !== 'string') {
      throw new Error(`Invalid status for "${item.issue_title}": ${item.status}`)
    }
    if (!STATUSES.has(item.status)) {
      throw new Error(`Invalid status for "${item.issue_title}": ${item.status}`)
    }
    if (typeof item.evidence_status !== 'string') {
      throw new Error(`Invalid evidence_status for "${item.issue_title}": ${item.evidence_status}`)
    }
    if (!EVIDENCE_STATUSES.has(item.evidence_status)) {
      throw new Error(`Invalid evidence_status for "${item.issue_title}": ${item.evidence_status}`)
    }
    if (typeof item.claim_support !== 'string') {
      throw new Error(`Invalid claim_support for "${item.issue_title}": ${item.claim_support}`)
    }
    if (!CLAIM_SUPPORTS.has(item.claim_support)) {
      throw new Error(`Invalid claim_support for "${item.issue_title}": ${item.claim_support}`)
    }
  }
}

function textIssueKey(item: Pick<CaseIssue | FactCheckIssue, 'source' | 'issue_title'>): string {
  return checkedIssueKey(item.source, item.issue_title)
}

function hasExpectedStatus(item: CaseIssue): item is CaseIssue & { expected_status: string } {
  return typeof item.expected_status === 'string' && item.expected_status.length > 0
}

function expectedIssues(fixture: FactCheckCase): Array<CaseIssue & { expected_status: string }> {
  const missing = fixture.issues.filter((item) => !item.expected_status)
  if (missing.length) {
    throw new Error(
      [
        `Fact-check calibration case has ${missing.length} unlabeled issue(s).`,
        'Fill expected_status before scoring.',
        ...missing.slice(0, 10).map((item) => `- ${item.id}: ${item.source} / ${item.issue_title}`),
      ].join('\n'),
    )
  }
  const expected = fixture.issues.filter(hasExpectedStatus)
  for (const item of expected) {
    if (!STATUSES.has(item.expected_status)) {
      throw new Error(`Invalid expected_status for ${item.id}: ${item.expected_status}`)
    }
    if (item.expected_evidence_status && !EVIDENCE_STATUSES.has(item.expected_evidence_status)) {
      throw new Error(`Invalid expected_evidence_status for ${item.id}: ${item.expected_evidence_status}`)
    }
    if (item.expected_claim_support && !CLAIM_SUPPORTS.has(item.expected_claim_support)) {
      throw new Error(`Invalid expected_claim_support for ${item.id}: ${item.expected_claim_support}`)
    }
  }
  return expected
}

export function scoreOutput({ run, caseId, model }: ScoreOutputOptions): ScoreResult {
  const fixture = loadCase(caseId)
  const expected = expectedIssues(fixture)
  const normalized = parseJsonFile<NormalizedOutput>(normalizedOutputFile(run, caseId, model))
  const output = normalized.output
  validateFactCheckOutput(output)
  const actualById = new Map<string, FactCheckIssue>(
    output.checked_issues.filter((item) => item.issue_id).map((item) => [item.issue_id as string, item]),
  )
  const actualLegacyByText = new Map<string, FactCheckIssue>(
    output.checked_issues.filter((item) => !item.issue_id).map((item) => [textIssueKey(item), item]),
  )
  const expectedIds = new Set(expected.map((item) => item.id))
  const expectedTextKeys = new Set(expected.map(textIssueKey))
  const rows = expected.map((item): ScoreRow => {
    const actual = actualById.get(item.id) || actualLegacyByText.get(textIssueKey(item))
    return {
      id: item.id,
      source: item.source,
      issue_title: item.issue_title,
      actual_issue_id: actual?.issue_id || null,
      expected_status: item.expected_status,
      actual_status: actual?.status || 'missing',
      status_match: actual?.status === item.expected_status,
      expected_evidence_status: item.expected_evidence_status || null,
      actual_evidence_status: actual?.evidence_status || null,
      evidence_status_match: item.expected_evidence_status
        ? actual?.evidence_status === item.expected_evidence_status
        : null,
      expected_claim_support: item.expected_claim_support || null,
      actual_claim_support: actual?.claim_support || null,
      claim_support_match: item.expected_claim_support ? actual?.claim_support === item.expected_claim_support : null,
      reason: stringValue(actual?.reason),
    }
  })
  const extra = output.checked_issues.filter((item) => {
    if (item.issue_id) {
      return !expectedIds.has(item.issue_id)
    }
    return !expectedTextKeys.has(textIssueKey(item))
  })
  const challengedExpected = rows.filter((item) => item.expected_status !== 'verified')
  const challengedHits = challengedExpected.filter(
    (item) => item.actual_status !== 'verified' && item.actual_status !== 'missing',
  )
  const falseVerified = challengedExpected.filter((item) => item.actual_status === 'verified')
  const overChallenged = rows.filter(
    (item) => item.expected_status === 'verified' && !['verified', 'missing'].includes(item.actual_status),
  )
  const missing = rows.filter((item) => item.actual_status === 'missing')
  const statusMatches = rows.filter((item) => item.status_match).length
  const evidenceLabeled = rows.filter((item) => item.expected_evidence_status)
  const claimLabeled = rows.filter((item) => item.expected_claim_support)
  const score: ScoreResult = {
    run,
    case_id: caseId,
    model,
    scored_at: new Date().toISOString(),
    totals: {
      expected: rows.length,
      actual: output.checked_issues.length,
      extra: extra.length,
      missing: missing.length,
      status_matches: statusMatches,
      challenged_expected: challengedExpected.length,
      challenged_hits: challengedHits.length,
      false_verified: falseVerified.length,
      over_challenged: overChallenged.length,
    },
    metrics: {
      status_accuracy: rows.length ? Number((statusMatches / rows.length).toFixed(4)) : null,
      challenge_recall: challengedExpected.length
        ? Number((challengedHits.length / challengedExpected.length).toFixed(4))
        : null,
      evidence_status_accuracy: evidenceLabeled.length
        ? Number(
            (evidenceLabeled.filter((item) => item.evidence_status_match).length / evidenceLabeled.length).toFixed(4),
          )
        : null,
      claim_support_accuracy: claimLabeled.length
        ? Number((claimLabeled.filter((item) => item.claim_support_match).length / claimLabeled.length).toFixed(4))
        : null,
      extra_rate: output.checked_issues.length ? Number((extra.length / output.checked_issues.length).toFixed(4)) : 0,
      missing_rate: rows.length ? Number((missing.length / rows.length).toFixed(4)) : null,
    },
    rows,
    extra_issues: extra.map((item) => ({
      issue_id: item.issue_id || null,
      source: item.source,
      issue_title: item.issue_title,
      status: item.status,
    })),
  }
  const target = scoreFile(run, caseId, model)
  writeGenerated(target, JSON.stringify(score, null, 2) + '\n')
  return score
}

export function summarizeRun(run: string): FactCheckSummary {
  const runRoot = path.join(FACT_CHECK_ROOT, 'runs', run)
  const scores: ScoreResult[] = []
  if (fs.existsSync(runRoot)) {
    for (const caseEntry of fs.readdirSync(runRoot, { withFileTypes: true })) {
      if (!caseEntry.isDirectory()) {
        continue
      }
      const scoreDir = path.join(runRoot, caseEntry.name, 'scores')
      if (!fs.existsSync(scoreDir)) {
        continue
      }
      for (const scoreEntry of fs.readdirSync(scoreDir, { withFileTypes: true })) {
        if (scoreEntry.isFile() && scoreEntry.name.endsWith('.score.json')) {
          scores.push(parseJsonFile<ScoreResult>(path.join(scoreDir, scoreEntry.name)))
        }
      }
    }
  }
  const models = [...new Set<string>(scores.map((item) => item.model))].sort()
  const model_summaries = models
    .map((model): ModelSummary => {
      const rows = scores.filter((item) => item.model === model)
      return {
        model,
        cases: rows.map((item) => item.case_id).sort(),
        avg_status_accuracy: average(
          rows.map((item) => item.metrics.status_accuracy).filter((item): item is number => item !== null),
        ),
        avg_challenge_recall: average(
          rows.map((item) => item.metrics.challenge_recall).filter((item): item is number => item !== null),
        ),
        total_false_verified: rows.reduce((sum, item) => sum + item.totals.false_verified, 0),
        total_over_challenged: rows.reduce((sum, item) => sum + item.totals.over_challenged, 0),
        total_extra: rows.reduce((sum, item) => sum + item.totals.extra, 0),
        total_missing: rows.reduce((sum, item) => sum + item.totals.missing, 0),
      }
    })
    .sort(
      (a, b) =>
        (b.avg_status_accuracy ?? -1) - (a.avg_status_accuracy ?? -1) ||
        (b.avg_challenge_recall ?? -1) - (a.avg_challenge_recall ?? -1) ||
        a.total_false_verified - b.total_false_verified,
    )
  const summary: FactCheckSummary = {
    run,
    generated_at: new Date().toISOString(),
    scores,
    model_summaries,
    recommendation: model_summaries[0]?.model || null,
  }
  writeGenerated(path.join(FACT_CHECK_ROOT, 'outputs', `${run}.summary.json`), JSON.stringify(summary, null, 2) + '\n')
  writeGenerated(path.join(FACT_CHECK_ROOT, 'outputs', `${run}.summary.md`), renderSummary(summary))
  return summary
}

function average(values: number[]): number | null {
  if (!values.length) {
    return null
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '-' : `${Math.round(value * 100)}%`
}

function renderSummary(summary: FactCheckSummary): string {
  const lines: string[] = []
  lines.push('# Fact Check Calibration Summary', '')
  lines.push(`- Run ID: ${summary.run}`)
  lines.push(`- Scores: ${summary.scores.length}`)
  lines.push(`- Recommendation: ${summary.recommendation || 'TBD'}`, '')
  lines.push(
    '| Model | Cases | Status Accuracy | Challenge Recall | False Verified | Over Challenged | Extra | Missing |',
  )
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const item of summary.model_summaries) {
    lines.push(
      `| ${item.model} | ${item.cases.length} | ${pct(item.avg_status_accuracy)} | ${pct(item.avg_challenge_recall)} | ${item.total_false_verified} | ${item.total_over_challenged} | ${item.total_extra} | ${item.total_missing} |`,
    )
  }
  if (!summary.model_summaries.length) {
    lines.push('| - | 0 | - | - | - | - | - | - |')
  }
  lines.push('')
  return lines.join('\n')
}
