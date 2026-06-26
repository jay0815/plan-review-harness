#!/usr/bin/env node

import path = require('node:path')

type ArgValue = string | true | undefined
type ParsedArgs = Record<string, ArgValue>

interface ScoreTemplate {
  case_id: string
  model: string
  probe: string
  score_version?: string
  score: {
    hit_rate: number
    contract_closure: number
    actionability: number
    evidence_discipline: number
    false_positive_cost: number
  }
  total: number
  matched_known_issues: unknown[]
  missed_known_issues: unknown[]
  valuable_new_findings: unknown[]
  false_positives: unknown[]
  failure_modes: unknown[]
  notes: string
  suggested_roles: unknown[]
  unsuitable_roles: unknown[]
}

const { ROOT, parseArgs, requireArg, assertSafeCaseId, assertProbe, writeFileNew, slug, optionalSlugArg } =
  require('./lib') as {
    ROOT: string
    parseArgs(argv: string[]): ParsedArgs
    requireArg(args: ParsedArgs, name: string): string
    assertSafeCaseId(caseId: string): void
    assertProbe(probe: string): void
    writeFileNew(file: string, content: string): void
    slug(value: string): string
    optionalSlugArg(args: ParsedArgs, name: string): string | null
  }

function main(): void {
  const args = parseArgs(process.argv)
  const run = requireArg(args, 'run')
  const caseId = requireArg(args, 'case')
  const model = requireArg(args, 'model')
  const probe = requireArg(args, 'probe')
  const scoreVersion = optionalSlugArg(args, 'score-version')
  assertSafeCaseId(caseId)
  assertProbe(probe)

  const score: ScoreTemplate = {
    case_id: caseId,
    model,
    probe,
    ...(scoreVersion ? { score_version: scoreVersion } : {}),
    score: {
      hit_rate: 0,
      contract_closure: 0,
      actionability: 0,
      evidence_discipline: 0,
      false_positive_cost: 0,
    },
    total: 0,
    matched_known_issues: [],
    missed_known_issues: [],
    valuable_new_findings: [],
    false_positives: [],
    failure_modes: [],
    notes: '',
    suggested_roles: [],
    unsuitable_roles: [],
  }

  const target = path.join(
    ROOT,
    'runs',
    run,
    caseId,
    'scores',
    ...(scoreVersion ? ['versions', scoreVersion] : []),
    `${slug(model)}-${probe}.score.json`,
  )
  writeFileNew(target, JSON.stringify(score, null, 2) + '\n')
  console.log(`Created score file: ${target}`)
}

main()
