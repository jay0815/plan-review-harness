#!/usr/bin/env node

import assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-check-calibration-test-'))
process.env.MODEL_ROLE_CALIBRATION_FACT_CHECK_ROOT = path.join(tempRoot, 'fact-check-calibration')

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

async function main() {
  const {
    FACT_CHECK_ROOT,
    caseFile,
    createCaseFromWorkspaceRun,
    generatePrompts,
    ingestOutput,
    loadCase,
    scoreOutput,
    summarizeRun,
  } = await import('./fact-check-calibration-lib.js')

  try {
    assert.equal(FACT_CHECK_ROOT, path.join(tempRoot, 'fact-check-calibration'))
    const workspaceRunDir = path.join(tempRoot, 'workspace-runs', 'workspace-review-test')
    fs.mkdirSync(workspaceRunDir, { recursive: true })
    fs.writeFileSync(path.join(workspaceRunDir, 'review-plan.md'), '# Plan\n\n修改 src/cli.ts。\n', 'utf8')
    writeJson(path.join(workspaceRunDir, 'request.json'), {
      run_id: 'workspace-review-test',
      project_root: '/tmp/project',
      plan: '# Original Plan',
      plan_file: '/tmp/plan.md',
      context: 'test context',
    })
    writeJson(path.join(workspaceRunDir, 'report.json'), {
      run_id: 'workspace-review-test',
      project_root: '/tmp/project',
      reviewers: {
        risk: {
          output: {
            probe: 'risk',
            issues: [
              {
                title: '配置值不一致',
                type: 'risk',
                severity: 'high',
                evidence: 'src/cli.ts:1 shows old value',
                why_it_matters: '计划要求新值',
                confidence: 0.9,
              },
            ],
            missing_questions: [],
            false_positive_risks: [],
          },
        },
      },
      fact_check: {
        output: {
          probe: 'fact_check',
          checked_issues: [
            {
              issue_id: 'Risk-Reviewer-001',
              source: 'Risk Reviewer',
              issue_title: '配置值不一致',
              status: 'verified',
              scope_status: 'in_scope',
              evidence_status: 'quote_matches',
              claim_support: 'direct',
              reason: 'seed',
              checked_files: ['src/cli.ts'],
            },
          ],
          source_summaries: [],
          limits: [],
        },
      },
    })

    const created = createCaseFromWorkspaceRun({
      runDir: workspaceRunDir,
      caseId: 'reqa-test',
    } as any)
    assert.equal(created.issue_count, 1)
    assert(fs.existsSync(caseFile('reqa-test')))
    const fixture = loadCase('reqa-test')
    assert.equal(fixture.issues[0].seed_status, 'verified')
    assert.equal(fixture.issues[0].expected_status, null)
    assert.throws(() => scoreOutput({ run: 'run-1', caseId: 'reqa-test', model: 'kimi' }), /unlabeled issue/)

    fixture.issues[0].expected_status = 'unsupported'
    fixture.issues[0].expected_evidence_status = 'quote_mismatch'
    fixture.issues[0].expected_claim_support = 'none'
    writeJson(caseFile('reqa-test'), fixture)

    const generated = generatePrompts({
      run: 'run-1',
      caseId: 'reqa-test',
      models: ['kimi', 'deepseek'],
    })
    assert(fs.existsSync(path.join(generated.prompt_dir, 'kimi-fact_check.md')))
    const generatedPrompt = fs.readFileSync(path.join(generated.prompt_dir, 'kimi-fact_check.md'), 'utf8')
    assert(generatedPrompt.includes('role-calibration-v4'))
    assert(generatedPrompt.includes('# Issue Identity'))
    assert(generatedPrompt.includes('"issue_id": "Risk-Reviewer-001"'))
    assert(generatedPrompt.includes('`issue_id` 是匹配主键'))
    assert(generatedPrompt.includes('逐字复制 `source` 和 `issue_title`'))
    assert(generatedPrompt.includes('# Status Decision Rules'))
    assert(generatedPrompt.includes('不要因为其中一个子 claim 被反驳就把整个 issue 判为 `contradicted`'))
    assert(generatedPrompt.includes('当前 scoped mirror 中的可读证据优先于 Reviewer 的旧行号'))
    assert(generatedPrompt.includes('直接后果依赖未证实的现有工程事实'))
    assert(generatedPrompt.includes('常识性、惯例性或推测性表述补足因果链'))

    const candidateFile = path.join(tempRoot, 'candidate.json')
    writeJson(candidateFile, {
      probe: 'fact_check',
      checked_issues: [
        {
          issue_id: 'Risk-Reviewer-001',
          source: 'risk',
          issue_title: '配置值不一致',
          status: 'unsupported',
          scope_status: 'in_scope',
          evidence_status: 'quote_mismatch',
          claim_support: 'none',
          reason: 'candidate',
          checked_files: ['src/cli.ts'],
        },
      ],
      source_summaries: [
        {
          source: 'Risk Reviewer',
          total_issues: 1,
          verified: 0,
          partially_verified: 0,
          unsupported: 1,
          contradicted: 0,
          unverifiable: 0,
        },
      ],
      limits: [],
    })
    const ingested = ingestOutput({
      run: 'run-1',
      caseId: 'reqa-test',
      model: 'kimi',
      file: candidateFile,
    })
    assert(fs.existsSync(ingested.normalized_file))
    const score = scoreOutput({
      run: 'run-1',
      caseId: 'reqa-test',
      model: 'kimi',
    })
    assert.equal(score.metrics.status_accuracy, 1)
    assert.equal(score.metrics.challenge_recall, 1)
    assert.equal(score.metrics.evidence_status_accuracy, 1)
    assert.equal(score.metrics.claim_support_accuracy, 1)
    assert.equal(score.rows[0].actual_issue_id, 'Risk-Reviewer-001')

    const summary = summarizeRun('run-1')
    assert.equal(summary.recommendation, 'kimi')
    assert.equal(summary.model_summaries[0].avg_status_accuracy, 1)

    console.log('Fact check calibration tests passed.')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
