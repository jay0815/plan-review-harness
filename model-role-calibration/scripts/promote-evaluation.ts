#!/usr/bin/env node

import fs = require('node:fs')
import path = require('node:path')

type ArgValue = string | true | undefined
type ParsedArgs = Record<string, ArgValue>

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

const {
  ROOT,
  parseArgs,
  requireArg,
  assertSafeCaseId,
  assertProbe,
  loadConfig,
  parseJsonFile,
  timestamp,
  writeFileNew,
} = require('./lib') as {
  ROOT: string
  parseArgs(argv: string[]): ParsedArgs
  requireArg(args: ParsedArgs, name: string): string
  assertSafeCaseId(caseId: string): void
  assertProbe(probe: string): void
  loadConfig(): CalibrationConfig
  parseJsonFile<T = unknown>(file: string): T
  timestamp(): string
  writeFileNew(file: string, content: string): void
}

const { parseList, hashText, evaluationPaths, validateEvaluationScore } = require('./evaluation-lib') as {
  parseList(value: ArgValue, fallback: string[]): string[]
  hashText(text: string): string
  evaluationPaths(run: string, caseId: string, model: string, probe: string): EvaluationPaths
  validateEvaluationScore(score: EvaluationScore, expected: { case_id: string; model: string; probe: string }): void
}

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

  const config = loadConfig()
  const models = parseList(args.models, config.models).map((item) => item.toLowerCase())
  const pending: PendingPromotion[] = models.map((model) => {
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
    models: pending.map((item) => ({
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

if (require.main === module) {
  try {
    main()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exitCode = 1
  }
}
