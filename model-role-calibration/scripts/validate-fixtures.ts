#!/usr/bin/env node

import fs = require('node:fs')
import path = require('node:path')

type JsonObject = Record<string, any>

interface CalibrationConfig {
  models: string[]
  primary_cases: string[]
  role_recommendation: {
    minimum_comparable_models: number
    minimum_average_score: number
    minimum_case_score: number
    maximum_standard_deviation: number
    [key: string]: unknown
  }
  probe_concurrency_overrides?: Record<string, unknown>
  agent_execution: Record<string, unknown>
}

interface ValidationError {
  path?: string
  message?: string
}

interface ValidationResult {
  valid: boolean
  stage?: string
  errors?: ValidationError[]
}

const { ROOT, PROBES, loadCaseInput, parseJsonFile, loadConfig, schemaForProbe, slug } = require('./lib') as {
  ROOT: string
  PROBES: string[]
  loadCaseInput(caseId: string, probe: string): string
  parseJsonFile<T = unknown>(file: string): T
  loadConfig(): CalibrationConfig
  schemaForProbe(probe: string): string
  slug(value: string): string
}

const { validateJsonText } = require('./json-validator-mcp') as {
  validateJsonText(candidateText: string, schema?: unknown): ValidationResult
}

const SYNTHESIS_SOURCE_BY_PROBE: Record<string, string> = {
  risk: 'Risk Reviewer',
  architecture: 'Architecture Reviewer',
  execution: 'Execution Reviewer',
  rebuttal: 'Rebuttal Reviewer',
}

const DEFAULT_ROUTE_ROLES = ['risk', 'architecture', 'execution', 'rebuttal', 'fact_check', 'synthesis', 'planner']

function listDirectories(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return []
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function jsonCodeBlocks(markdown: string, caseId: string): JsonObject[] {
  const blocks: JsonObject[] = []
  const pattern = /```json\s*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown)) !== null) {
    try {
      blocks.push(JSON.parse(match[1]))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Invalid JSON block in ${caseId} synthesis input: ${message}`)
    }
  }
  return blocks
}

function assertSchema(value: unknown, schemaFile: string, label: string): void {
  const validation = validateJsonText(JSON.stringify(value), parseJsonFile(schemaFile))
  if (!validation.valid) {
    const details = (validation.errors || [])
      .slice(0, 5)
      .map((item) => `${item.path}: ${item.message}`)
      .join('; ')
    throw new Error(`${label} does not match schema: ${details || validation.stage}`)
  }
}

function validateSynthesisFixture(caseId: string, input: string): void {
  const blocks = jsonCodeBlocks(input, caseId)
  const reviewerOutputs = blocks.filter((item) => SYNTHESIS_SOURCE_BY_PROBE[item?.probe])
  const factCheck = blocks.find((item) => item?.probe === 'fact_check')
  if (!reviewerOutputs.length) {
    throw new Error(`Missing Reviewer JSON blocks in ${caseId} synthesis input`)
  }
  if (!factCheck) {
    throw new Error(`Missing Fact Check JSON block in ${caseId} synthesis input`)
  }

  for (const output of reviewerOutputs) {
    assertSchema(output, schemaForProbe(output.probe), `${caseId}/${output.probe}`)
  }
  assertSchema(factCheck, path.join(ROOT, 'schemas', 'fact-check-output.schema.json'), `${caseId}/fact_check`)

  const expectedIssues = reviewerOutputs.flatMap((output) => {
    const source = SYNTHESIS_SOURCE_BY_PROBE[output.probe]
    return (output.issues || []).map((issue: JsonObject, index: number) => ({
      issue_id: `${slug(source)}-${String(index + 1).padStart(3, '0')}`,
      source,
      issue_title: issue.title,
    }))
  })
  const checkedIssues: JsonObject[] = factCheck.checked_issues || []
  if (checkedIssues.length !== expectedIssues.length) {
    throw new Error(`${caseId} Fact Check covers ${checkedIssues.length} issue(s), expected ${expectedIssues.length}`)
  }
  const checkedById = new Map<string, JsonObject>(checkedIssues.map((item) => [item.issue_id, item]))
  for (const expected of expectedIssues) {
    const checked = checkedById.get(expected.issue_id)
    if (!checked) {
      throw new Error(`${caseId} Fact Check missing issue_id ${expected.issue_id}`)
    }
    if (checked.source !== expected.source || checked.issue_title !== expected.issue_title) {
      throw new Error(`${caseId} Fact Check identity mismatch for ${expected.issue_id}`)
    }
  }

  for (const source of new Set(expectedIssues.map((item) => item.source))) {
    const sourceIssues = checkedIssues.filter((item: JsonObject) => item.source === source)
    const summary = (factCheck.source_summaries || []).find((item: JsonObject) => item.source === source)
    if (!summary) {
      throw new Error(`${caseId} Fact Check missing source summary for ${source}`)
    }
    const statusCounts = Object.fromEntries(
      ['verified', 'partially_verified', 'unsupported', 'contradicted', 'unverifiable'].map((status) => [
        status,
        sourceIssues.filter((item: JsonObject) => item.status === status).length,
      ]),
    )
    if (
      summary.total_issues !== sourceIssues.length ||
      Object.entries(statusCounts).some(([status, count]) => summary[status] !== count)
    ) {
      throw new Error(`${caseId} Fact Check source summary mismatch for ${source}`)
    }
  }
}

function main(): void {
  const schemaDir = path.join(ROOT, 'schemas')
  const schemaFiles = fs
    .readdirSync(schemaDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
  for (const file of schemaFiles) {
    parseJsonFile(path.join(schemaDir, file))
  }

  const syntheticDir = path.join(ROOT, 'cases', 'synthetic')
  const cases = listDirectories(syntheticDir)
  if (!cases.length) {
    throw new Error('No synthetic calibration cases found')
  }

  for (const caseName of cases) {
    const caseId = `synthetic/${caseName}`
    const rubric = path.join(syntheticDir, caseName, 'rubric.md')
    if (!fs.existsSync(rubric)) {
      throw new Error(`Missing case rubric: ${rubric}`)
    }
    for (const probe of PROBES) {
      const input = loadCaseInput(caseId, probe)
      if (!input.trim()) {
        throw new Error(`Empty ${probe} input for ${caseId}`)
      }
      if (probe === 'synthesis') {
        validateSynthesisFixture(caseId, input)
      }
    }
  }

  const config = loadConfig()
  const defaultRoutes = parseJsonFile<JsonObject>(path.join(ROOT, 'default-role-routes.json'))
  if (defaultRoutes.version !== 1) {
    throw new Error('default-role-routes.json must use version 1')
  }
  if (!defaultRoutes.source?.run_id || !defaultRoutes.source?.score_version) {
    throw new Error('default-role-routes.json must include source.run_id and source.score_version')
  }
  for (const role of DEFAULT_ROUTE_ROLES) {
    const model = defaultRoutes.routes?.[role]
    if (!model || !config.models.includes(model)) {
      throw new Error(`default-role-routes.json routes.${role} must reference a configured model`)
    }
  }
  for (const caseId of config.primary_cases) {
    if (!fs.existsSync(path.join(ROOT, 'cases', caseId))) {
      throw new Error(`Missing configured primary case: ${caseId}`)
    }
  }
  if (new Set(config.models).size !== config.models.length || !config.models.length) {
    throw new Error('Configured models must be a non-empty unique list')
  }
  if (config.role_recommendation.minimum_comparable_models < 2) {
    throw new Error('minimum_comparable_models must be at least 2')
  }
  for (const key of ['minimum_average_score', 'minimum_case_score']) {
    const value = config.role_recommendation[key]
    if (typeof value !== 'number' || value < 0 || value > 25) {
      throw new Error(`role_recommendation.${key} must be between 0 and 25`)
    }
  }
  if (
    typeof config.role_recommendation.maximum_standard_deviation !== 'number' ||
    config.role_recommendation.maximum_standard_deviation < 0
  ) {
    throw new Error('role_recommendation.maximum_standard_deviation must be a non-negative number')
  }
  if (
    config.probe_concurrency_overrides !== undefined &&
    (!config.probe_concurrency_overrides ||
      typeof config.probe_concurrency_overrides !== 'object' ||
      Array.isArray(config.probe_concurrency_overrides))
  ) {
    throw new Error('probe_concurrency_overrides must be an object')
  }
  for (const [probe, value] of Object.entries(config.probe_concurrency_overrides || {})) {
    if (!PROBES.includes(probe)) {
      throw new Error(`probe_concurrency_overrides.${probe} is not a known probe`)
    }
    if (!Number.isInteger(value) || (value as number) <= 0) {
      throw new Error(`probe_concurrency_overrides.${probe} must be a positive integer`)
    }
  }
  for (const key of ['timeout_ms', 'alias_resolution_timeout_ms', 'max_buffer_bytes']) {
    if (!Number.isInteger(config.agent_execution?.[key]) || (config.agent_execution[key] as number) <= 0) {
      throw new Error(`agent_execution.${key} must be a positive integer`)
    }
  }

  console.log(`Validated ${schemaFiles.length} schemas, ${cases.length} synthetic cases, and calibration config`)
}

main()
