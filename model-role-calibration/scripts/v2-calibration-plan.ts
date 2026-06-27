#!/usr/bin/env node

import * as fs from 'node:fs'
import * as path from 'node:path'

import { parseList } from './calibration/core.js'
import { generatePrompts } from './generate-prompts.js'
import {
  ROOT,
  PROBES,
  agentOutputPaths,
  assertProbe,
  assertSafeCaseId,
  isMainScript,
  loadConfig,
  optionalSlugArg,
  parseArgs,
  slug,
} from './lib.js'

interface CalibrationConfig {
  primary_cases: string[]
  models: string[]
}

const DEFAULT_SCORE_VERSION = 'manual-v1'
const TS_RUNNER = 'node --import tsx'
const SCRIPT = 'model-role-calibration/scripts/v2-calibration-plan.ts'
const RUN_CALIBRATION = 'model-role-calibration/scripts/run-calibration.ts'
const SCORE_OUTPUT = 'model-role-calibration/scripts/score-output.ts'
const SUMMARIZE_RESULTS = 'model-role-calibration/scripts/summarize-results.ts'

function usage() {
  return [
    'Usage:',
    `  ${TS_RUNNER} ${SCRIPT} --run <run-id> --action status`,
    `  ${TS_RUNNER} ${SCRIPT} --run <run-id> --action prepare --cases synthetic/plugin-lifecycle`,
    `  ${TS_RUNNER} ${SCRIPT} --run <run-id> --action commands --cases synthetic/plugin-lifecycle`,
    `  ${TS_RUNNER} ${SCRIPT} --run <run-id> --action score-commands`,
    '',
    'Actions:',
    '  status          Inspect prompt, output, and score coverage. Does not write files.',
    '  prepare         Generate missing prompts only. Does not run models.',
    '  commands        Print model-running commands for the user to run manually.',
    '  score-commands  Print score-output commands for completed outputs missing scores.',
    '  all             Print status, model commands, score commands, and summarize command.',
    '',
    'This helper never starts run-calibration.ts or any model wrapper itself.',
  ].join('\n')
}

function rel(file) {
  return path.relative(path.resolve(ROOT, '..'), file)
}

function promptFile(run, caseId, probe) {
  return path.join(ROOT, 'runs', run, caseId, 'prompts', `${probe}.md`)
}

function scoreFile(run, caseId, model, probe, scoreVersion) {
  return path.join(ROOT, 'runs', run, caseId, 'scores', 'versions', scoreVersion, `${slug(model)}-${probe}.score.json`)
}

function validateSelection({ cases, models, probes, config }) {
  for (const caseId of cases) {
    assertSafeCaseId(caseId)
  }
  for (const model of models) {
    if (!config.models.includes(model)) {
      throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`)
    }
  }
  probes.forEach(assertProbe)
}

function collectJobs({ run, cases, models, probes, scoreVersion }) {
  const jobs: any[] = []
  for (const caseId of cases) {
    for (const probe of probes) {
      const prompt = promptFile(run, caseId, probe)
      for (const model of models) {
        const output = agentOutputPaths(run, caseId, model, probe).resultFile
        const score = scoreFile(run, caseId, model, probe, scoreVersion)
        jobs.push({
          run,
          caseId,
          model,
          probe,
          prompt,
          output,
          score,
          promptExists: fs.existsSync(prompt),
          outputExists: fs.existsSync(output),
          scoreExists: fs.existsSync(score),
        })
      }
    }
  }
  return jobs
}

function byCaseAndProbe(jobs, predicate) {
  const grouped = new Map<string, any>()
  for (const job of jobs.filter(predicate)) {
    const key = `${job.caseId}\u0000${job.probe}`
    if (!grouped.has(key)) {
      grouped.set(key, {
        caseId: job.caseId,
        probe: job.probe,
        models: [],
      })
    }
    grouped.get(key).models.push(job.model)
  }
  return [...grouped.values()]
}

function renderStatus({ cases, probes, jobs, scoreVersion }) {
  console.log(`Score version: ${scoreVersion}`)
  for (const caseId of cases) {
    const caseJobs = jobs.filter((job) => job.caseId === caseId)
    const promptCount = probes.filter((probe) => fs.existsSync(promptFile(caseJobs[0]?.run, caseId, probe))).length
    const outputCount = caseJobs.filter((job) => job.outputExists).length
    const scoreReadyJobs = caseJobs.filter((job) => job.outputExists)
    const scoreCount = scoreReadyJobs.filter((job) => job.scoreExists).length
    console.log(`\n${caseId}`)
    console.log(`  prompts: ${promptCount}/${probes.length}`)
    console.log(`  outputs: ${outputCount}/${caseJobs.length}`)
    console.log(`  scores: ${scoreCount}/${scoreReadyJobs.length}`)

    const missingOutputs = byCaseAndProbe(caseJobs, (job) => !job.outputExists)
    if (missingOutputs.length) {
      console.log('  missing outputs:')
      for (const item of missingOutputs) {
        console.log(`    ${item.probe}: ${item.models.join(',')}`)
      }
    }

    const missingScores = byCaseAndProbe(caseJobs, (job) => job.outputExists && !job.scoreExists)
    if (missingScores.length) {
      console.log('  missing scores:')
      for (const item of missingScores) {
        console.log(`    ${item.probe}: ${item.models.join(',')}`)
      }
    }
  }
}

function preparePrompts({ run, cases, probes }) {
  for (const caseId of cases) {
    const missing = probes.filter((probe) => !fs.existsSync(promptFile(run, caseId, probe)))
    if (!missing.length) {
      console.log(`${caseId}: prompts already complete`)
      continue
    }
    generatePrompts({ run, caseId, probes: missing })
    console.log(`${caseId}: generated ${missing.length} prompt(s)`)
  }
}

function printModelCommands({ run, cases, models, probes, jobs }) {
  console.log('# Prepare prompts first. This command does not run models.')
  console.log(
    `${TS_RUNNER} ${SCRIPT} --run ${run} --cases ${cases.join(',')} --models ${models.join(',')} ` +
      `--probes ${probes.join(',')} --action prepare`,
  )
  console.log('')
  console.log('# Run these manually when you want to start model calls.')
  for (const caseId of cases) {
    const missing = jobs.some((job) => job.caseId === caseId && !job.outputExists)
    if (!missing) {
      console.log(`# ${caseId}: all outputs already exist`)
      continue
    }
    console.log(
      [
        `${TS_RUNNER} ${RUN_CALIBRATION} \\`,
        `  --run ${run} \\`,
        `  --case ${caseId} \\`,
        `  --models ${models.join(',')} \\`,
        `  --probes ${probes.join(',')}`,
      ].join('\n'),
    )
    console.log('')
  }
}

function printScoreCommands({ run, jobs, scoreVersion }) {
  const missing = jobs.filter((job) => job.outputExists && !job.scoreExists)
  if (!missing.length) {
    console.log('# No missing score files for completed outputs.')
    return
  }
  for (const job of missing) {
    console.log(
      [
        `${TS_RUNNER} ${SCORE_OUTPUT} \\`,
        `  --run ${run} \\`,
        `  --case ${job.caseId} \\`,
        `  --model ${job.model} \\`,
        `  --probe ${job.probe} \\`,
        `  --score-version ${scoreVersion}`,
      ].join('\n'),
    )
    console.log('')
  }
}

function printSummaryCommand(run, scoreVersion) {
  console.log('# Summarize after scores are filled.')
  console.log(`${TS_RUNNER} ${SUMMARIZE_RESULTS} --run ${run} --score-version ${scoreVersion}`)
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    console.log(usage())
    return
  }
  const config = loadConfig<CalibrationConfig>()
  const run = args.run && args.run !== true ? String(args.run) : null
  if (!run) {
    throw new Error('Missing required argument: --run\n\n' + usage())
  }
  const action = args.action && args.action !== true ? String(args.action) : 'status'
  const cases = parseList(args.cases, config.primary_cases)
  const models = parseList(args.models, config.models).map((item) => item.toLowerCase())
  const probes = parseList(args.probes, PROBES)
  const scoreVersion = optionalSlugArg(args, 'score-version') || DEFAULT_SCORE_VERSION

  validateSelection({ cases, models, probes, config })
  const jobs = collectJobs({ run, cases, models, probes, scoreVersion })

  if (action === 'status') {
    renderStatus({ cases, probes, jobs, scoreVersion })
    return
  }
  if (action === 'prepare') {
    preparePrompts({ run, cases, probes })
    return
  }
  if (action === 'commands') {
    printModelCommands({ run, cases, models, probes, jobs })
    return
  }
  if (action === 'score-commands') {
    printScoreCommands({ run, jobs, scoreVersion })
    return
  }
  if (action === 'all') {
    renderStatus({ cases, probes, jobs, scoreVersion })
    console.log('')
    printModelCommands({ run, cases, models, probes, jobs })
    console.log('')
    printScoreCommands({ run, jobs, scoreVersion })
    console.log('')
    printSummaryCommand(run, scoreVersion)
    return
  }
  throw new Error(`Unknown action "${action}".\n\n${usage()}`)
}

if (isMainScript(__filename)) {
  try {
    main()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  }
}

export { collectJobs, scoreFile, promptFile }
