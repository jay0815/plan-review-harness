#!/usr/bin/env node

import * as fs from 'node:fs'
import * as path from 'node:path'

import { isMainScript, parseArgs, runtimeNodeScriptArgs } from './lib.js'
import { resolveRunDir, verifyRun } from './verify-workspace-review-run.js'

const REVIEWER_ROLES = new Set(['risk', 'architecture', 'execution', 'rebuttal'])

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) {
    return null
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function artifactPath(runDir, file) {
  return path.join(runDir, file)
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0
}

function summarizeLint(runDir) {
  const file = artifactPath(runDir, 'plan-authoring-lint.json')
  const lint = readJsonIfExists(file)
  if (!lint) {
    return {
      present: false,
      file,
      error_count: null,
      warning_count: null,
      existing_code_ref_count: null,
      structured_existing_code_ref_count: null,
      inline_existing_code_ref_count: null,
    }
  }
  return {
    present: true,
    file,
    valid: lint.valid ?? null,
    error_count: countArray(lint.errors),
    warning_count: countArray(lint.warnings),
    existing_code_ref_count: lint.metrics?.existing_code_ref_count ?? null,
    structured_existing_code_ref_count: lint.metrics?.structured_existing_code_ref_count ?? null,
    inline_existing_code_ref_count: lint.metrics?.inline_existing_code_ref_count ?? null,
  }
}

function summarizeRefs(runDir) {
  const file = artifactPath(runDir, 'review-plan-refs.json')
  const refs = readJsonIfExists(file)
  if (!refs) {
    return {
      present: false,
      file,
      existing_file_ref_count: null,
      existing_dir_ref_count: null,
      proposed_artifact_count: null,
      skipped_ref_count: null,
      blocked_ref_count: null,
      refs_scoped_to_existing_code_refs_section: null,
    }
  }
  return {
    present: true,
    file,
    existing_file_ref_count: countArray(refs.existing_code_refs),
    existing_dir_ref_count: countArray(refs.existing_code_ref_dirs),
    proposed_artifact_count: countArray(refs.proposed_code_artifacts),
    skipped_ref_count: countArray(refs.skipped_refs),
    blocked_ref_count: countArray(refs.blocked_refs),
    refs_scoped_to_existing_code_refs_section: refs.format_status?.refs_scoped_to_existing_code_refs_section ?? null,
  }
}

function summarizeSynthesis(runDir) {
  const file = path.join(runDir, 'roles', 'synthesis', 'output.json')
  const output = readJsonIfExists(file)
  if (!output) {
    return {
      present: false,
      file,
      consensus_issue_count: null,
      disagreement_count: null,
      revision_instruction_count: null,
      likely_false_positive_count: null,
    }
  }
  return {
    present: true,
    file,
    consensus_issue_count: countArray(output.consensus_issues),
    disagreement_count: countArray(output.disagreements),
    revision_instruction_count: countArray(output.revision_instructions),
    likely_false_positive_count: countArray(output.likely_false_positives),
  }
}

function summarizeFactCheck(verifyResult) {
  const role = verifyResult.timings.roles.fact_check || {}
  const strictness = verifyResult.checks.find((item) => item.id === 'fact_check.strictness_signal')
  const summary = verifyResult.checks.find((item) => item.id === 'fact_check.summary_present')?.details || null
  return {
    present: Boolean(verifyResult.timings.roles.fact_check),
    model: role.model || null,
    read_count: role.read_count ?? null,
    out_of_boundary_read_count: role.out_of_boundary_read_count ?? null,
    strictness_signal: summary?.strictness_signal ?? strictness?.details?.strictness_signal ?? null,
    total_checked: summary?.total_checked ?? null,
    challenged_count: summary?.challenged_count ?? null,
    status_counts: summary?.status_counts ?? null,
    evidence_status_counts: summary?.evidence_status_counts ?? null,
  }
}

function retryStageForInfraError(error) {
  const role = error?.role
  if (REVIEWER_ROLES.has(role)) {
    return 'reviewers'
  }
  if (role === 'fact_check') {
    return 'fact_check'
  }
  if (role === 'synthesis') {
    return 'synthesis'
  }
  return null
}

function shellQuote(value) {
  const text = String(value)
  if (/^[A-Za-z0-9_./:-]+$/.test(text)) {
    return text
  }
  return `'${text.replace(/'/g, "'\\''")}'`
}

function shellCommand(parts) {
  return parts.map(shellQuote).join(' ')
}

function retryCommand(runDir, stage) {
  return shellCommand([
    'node',
    ...runtimeNodeScriptArgs('retry-workspace-review-stage'),
    '--run-dir',
    runDir,
    '--stage',
    stage,
  ])
}

function addAction(actions, action) {
  actions.push(action)
}

function buildActions({ runDir, verification, lint, refs, synthesis }) {
  const actions = []
  if (['queued', 'running'].includes(verification.run_status)) {
    addAction(actions, {
      priority: 'P0',
      kind: 'wait_for_completion',
      reason: 'run 仍在执行中，先等待 get_plan_review 返回 completed 再判断最终质量。',
    })
    return actions
  }

  const manifestCheck = verification.checks.find((item) => item.id === 'manifest.present')
  if (manifestCheck?.status === 'fail' && manifestCheck.details?.backfill_command) {
    addAction(actions, {
      priority: 'P0',
      kind: 'backfill_run_manifest',
      reason: '该 run 由旧版 workspace-review runner 生成，缺少 run-manifest.json；先显式补写 manifest，再重新验证。',
      command: manifestCheck.details.backfill_command,
    })
  }

  if (verification.infra_errors.length) {
    const stages = [...new Set(verification.infra_errors.map(retryStageForInfraError).filter(Boolean))]
    if (stages.length) {
      for (const stage of stages) {
        addAction(actions, {
          priority: 'P0',
          kind: 'retry_stage',
          stage,
          reason: '存在 Reviewer/Fact Check/Synthesis 基础设施错误；先重跑失败阶段，再重新检查 run。',
          command: retryCommand(runDir, stage),
        })
      }
    } else {
      addAction(actions, {
        priority: 'P0',
        kind: 'inspect_infra_error',
        reason: '存在基础设施错误，但无法自动映射到 retry stage；检查 state.json、report.json 和对应 role 日志。',
      })
    }
  }

  if (!lint.present) {
    addAction(actions, {
      priority: 'P1',
      kind: 'check_missing_plan_authoring_lint',
      reason: '缺少 plan-authoring-lint.json；新版本 run 应保留本地计划结构检查结果。',
      file: lint.file,
    })
  }

  if (!refs.present) {
    addAction(actions, {
      priority: 'P1',
      kind: 'check_missing_review_plan_refs',
      reason: '缺少 review-plan-refs.json；无法判断现有代码映射是否被正确识别并进入 read-scope。',
      file: refs.file,
    })
  }

  if (lint.present && lint.error_count > 0) {
    addAction(actions, {
      priority: 'P0',
      kind: 'revise_plan_authoring_errors',
      reason: `plan-authoring-lint 存在 ${lint.error_count} 个错误；先修计划结构再重跑审查。`,
      file: lint.file,
    })
  }

  if (lint.present && lint.existing_code_ref_count === 0) {
    addAction(actions, {
      priority: 'P1',
      kind: 'check_existing_code_refs',
      reason: 'plan-authoring-lint 未识别到现有代码引用；如果计划实际包含现有代码映射，需要检查映射格式或 lint 解析。',
      file: lint.file,
    })
  }

  if (refs.present && refs.refs_scoped_to_existing_code_refs_section !== true) {
    addAction(actions, {
      priority: 'P1',
      kind: 'check_review_plan_refs_scope',
      reason:
        'review-plan-refs 未确认引用只来自 Existing Code Refs / 现有代码映射章节；需要检查 plan ref manifest 生成。',
      file: refs.file,
    })
  }

  if (!verification.valid) {
    addAction(actions, {
      priority: 'P1',
      kind: 'run_verify',
      reason: '标准验证未通过；查看 verify 输出中的 fail 项定位具体 contract 退化。',
      command: shellCommand(['node', ...runtimeNodeScriptArgs('verify-workspace-review-run', '--run-dir', runDir)]),
    })
  }

  if (synthesis.present && synthesis.revision_instruction_count > 0) {
    addAction(actions, {
      priority: 'P1',
      kind: 'review_revision_instructions',
      reason: `Synthesis 生成了 ${synthesis.revision_instruction_count} 条 revision_instructions；人工确认这些是否都有 Fact Check 支持。`,
      file: synthesis.file,
    })
  }

  if (verification.valid && !verification.infra_errors.length && (!lint.present || lint.error_count === 0)) {
    addAction(actions, {
      priority: 'P2',
      kind: 'record_regression_sample',
      reason: 'run 基础健康；如果本次真实效果符合预期，可追加到 workspace-review regression notes。',
    })
  }

  return actions
}

function healthFrom({ verification, actions }) {
  if (['queued', 'running'].includes(verification.run_status)) {
    return 'pending'
  }
  if (verification.infra_errors.length || !verification.valid) {
    return 'fail'
  }
  if (actions.some((item) => item.priority === 'P0' || item.priority === 'P1')) {
    return 'warn'
  }
  if (verification.counts.warn > 0) {
    return 'warn'
  }
  return 'pass'
}

function actionLevelFrom(actions) {
  if (actions.some((item) => item.priority === 'P0')) {
    return 'P0'
  }
  if (actions.some((item) => item.priority === 'P1')) {
    return 'P1'
  }
  if (actions.some((item) => item.priority === 'P2')) {
    return 'P2'
  }
  return 'none'
}

export function doctorWorkspaceReviewRun(runDir) {
  const absoluteRunDir = path.resolve(runDir)
  const verification = verifyRun(absoluteRunDir)
  const lint = summarizeLint(absoluteRunDir)
  const refs = summarizeRefs(absoluteRunDir)
  const factCheck = summarizeFactCheck(verification)
  const synthesis = summarizeSynthesis(absoluteRunDir)
  const actions = buildActions({
    runDir: absoluteRunDir,
    verification,
    lint,
    refs,
    synthesis,
  })
  return {
    run_id: verification.run_id,
    run_dir: absoluteRunDir,
    health: healthFrom({ verification, actions }),
    action_level: actionLevelFrom(actions),
    run_status: verification.run_status,
    plan_outcome: verification.outcome,
    verification: {
      valid: verification.valid,
      ready: verification.ready,
      counts: verification.counts,
      infra_errors: verification.infra_errors,
      outcome: verification.outcome,
    },
    plan_authoring_lint: lint,
    review_plan_refs: refs,
    fact_check: factCheck,
    synthesis,
    next_actions: actions,
  }
}

function printText(result) {
  console.log(`# Plan Review Doctor: ${result.run_id}`)
  console.log('')
  console.log(`Run dir: ${result.run_dir}`)
  console.log(`Run health: ${result.health.toUpperCase()}`)
  console.log(`Action level: ${result.action_level}`)
  console.log(`Run status: ${result.run_status || '-'}`)
  console.log(
    `Verify: ${result.verification.valid === null ? 'NOT_READY' : result.verification.valid ? 'PASS' : 'FAIL'} (${result.verification.counts.pass} pass, ${result.verification.counts.warn} warn, ${result.verification.counts.fail} fail, ${result.verification.counts.pending} pending)`,
  )
  console.log(`Infra errors: ${result.verification.infra_errors.length}`)
  if (result.plan_outcome) {
    console.log(`Plan outcome: ${result.plan_outcome.status} - ${result.plan_outcome.message}`)
  }
  console.log('')
  console.log('## Evidence Chain')
  console.log(
    `plan-authoring-lint: ${result.plan_authoring_lint.present ? `${result.plan_authoring_lint.error_count} error(s), ${result.plan_authoring_lint.warning_count} warning(s), existing refs ${result.plan_authoring_lint.existing_code_ref_count}` : 'missing'}`,
  )
  console.log(
    `review-plan-refs: ${result.review_plan_refs.present ? `${result.review_plan_refs.existing_file_ref_count} file ref(s), ${result.review_plan_refs.existing_dir_ref_count} dir ref(s), ${result.review_plan_refs.skipped_ref_count} skipped` : 'missing'}`,
  )
  console.log(
    `Fact Check: ${result.fact_check.present ? `${result.fact_check.read_count} read(s), strictness ${result.fact_check.strictness_signal || '-'}` : 'missing'}`,
  )
  console.log(
    `Synthesis: ${result.synthesis.present ? `${result.synthesis.consensus_issue_count} consensus, ${result.synthesis.disagreement_count} disagreement, ${result.synthesis.revision_instruction_count} revision instruction(s)` : 'missing'}`,
  )
  console.log('')
  console.log('## Next Actions')
  if (!result.next_actions.length) {
    console.log('- none')
  } else {
    for (const action of result.next_actions) {
      console.log(`- [${action.priority}] ${action.kind}: ${action.reason}`)
      if (action.command) {
        console.log(`  command: ${action.command}`)
      }
      if (action.file) {
        console.log(`  file: ${action.file}`)
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv)
  const result = doctorWorkspaceReviewRun(resolveRunDir(args))
  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    printText(result)
  }
  if (result.health === 'pending') {
    process.exitCode = 2
  } else if (result.health === 'fail') {
    process.exitCode = 1
  }
}

if (isMainScript(__filename)) {
  try {
    main()
  } catch (error: any) {
    console.error(error.stack || error.message)
    process.exitCode = 1
  }
}
