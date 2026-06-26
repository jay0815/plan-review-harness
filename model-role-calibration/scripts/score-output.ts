#!/usr/bin/env node

import * as path from 'node:path'

import {
  ROOT,
  assertProbe,
  assertSafeCaseId,
  optionalSlugArg,
  parseArgs,
  requireArg,
  slug,
  writeFileNew,
} from './lib.js'

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
