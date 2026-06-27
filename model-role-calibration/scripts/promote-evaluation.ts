#!/usr/bin/env node

import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  evaluationPaths as evaluationPathsTyped,
  hashText,
  parseList as parseListTyped,
  validateEvaluationScore as validateEvaluationScoreTyped,
} from './evaluation-lib.js'
import {
  ROOT,
  assertProbe,
  assertSafeCaseId,
  type ArgValue,
  isMainScript,
  loadConfig,
  parseArgs,
  parseJsonFile,
  requireArg,
  timestamp,
  writeFileNew,
} from './lib.js'

interface CalibrationConfig {
  models: string[]
  [key: string]: unknown
}

interface EvaluationPaths {
  draftFile: string
  formalFile: string
  decisionsDir: string
}

interface EvaluationScore {
  total: number
  [key: string]: unknown
}

interface PendingPromotion {
  model: string
  paths: EvaluationPaths
  score: EvaluationScore
}

const parseList = parseListTyped as (value: ArgValue, fallback: string[]) => string[]
const evaluationPaths = evaluationPathsTyped as (
  run: string,
  caseId: string,
  model: string,
  probe: string,
) => EvaluationPaths
const validateEvaluationScore = validateEvaluationScoreTyped as unknown as (
  score: EvaluationScore,
  expected: { case_id: string; model: string; probe: string },
) => void

function main(): void {
  const args = parseArgs(process.argv)
  const run = requireArg(args, 'run')
  const caseId = requireArg(args, 'case')
  const probe = requireArg(args, 'probe')
  assertSafeCaseId(caseId)
  assertProbe(probe)
  if (!args.confirmed) {
    throw new Error('Refusing promotion without explicit --confirmed')
  }

  const config = loadConfig<CalibrationConfig>()
  const models = parseList(args.models, config.models).map((item: any) => item.toLowerCase())
  const pending: PendingPromotion[] = models.map((model: any) => {
    if (!config.models.includes(model)) {
      throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`)
    }
    const paths = evaluationPaths(run, caseId, model, probe)
    if (!fs.existsSync(paths.draftFile)) {
      throw new Error(`Missing draft score: ${paths.draftFile}`)
    }
    if (fs.existsSync(paths.formalFile)) {
      throw new Error(`Refusing to overwrite formal score: ${paths.formalFile}`)
    }
    const score = parseJsonFile<EvaluationScore>(paths.draftFile)
    validateEvaluationScore(score, { case_id: caseId, model, probe })
    return { model, paths, score }
  })

  const promotedAt = new Date().toISOString()
  for (const item of pending) {
    writeFileNew(item.paths.formalFile, JSON.stringify(item.score, null, 2) + '\n')
    console.log(`[promoted] ${item.model}/${probe}: ${item.score.total}/25`)
  }

  const decision = {
    run,
    case_id: caseId,
    probe,
    promoted_at: promotedAt,
    decision: 'human_confirmed',
    models: pending.map((item: any) => ({
      model: item.model,
      total: item.score.total,
      draft_file: path.relative(ROOT, item.paths.draftFile),
      formal_file: path.relative(ROOT, item.paths.formalFile),
      draft_sha256: hashText(JSON.stringify(item.score)),
    })),
  }
  const decisionFile = path.join(pending[0].paths.decisionsDir, `${timestamp()}-${probe}.json`)
  writeFileNew(decisionFile, JSON.stringify(decision, null, 2) + '\n')
  console.log(`Promotion decision saved: ${path.relative(ROOT, decisionFile)}`)
}

if (isMainScript(__filename)) {
  try {
    main()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exitCode = 1
  }
}
