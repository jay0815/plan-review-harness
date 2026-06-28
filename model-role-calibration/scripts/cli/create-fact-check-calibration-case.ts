#!/usr/bin/env node

import { createCaseFromWorkspaceRun as createCaseFromWorkspaceRunUntyped } from './fact-check-calibration-lib.js'
import { type ArgValue, parseArgs, requireArg } from '../lib/lib.js'

interface CreateCaseResult {
  case_file: string
  issue_count: number
}

const createCaseFromWorkspaceRun = createCaseFromWorkspaceRunUntyped as (opts: {
  caseId: string
  runId: string | null
  runDir: string | null
}) => CreateCaseResult

function optionalString(value: ArgValue): string | null {
  return value && value !== true ? String(value) : null
}

function main(): void {
  const args = parseArgs(process.argv)
  const caseId = requireArg(args, 'case')
  const result = createCaseFromWorkspaceRun({
    caseId,
    runId: optionalString(args['run-id']),
    runDir: optionalString(args['run-dir']),
  })
  console.log(`Created fact-check calibration case: ${result.case_file}`)
  console.log(`Issues: ${result.issue_count}`)
  console.log('Fill expected_status labels before scoring candidate outputs.')
}

main()
