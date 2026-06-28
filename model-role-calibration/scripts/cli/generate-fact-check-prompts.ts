#!/usr/bin/env node

import { generatePrompts as generatePromptsUntyped } from './fact-check-calibration-lib.js'
import { parseArgs, requireArg } from '../lib/lib.js'

interface GeneratePromptsResult {
  prompt_dir: string
  models: string[]
}

const generatePrompts = generatePromptsUntyped as (opts: {
  run: string
  caseId: string
  models: string[]
}) => GeneratePromptsResult

function parseModels(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function main(): void {
  const args = parseArgs(process.argv)
  const run = requireArg(args, 'run')
  const caseId = requireArg(args, 'case')
  const models = parseModels(requireArg(args, 'models'))
  if (!models.length) {
    throw new Error('At least one model is required')
  }
  const result = generatePrompts({
    run,
    caseId,
    models,
  })
  console.log(`Generated fact-check prompts: ${result.prompt_dir}`)
  console.log(`Models: ${result.models.join(', ')}`)
}

main()
