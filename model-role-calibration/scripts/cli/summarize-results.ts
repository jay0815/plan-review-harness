#!/usr/bin/env node

import * as path from 'node:path'

import {
  ROOT,
  isMainScript,
  loadConfig,
  optionalSlugArg,
  parseArgs,
  parseJsonFile,
  requireArg,
  sumScore,
  walk,
  writeGenerated,
} from '../lib/lib.js'

type Probe = 'planner' | 'risk' | 'architecture' | 'execution' | 'rebuttal' | 'synthesis'
type RoleName = 'A Planner' | 'D Risk Reviewer' | 'B Architecture Reviewer' | 'C Execution Reviewer' | 'S Synthesizer'

interface RecommendationConfig {
  minimum_average_score: number
  minimum_case_score: number
  maximum_standard_deviation: number
  minimum_comparable_models: number
}

interface CalibrationConfig {
  primary_cases: string[]
  role_recommendation: RecommendationConfig
}

interface ScoreStats {
  count: number
  average: number | null
  minimum: number | null
  maximum: number | null
  range: number | null
  standard_deviation: number | null
}

interface ScoreFile {
  case_id: string
  model: string
  probe: Probe
  score?: Record<string, unknown>
  total?: number | string
  suggested_roles?: string[]
  unsuitable_roles?: string[]
  failure_modes?: string[]
  [key: string]: unknown
}

interface NormalizedScore extends ScoreFile {
  total: number
  score_file: string
}

interface ModelStats {
  model: string
  byProbeCase: Partial<Record<Probe, Record<string, number>>>
  suggested_roles: string[]
  unsuitable_roles: string[]
  failure_modes: string[]
  failure_modes_by_probe: Partial<Record<Probe, string[]>>
}

interface RecommendationCandidate {
  model: string
  avg: number | null
  stats: ScoreStats
  stability_failures: string[]
  covered_cases: number
  missing_cases: string[]
  failure_modes: string[]
}

type ComparableCandidate = RecommendationCandidate & { avg: number }
type RecommendationStatus = 'insufficient_coverage' | 'below_quality_threshold' | 'candidate' | 'unstable'

interface RoleRecommendation {
  role: RoleName
  probe: Probe
  status: RecommendationStatus
  recommended: string | null
  recommended_score?: number | null
  backup: string | null
  backup_score?: number | null
  avoid: string[]
  required_cases: string[]
  comparable_models: number
  minimum_comparable_models: number
  minimum_average_score: number
  minimum_case_score: number
  maximum_standard_deviation: number
  top_score: number | null
  top_model: string | null
  top_stability: ScoreStats | null
  recommended_stability?: ScoreStats | null
  backup_stability?: ScoreStats | null
  stability_failures: string[]
  failure_modes?: string[]
}

interface ModelProbeAverage {
  model: string
  averages: Record<Probe, number | null>
  coverage: Record<Probe, string[]>
  stability: Record<Probe, ScoreStats>
  suggested_roles: string[]
  unsuitable_roles: string[]
  failure_modes: string[]
  failure_modes_by_probe: Partial<Record<Probe, string[]>>
}

interface SummaryResults {
  run: string
  score_version?: string
  generated_at: string
  cases: string[]
  models: string[]
  probes: Probe[]
  primary_cases: string[]
  scores: NormalizedScore[]
  model_probe_averages: ModelProbeAverage[]
  role_recommendations: RoleRecommendation[]
}

const PROBE_COLUMNS: Probe[] = ['planner', 'risk', 'architecture', 'execution', 'rebuttal', 'synthesis']
const ROLE_BY_PROBE: Partial<Record<Probe, RoleName>> = {
  planner: 'A Planner',
  risk: 'D Risk Reviewer',
  architecture: 'B Architecture Reviewer',
  execution: 'C Execution Reviewer',
  synthesis: 'S Synthesizer',
}

function average(values: number[]): number | null {
  if (!values.length) {
    return null
  }
  return values.reduce((total, value) => total + value, 0) / values.length
}

function scoreStats(values: number[]): ScoreStats {
  if (!values.length) {
    return {
      count: 0,
      average: null,
      minimum: null,
      maximum: null,
      range: null,
      standard_deviation: null,
    }
  }
  const avg = average(values) as number
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const variance = average(values.map((value) => (value - avg) ** 2)) as number
  return {
    count: values.length,
    average: avg,
    minimum,
    maximum,
    range: maximum - minimum,
    standard_deviation: Math.sqrt(variance),
  }
}

function pushUnique(list: string[], values?: string[]): void {
  for (const value of values || []) {
    if (value && !list.includes(value)) {
      list.push(value)
    }
  }
}

function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? '-' : value.toFixed(1)
}

function formatProbeCell(item: ModelProbeAverage, probe: Probe, requiredCount: number): string {
  const coverage = item.coverage[probe].length
  const stability = item.stability?.[probe]
  if (!stability || stability.minimum === null) {
    return `${formatScore(item.averages[probe])} (${coverage}/${requiredCount})`
  }
  return [
    `${formatScore(item.averages[probe])} (${coverage}/${requiredCount}`,
    `min ${formatScore(stability.minimum)}`,
    `σ ${formatScore(stability.standard_deviation)})`,
  ].join('; ')
}

export function listScoreFiles(runDir: string, scoreVersion: string | null = null): string[] {
  const draftsSegment = `${path.sep}scores${path.sep}drafts${path.sep}`
  const versionsSegment = `${path.sep}scores${path.sep}versions${path.sep}`
  if (scoreVersion) {
    const versionSegment = `${versionsSegment}${scoreVersion}${path.sep}`
    return walk(runDir, (file) => file.endsWith('.score.json') && file.includes(versionSegment))
  }
  return walk(
    runDir,
    (file) => file.endsWith('.score.json') && !file.includes(draftsSegment) && !file.includes(versionsSegment),
  )
}

export function listVersionedScoreFiles(runDir: string): string[] {
  const versionsSegment = `${path.sep}scores${path.sep}versions${path.sep}`
  return walk(runDir, (file) => file.endsWith('.score.json') && file.includes(versionsSegment))
}

export function roleRecommendation(
  probe: Probe,
  modelStats: ModelStats[],
  config: CalibrationConfig,
): RoleRecommendation | null {
  const role = ROLE_BY_PROBE[probe]
  if (!role) {
    return null
  }
  const requiredCases = config.primary_cases
  const recommendationConfig = config.role_recommendation
  const candidates: ComparableCandidate[] = modelStats
    .map((item) => {
      const scoresByCase = item.byProbeCase[probe] || {}
      const missingCases = requiredCases.filter((caseId) => scoresByCase[caseId] === undefined)
      const values = requiredCases
        .map((caseId) => scoresByCase[caseId])
        .filter((value): value is number => value !== undefined)
      const stats = scoreStats(values)
      const stabilityFailures: string[] = []
      if (!missingCases.length && stats.minimum! < recommendationConfig.minimum_case_score) {
        stabilityFailures.push('minimum_case_score')
      }
      if (!missingCases.length && stats.standard_deviation! > recommendationConfig.maximum_standard_deviation) {
        stabilityFailures.push('maximum_standard_deviation')
      }
      return {
        model: item.model,
        avg: missingCases.length ? null : stats.average,
        stats,
        stability_failures: stabilityFailures,
        covered_cases: requiredCases.length - missingCases.length,
        missing_cases: missingCases,
        failure_modes: item.failure_modes_by_probe?.[probe] || [],
      }
    })
    .filter((item): item is ComparableCandidate => item.avg !== null)
    .sort((a, b) => b.avg - a.avg)

  const minimumComparableModels = recommendationConfig.minimum_comparable_models
  if (candidates.length < minimumComparableModels) {
    return {
      role,
      probe,
      status: 'insufficient_coverage',
      recommended: null,
      backup: null,
      avoid: [],
      required_cases: requiredCases,
      comparable_models: candidates.length,
      minimum_comparable_models: minimumComparableModels,
      minimum_average_score: recommendationConfig.minimum_average_score,
      minimum_case_score: recommendationConfig.minimum_case_score,
      maximum_standard_deviation: recommendationConfig.maximum_standard_deviation,
      top_score: candidates[0]?.avg ?? null,
      top_model: candidates[0]?.model ?? null,
      top_stability: candidates[0]?.stats ?? null,
      stability_failures: candidates[0]?.stability_failures ?? [],
    }
  }

  const averageQualified = candidates.filter((item) => item.avg >= recommendationConfig.minimum_average_score)
  const qualified = averageQualified.filter((item) => item.stability_failures.length === 0)
  const top = candidates[0]
  const recommended = qualified[0] || null
  const backup = qualified[1] || null
  const avoid = candidates.filter((item) => item.avg < 12.5).map((item) => item.model)
  const status: RecommendationStatus = !averageQualified.length
    ? 'below_quality_threshold'
    : recommended
      ? 'candidate'
      : 'unstable'
  const stabilityReference = recommended || averageQualified[0] || top

  return {
    role,
    probe,
    status,
    recommended: recommended?.model || null,
    recommended_score: recommended?.avg ?? null,
    backup: backup ? backup.model : null,
    backup_score: backup ? backup.avg : null,
    avoid,
    required_cases: requiredCases,
    comparable_models: candidates.length,
    minimum_comparable_models: minimumComparableModels,
    minimum_average_score: recommendationConfig.minimum_average_score,
    minimum_case_score: recommendationConfig.minimum_case_score,
    maximum_standard_deviation: recommendationConfig.maximum_standard_deviation,
    top_score: top.avg,
    top_model: top.model,
    top_stability: top.stats,
    recommended_stability: recommended?.stats || null,
    backup_stability: backup ? backup.stats : null,
    stability_failures: stabilityReference.stability_failures,
    failure_modes: stabilityReference.failure_modes || [],
  }
}

function main(): void {
  const args = parseArgs(process.argv)
  const run = requireArg(args, 'run')
  const config = loadConfig<CalibrationConfig>()
  const runDir = path.join(ROOT, 'runs', run)
  const scoreVersion = optionalSlugArg(args, 'score-version')
  const scoreFiles = listScoreFiles(runDir, scoreVersion)
  if (!scoreVersion && !scoreFiles.length && listVersionedScoreFiles(runDir).length) {
    throw new Error(
      'No unversioned score files found, but versioned scores exist. ' +
        'Pass --score-version <version> to summarize them.',
    )
  }
  const scores: NormalizedScore[] = scoreFiles.map((file) => {
    const data = parseJsonFile<ScoreFile>(file)
    const computedTotal = sumScore(data.score || {})
    return {
      ...data,
      total: Number(data.total || computedTotal),
      score_file: path.relative(ROOT, file),
    }
  })

  const cases = [...new Set(scores.map((item) => item.case_id))].sort()
  const models = [...new Set(scores.map((item) => item.model))].sort()
  const probes = [...new Set(scores.map((item) => item.probe))].sort()
  const seen = new Set<string>()
  for (const score of scores) {
    const key = `${score.case_id}\u0000${score.model}\u0000${score.probe}`
    if (seen.has(key)) {
      throw new Error(`Duplicate score for ${score.case_id}/${score.model}/${score.probe}`)
    }
    seen.add(key)
  }

  const modelStats: ModelStats[] = models.map((model) => {
    const rows = scores.filter((item) => item.model === model)
    const byProbeCase: Partial<Record<Probe, Record<string, number>>> = {}
    const suggested_roles: string[] = []
    const unsuitable_roles: string[] = []
    const failure_modes: string[] = []
    const failure_modes_by_probe: Partial<Record<Probe, string[]>> = {}
    for (const row of rows) {
      const probeCases = (byProbeCase[row.probe] ??= {})
      probeCases[row.case_id] = row.total
      pushUnique(suggested_roles, row.suggested_roles)
      pushUnique(unsuitable_roles, row.unsuitable_roles)
      pushUnique(failure_modes, row.failure_modes)
      const probeFailureModes = (failure_modes_by_probe[row.probe] ??= [])
      pushUnique(probeFailureModes, row.failure_modes)
    }
    return {
      model,
      byProbeCase,
      suggested_roles,
      unsuitable_roles,
      failure_modes,
      failure_modes_by_probe,
    }
  })

  const roleRecommendations = (['planner', 'architecture', 'execution', 'risk', 'synthesis'] as Probe[])
    .map((probe) => roleRecommendation(probe, modelStats, config))
    .filter((item): item is RoleRecommendation => Boolean(item))

  const results: SummaryResults = {
    run,
    ...(scoreVersion ? { score_version: scoreVersion } : {}),
    generated_at: new Date().toISOString(),
    cases,
    models,
    probes,
    primary_cases: config.primary_cases,
    scores,
    model_probe_averages: modelStats.map((item) => ({
      model: item.model,
      averages: Object.fromEntries(
        PROBE_COLUMNS.map((probe) => [
          probe,
          average(
            config.primary_cases
              .map((caseId) => item.byProbeCase[probe]?.[caseId])
              .filter((value): value is number => value !== undefined),
          ),
        ]),
      ) as Record<Probe, number | null>,
      coverage: Object.fromEntries(
        PROBE_COLUMNS.map((probe) => [
          probe,
          config.primary_cases.filter((caseId) => item.byProbeCase[probe]?.[caseId] !== undefined),
        ]),
      ) as Record<Probe, string[]>,
      stability: Object.fromEntries(
        PROBE_COLUMNS.map((probe) => [
          probe,
          scoreStats(
            config.primary_cases
              .map((caseId) => item.byProbeCase[probe]?.[caseId])
              .filter((value): value is number => value !== undefined),
          ),
        ]),
      ) as Record<Probe, ScoreStats>,
      suggested_roles: item.suggested_roles,
      unsuitable_roles: item.unsuitable_roles,
      failure_modes: item.failure_modes,
      failure_modes_by_probe: item.failure_modes_by_probe,
    })),
    role_recommendations: roleRecommendations,
  }

  writeGenerated(path.join(ROOT, 'outputs', 'calibration-results.json'), JSON.stringify(results, null, 2) + '\n')
  writeGenerated(path.join(ROOT, 'outputs', 'calibration-summary.md'), renderSummary(results))
  writeGenerated(path.join(ROOT, 'outputs', 'model-role-map.md'), renderRoleMap(results))

  console.log(`Scores read: ${scores.length}`)
  if (scoreVersion) {
    console.log(`Score version: ${scoreVersion}`)
  }
  console.log('Generated outputs/calibration-results.json')
  console.log('Generated outputs/calibration-summary.md')
  console.log('Generated outputs/model-role-map.md')
}

function renderSummary(results: SummaryResults): string {
  const lines: string[] = []
  lines.push('# Calibration Summary', '')
  lines.push('## Run Info', '')
  lines.push(`- Run ID: ${results.run}`)
  lines.push(`- Cases: ${results.cases.length ? results.cases.join(', ') : 'None'}`)
  lines.push(`- Models: ${results.models.length ? results.models.join(', ') : 'None'}`)
  lines.push(`- Probes: ${results.probes.length ? results.probes.join(', ') : 'None'}`, '')
  lines.push(`- Required comparable cases: ${results.primary_cases.join(', ')}`, '')
  lines.push('## Overall Observations', '')
  lines.push(
    results.scores.length
      ? '- Fill this section after reviewing the aggregate scores.'
      : '- No score files were found for this run.',
  )
  lines.push('', '## Model Comparison', '')
  lines.push('| Model | Planner | Risk | Architecture | Execution | Rebuttal | Synthesis | Notes |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|')
  for (const item of results.model_probe_averages) {
    const count = results.primary_cases.length
    const failureModesByProbe = item.failure_modes_by_probe as Record<string, string[]> | undefined
    const roleModes = PROBE_COLUMNS.filter((probe) => failureModesByProbe?.[probe]?.length)
      .map((probe) => `${probe}: ${failureModesByProbe?.[probe]?.join('; ')}`)
      .join(' | ')
    lines.push(
      `| ${item.model} | ${formatProbeCell(item, 'planner', count)} | ${formatProbeCell(item, 'risk', count)} | ${formatProbeCell(item, 'architecture', count)} | ${formatProbeCell(item, 'execution', count)} | ${formatProbeCell(item, 'rebuttal', count)} | ${formatProbeCell(item, 'synthesis', count)} | ${roleModes} |`,
    )
  }
  if (!results.model_probe_averages.length) {
    lines.push('| - | - | - | - | - | - | - | No scores yet |')
  }
  lines.push('', '## Key Findings', '')
  lines.push('- TBD')
  lines.push('', '## Common Failure Modes', '')
  const modes = [...new Set(results.model_probe_averages.flatMap((item) => item.failure_modes))]
  if (modes.length) {
    modes.forEach((mode) => lines.push(`- ${mode}`))
  } else {
    lines.push('- TBD')
  }
  lines.push('', '## Recommended Next Step', '')
  lines.push('- Continue filling score files until each role has enough evidence for a stable assignment.')
  lines.push('')
  return lines.join('\n')
}

function renderRoleSection(title: string, rec: RoleRecommendation | undefined): string[] {
  const lines: string[] = []
  lines.push(`### ${title}`, '')
  if (!rec || rec.status !== 'candidate') {
    lines.push('Recommended model:')
    if (rec?.status === 'below_quality_threshold') {
      lines.push('- 质量未达到门槛，暂不建议固定该角色。', '')
    } else if (rec?.status === 'unstable') {
      lines.push('- 跨 Case 稳定性未达到门槛，暂不建议固定该角色。', '')
    } else {
      lines.push('- 覆盖不足，暂不建议固定该角色。', '')
    }
    lines.push('Why:')
    if (rec) {
      lines.push(
        `- Comparable models with complete ${rec.required_cases.length}-case coverage: ${rec.comparable_models} / required ${rec.minimum_comparable_models}.`,
      )
      if (rec.status === 'below_quality_threshold') {
        lines.push(
          `- Highest comparable model is ${rec.top_model}; average ${formatScore(rec.top_score)} / 25, required ${formatScore(rec.minimum_average_score)}.`,
        )
        if (rec.top_stability) {
          lines.push(
            `- Case stability: min ${formatScore(rec.top_stability.minimum)}, max ${formatScore(rec.top_stability.maximum)}, σ ${formatScore(rec.top_stability.standard_deviation)}.`,
          )
        }
      } else if (rec.status === 'unstable') {
        lines.push(`- Highest average-qualified model is ${rec.top_model}; average ${formatScore(rec.top_score)} / 25.`)
        lines.push(
          `- Case stability: min ${formatScore(rec.top_stability?.minimum)} / required ${formatScore(rec.minimum_case_score)}, σ ${formatScore(rec.top_stability?.standard_deviation)} / allowed ${formatScore(rec.maximum_standard_deviation)}.`,
        )
      }
      lines.push('')
    } else {
      lines.push('- Current calibration data is not strong enough for a stable assignment.', '')
    }
    lines.push('Backup:')
    lines.push(`- ${rec?.backup || 'TBD'}`, '')
    lines.push('Avoid:')
    lines.push(rec?.avoid?.length ? rec.avoid.map((item) => `- ${item}`).join('\n') : '- TBD')
    lines.push('', 'Failure modes to watch:')
    lines.push(rec?.failure_modes?.length ? rec.failure_modes.map((item) => `- ${item}`).join('\n') : '- TBD', '')
    lines.push('---', '')
    return lines
  }
  lines.push('Recommended model:')
  lines.push(`- ${rec.recommended}`, '')
  lines.push('Why:')
  lines.push(
    `- Average ${rec.probe} score across the same ${rec.required_cases.length} required cases: ${formatScore(rec.recommended_score)} / 25.`,
  )
  if (rec.recommended_stability) {
    lines.push(
      `- Case stability: min ${formatScore(rec.recommended_stability.minimum)}, max ${formatScore(rec.recommended_stability.maximum)}, σ ${formatScore(rec.recommended_stability.standard_deviation)}.`,
    )
    lines.push(
      `- Stability gates: min case >= ${formatScore(rec.minimum_case_score)}, σ <= ${formatScore(rec.maximum_standard_deviation)}.`,
    )
  }
  lines.push(`- Compared against ${rec.comparable_models} models with complete matching coverage.`, '')
  lines.push('Backup:')
  lines.push(`- ${rec.backup || 'TBD'}`, '')
  lines.push('Avoid:')
  lines.push(rec.avoid.length ? rec.avoid.map((item) => `- ${item}`).join('\n') : '- TBD')
  lines.push('', 'Failure modes to watch:')
  lines.push(rec.failure_modes?.length ? rec.failure_modes.map((item) => `- ${item}`).join('\n') : '- TBD')
  lines.push('', '---', '')
  return lines
}

function renderRoleMap(results: SummaryResults): string {
  const byRole = Object.fromEntries(results.role_recommendations.map((rec) => [rec.role, rec])) as Partial<
    Record<RoleName, RoleRecommendation>
  >
  const lines: string[] = []
  lines.push('# Model Role Map', '')
  lines.push('## Default Assignment', '')
  lines.push(...renderRoleSection('A Planner', byRole['A Planner']))
  lines.push(...renderRoleSection('B Architecture Reviewer', byRole['B Architecture Reviewer']))
  lines.push(...renderRoleSection('C Execution Reviewer', byRole['C Execution Reviewer']))
  lines.push(...renderRoleSection('D Risk Reviewer', byRole['D Risk Reviewer']))
  lines.push(...renderRoleSection('S Synthesizer', byRole['S Synthesizer']))
  lines.push('## Notes', '')
  lines.push('- This is not a global model ranking.')
  lines.push("- This mapping only applies to the user's current planning/review task domain.")
  lines.push('- Re-run calibration when task domain changes significantly.')
  lines.push('- Rebuttal is treated as a cross-role critical-reasoning signal, not a standalone assignment.')
  lines.push('')
  return lines.join('\n')
}

if (isMainScript(__filename)) {
  main()
}
