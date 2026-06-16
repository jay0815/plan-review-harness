#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ROOT,
  parseArgs,
  requireArg,
  parseJsonFile,
  writeGenerated
} = require("./lib");
const {
  parseAssistantOutput,
  runCommand
} = require("./run-model");
const {
  REVIEW_ROLES,
  FACT_CHECK_ROLE,
  loadWorkspaceReviewFromArgs,
  validateProjectRoot,
  buildRoleReadScope,
  buildFactCheckReadScope,
  copyScopedWorkspace,
  compactPlanForReview,
  buildWorkspacePrompt,
  buildClaudeWorkspaceArgs,
  appendExecutionLog,
  updateState,
  withoutAnthropicApiKey
} = require("./workspace-review-lib");

const SOURCE_NAME_BY_ROLE = {
  risk: "Risk Reviewer",
  architecture: "Architecture Reviewer",
  execution: "Execution Reviewer",
  rebuttal: "Rebuttal Reviewer"
};

function writeJson(file, value) {
  writeGenerated(file, JSON.stringify(value, null, 2) + "\n");
}

function countBy(items, key) {
  const counts = {};
  for (const item of items || []) {
    const value = item?.[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function summarizeFactCheckOutput(output) {
  const checkedIssues = Array.isArray(output?.checked_issues) ? output.checked_issues : [];
  const statusCounts = countBy(checkedIssues, "status");
  const evidenceStatusCounts = countBy(checkedIssues, "evidence_status");
  const claimSupportCounts = countBy(checkedIssues, "claim_support");
  const total = checkedIssues.length;
  const challenged = [
    "partially_verified",
    "unsupported",
    "contradicted",
    "unverifiable"
  ].reduce((sum, key) => sum + (statusCounts[key] || 0), 0);
  const verified = statusCounts.verified || 0;
  return {
    total_checked: total,
    status_counts: statusCounts,
    evidence_status_counts: evidenceStatusCounts,
    claim_support_counts: claimSupportCounts,
    verified_ratio: total ? Number((verified / total).toFixed(4)) : null,
    challenged_count: challenged,
    strictness_signal: total === 0
      ? "no_issues_checked"
      : challenged === 0
        ? "all_verified"
        : "challenged_some_claims",
    limits_count: Array.isArray(output?.limits) ? output.limits.length : 0
  };
}

function summarizeReviewOutcome(reviewerResults, factCheck, synthesis, infraErrors) {
  const reviewerIssueCount = reviewerResults.reduce((sum, item) => (
    sum + (Array.isArray(item.output?.issues) ? item.output.issues.length : 0)
  ), 0);
  const consensusCount = Array.isArray(synthesis.output?.consensus_issues)
    ? synthesis.output.consensus_issues.length
    : 0;
  const disagreementCount = Array.isArray(synthesis.output?.disagreements)
    ? synthesis.output.disagreements.length
    : 0;
  const revisionCount = Array.isArray(synthesis.output?.revision_instructions)
    ? synthesis.output.revision_instructions.length
    : 0;
  const factChecked = factCheck.summary?.total_checked || 0;
  const challenged = factCheck.summary?.challenged_count || 0;
  if (infraErrors.length) {
    return {
      status: "review_completed_with_infra_errors",
      message: "审查已完成，但存在 Reviewer/模型输出基础设施错误；不能视为全角色完整审查。",
      reviewer_issue_count: reviewerIssueCount,
      consensus_issue_count: consensusCount,
      disagreement_count: disagreementCount,
      revision_instruction_count: revisionCount,
      fact_checked_issue_count: factChecked,
      fact_check_challenged_count: challenged,
      infra_error_count: infraErrors.length
    };
  }
  if (consensusCount === 0 && disagreementCount === 0 && revisionCount === 0) {
    return {
      status: "plan_ready",
      message: "未发现需要修订的共识问题、分歧或修订指令；当前计划可以进入执行或保持原计划。",
      reviewer_issue_count: reviewerIssueCount,
      consensus_issue_count: consensusCount,
      disagreement_count: disagreementCount,
      revision_instruction_count: revisionCount,
      fact_checked_issue_count: factChecked,
      fact_check_challenged_count: challenged,
      infra_error_count: 0
    };
  }
  return {
    status: "needs_revision",
    message: "审查发现需要处理的问题、分歧或修订指令；应先修订计划再执行。",
    reviewer_issue_count: reviewerIssueCount,
    consensus_issue_count: consensusCount,
    disagreement_count: disagreementCount,
    revision_instruction_count: revisionCount,
    fact_checked_issue_count: factChecked,
    fact_check_challenged_count: challenged,
    infra_error_count: 0
  };
}

function extractFinalOutputText(stdout) {
  const lines = String(stdout || "").trim().split(/\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    if (event?.type === "result" && typeof event.result === "string") {
      return event.result;
    }
    const content = event?.message?.content;
    if (Array.isArray(content)) {
      for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
        const block = content[contentIndex];
        if (block?.type === "text" && typeof block.text === "string") {
          return block.text;
        }
      }
    }
  }
  return "";
}

function reviewerInfraError(role, model, error, runDir) {
  return {
    role,
    model,
    type: /invalid output|valid JSON|Probe mismatch/i.test(error.message)
      ? "invalid_output"
      : "agent_failed",
    message: error.message,
    metadata_file: path.relative(runDir, path.join(runDir, "roles", role, "metadata.json")),
    stdout_file: path.relative(runDir, path.join(runDir, "roles", role, "stdout.jsonl")),
    stderr_file: path.relative(runDir, path.join(runDir, "roles", role, "stderr.log"))
  };
}

function prepareReadBoundary(config, request, runDir, role, readScope) {
  if (config.execution.isolate_reviewers === false) {
    return {
      promptRoot: request.project_root,
      claudeRoot: request.project_root,
      boundary: {
        ...readScope,
        mode: "prompt_only",
        source_root: request.project_root,
        exposed_root: request.project_root
      },
      cleanup: () => {}
    };
  }
  const workspaceParent = fs.mkdtempSync(path.join(os.tmpdir(), `plan-review-${role}-scope-`));
  const boundary = {
    ...readScope,
    ...copyScopedWorkspace(request.project_root, readScope, workspaceParent)
  };
  appendExecutionLog(runDir, "read_scope_prepared", {
    role,
    mode: boundary.mode,
    files: boundary.files.length,
    blocked_refs: boundary.blocked_refs.length,
    skipped_refs: boundary.skipped_refs.length
  });
  return {
    promptRoot: boundary.exposed_root,
    claudeRoot: boundary.exposed_root,
    boundary,
    cleanup: () => fs.rmSync(workspaceParent, { recursive: true, force: true })
  };
}

async function runRole(config, request, role, runDir) {
  const model = config.roles[role];
  const startedMs = Date.now();
  const roleDir = path.join(runDir, "roles", role);
  fs.mkdirSync(roleDir, { recursive: true });
  const readScope = buildRoleReadScope(
    role,
    request.project_root,
    request.review_plan || request.plan,
    {
      maxFiles: config.execution.read_scope_max_files
    }
  );
  const readBoundary = prepareReadBoundary(config, request, runDir, role, readScope);
  writeJson(path.join(roleDir, "read-scope.json"), readBoundary.boundary);
  const prompt = buildWorkspacePrompt(
    role,
    readBoundary.promptRoot,
    request.review_plan || request.plan,
    request.context || "",
    null,
    null,
    readBoundary.boundary
  );
  const promptFile = path.join(roleDir, "prompt.md");
  writeGenerated(promptFile, prompt);
  const args = buildClaudeWorkspaceArgs(config, model, role, readBoundary.claudeRoot);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-review-role-"));
  const startedAt = new Date().toISOString();
  appendExecutionLog(runDir, "agent_started", {
    role,
    model
  });
  let child;
  try {
    child = await runCommand(config.claude_bin, args, {
      cwd: workDir,
      env: withoutAnthropicApiKey(process.env),
      input: prompt,
      timeoutMs: config.execution.timeout_ms,
      killSignal: "SIGKILL",
      maxBuffer: config.execution.max_buffer_bytes,
      validatorLogFile: null
    });
  } catch (error) {
    appendExecutionLog(runDir, "agent_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    throw error;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    readBoundary.cleanup();
  }

  writeGenerated(path.join(roleDir, "stdout.jsonl"), child.stdout || "");
  writeGenerated(path.join(roleDir, "stderr.log"), child.stderr || "");
  const metadata = {
    role,
    model,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timed_out: child.error?.code === "ETIMEDOUT",
    exit_code: child.status,
    signal: child.signal,
    error: child.error ? child.error.message : null,
    prompt_file: path.relative(runDir, promptFile),
    settings_file: config.models[model].settings_file,
    allowed_tools: ["Read", "Glob", "Grep"],
    project_root: request.project_root,
    read_boundary: {
      mode: readBoundary.boundary.mode,
      source_root: readBoundary.boundary.source_root,
      exposed_root: readBoundary.boundary.exposed_root,
      file_count: readBoundary.boundary.files.length,
      read_scope_file: path.relative(runDir, path.join(roleDir, "read-scope.json"))
    }
  };
  if (child.error || child.status !== 0) {
    appendExecutionLog(runDir, "agent_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed"
    });
    throw new Error(
      `${role}/${model} failed: ${child.error?.message || `exit ${child.status}`}`
    );
  }

  let parsed;
  try {
    parsed = parseAssistantOutput(child.stdout, role);
  } catch (error) {
    writeGenerated(path.join(roleDir, "output.invalid.txt"), extractFinalOutputText(child.stdout));
    appendExecutionLog(runDir, "agent_invalid_output", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed",
      error: error.message,
      failure_kind: "invalid_output",
      invalid_output_file: path.relative(runDir, path.join(roleDir, "output.invalid.txt"))
    });
    throw new Error(`${role}/${model} returned invalid output: ${error.message}`);
  }
  writeJson(path.join(roleDir, "output.json"), parsed.output);
  writeJson(path.join(roleDir, "metadata.json"), {
    ...metadata,
    status: "completed",
    error: null
  });
  appendExecutionLog(runDir, "agent_completed", {
    role,
    model,
    elapsed_ms: Date.now() - startedMs
  });
  return {
    role,
    model,
    output: parsed.output,
    output_file: path.relative(runDir, path.join(roleDir, "output.json"))
  };
}

async function runFactCheck(config, request, reviewerResults, runDir) {
  const role = FACT_CHECK_ROLE;
  const model = config.roles[role];
  const startedMs = Date.now();
  const roleDir = path.join(runDir, "roles", role);
  fs.mkdirSync(roleDir, { recursive: true });
  const reviewerOutputs = Object.fromEntries(reviewerResults.map((item) => [
    SOURCE_NAME_BY_ROLE[item.role],
    item.output
  ]));
  const readScope = buildFactCheckReadScope(
    request.project_root,
    reviewerOutputs,
    {
      maxFiles: config.execution.read_scope_max_files
    }
  );
  const readBoundary = prepareReadBoundary(config, request, runDir, role, readScope);
  writeJson(path.join(roleDir, "read-scope.json"), readBoundary.boundary);
  const prompt = buildWorkspacePrompt(
    role,
    readBoundary.promptRoot,
    request.review_plan || request.plan,
    request.context || "",
    reviewerOutputs,
    null,
    readBoundary.boundary
  );
  const promptFile = path.join(roleDir, "prompt.md");
  writeGenerated(promptFile, prompt);
  const args = buildClaudeWorkspaceArgs(config, model, role, readBoundary.claudeRoot, {
    tools: "Read",
    allowProjectRead: true,
    systemPrompt: [
      "You are a non-interactive evidence verification agent.",
      "Read only files explicitly cited by reviewer evidence.",
      "Never search for new issues, modify files, or execute shell commands."
    ].join(" ")
  });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-review-fact-check-"));
  const startedAt = new Date().toISOString();
  appendExecutionLog(runDir, "fact_check_started", {
    role,
    model,
    reviewer_count: reviewerResults.length
  });
  let child;
  try {
    child = await runCommand(config.claude_bin, args, {
      cwd: workDir,
      env: withoutAnthropicApiKey(process.env),
      input: prompt,
      timeoutMs: config.execution.timeout_ms,
      killSignal: "SIGKILL",
      maxBuffer: config.execution.max_buffer_bytes,
      validatorLogFile: null
    });
  } catch (error) {
    appendExecutionLog(runDir, "fact_check_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    throw error;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    readBoundary.cleanup();
  }

  writeGenerated(path.join(roleDir, "stdout.jsonl"), child.stdout || "");
  writeGenerated(path.join(roleDir, "stderr.log"), child.stderr || "");
  const metadata = {
    role,
    model,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timed_out: child.error?.code === "ETIMEDOUT",
    exit_code: child.status,
    signal: child.signal,
    error: child.error ? child.error.message : null,
    prompt_file: path.relative(runDir, promptFile),
    settings_file: config.models[model].settings_file,
    allowed_tools: ["Read"],
    project_root: request.project_root,
    read_boundary: {
      mode: readBoundary.boundary.mode,
      source_root: readBoundary.boundary.source_root,
      exposed_root: readBoundary.boundary.exposed_root,
      file_count: readBoundary.boundary.files.length,
      read_scope_file: path.relative(runDir, path.join(roleDir, "read-scope.json"))
    }
  };
  if (child.error || child.status !== 0) {
    appendExecutionLog(runDir, "fact_check_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed"
    });
    throw new Error(
      `${role}/${model} failed: ${child.error?.message || `exit ${child.status}`}`
    );
  }

  let parsed;
  try {
    parsed = parseAssistantOutput(child.stdout, role);
  } catch (error) {
    appendExecutionLog(runDir, "fact_check_invalid_output", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed",
      error: error.message
    });
    throw new Error(`${role}/${model} returned invalid output: ${error.message}`);
  }
  writeJson(path.join(roleDir, "output.json"), parsed.output);
  const factCheckSummary = summarizeFactCheckOutput(parsed.output);
  writeJson(path.join(roleDir, "fact-check-summary.json"), factCheckSummary);
  writeJson(path.join(roleDir, "metadata.json"), {
    ...metadata,
    fact_check_summary_file: path.relative(runDir, path.join(roleDir, "fact-check-summary.json")),
    status: "completed",
    error: null
  });
  appendExecutionLog(runDir, "fact_check_summary", factCheckSummary);
  appendExecutionLog(runDir, "fact_check_completed", {
    role,
    model,
    elapsed_ms: Date.now() - startedMs
  });
  return {
    role,
    model,
    output: parsed.output,
    output_file: path.relative(runDir, path.join(roleDir, "output.json")),
    summary: factCheckSummary,
    summary_file: path.relative(runDir, path.join(roleDir, "fact-check-summary.json"))
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );
  return results;
}

async function runReviewers(config, request, roles, runDir) {
  const settled = await runWithConcurrency(
    roles,
    config.execution.max_concurrency,
    async (role) => {
      const model = config.roles[role];
      try {
        return {
          ok: true,
          result: await runRole(config, request, role, runDir)
        };
      } catch (error) {
        return {
          ok: false,
          error: reviewerInfraError(role, model, error, runDir)
        };
      }
    }
  );
  return {
    reviewerResults: settled.filter((item) => item.ok).map((item) => item.result),
    infraErrors: settled.filter((item) => !item.ok).map((item) => item.error)
  };
}

async function runSynthesis(config, request, reviewerResults, factCheckResult, runDir) {
  const role = "synthesis";
  const model = config.roles.synthesis;
  const startedMs = Date.now();
  const roleDir = path.join(runDir, "roles", role);
  fs.mkdirSync(roleDir, { recursive: true });
  const reviewerOutputs = Object.fromEntries(reviewerResults.map((item) => [
    SOURCE_NAME_BY_ROLE[item.role],
    item.output
  ]));
  const prompt = buildWorkspacePrompt(
    role,
    request.project_root,
    request.review_plan || request.plan,
    request.context || "",
    reviewerOutputs,
    factCheckResult.output
  );
  const promptFile = path.join(roleDir, "prompt.md");
  writeGenerated(promptFile, prompt);
  const args = buildClaudeWorkspaceArgs(config, model, role, request.project_root, {
    tools: "",
    allowProjectRead: false
  });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-review-synthesis-"));
  const startedAt = new Date().toISOString();
  appendExecutionLog(runDir, "synthesis_started", {
    role,
    model,
    reviewer_count: reviewerResults.length
  });
  let child;
  try {
    child = await runCommand(config.claude_bin, args, {
      cwd: workDir,
      env: withoutAnthropicApiKey(process.env),
      input: prompt,
      timeoutMs: config.execution.timeout_ms,
      killSignal: "SIGKILL",
      maxBuffer: config.execution.max_buffer_bytes,
      validatorLogFile: null
    });
  } catch (error) {
    appendExecutionLog(runDir, "synthesis_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    throw error;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  writeGenerated(path.join(roleDir, "stdout.jsonl"), child.stdout || "");
  writeGenerated(path.join(roleDir, "stderr.log"), child.stderr || "");
  const metadata = {
    role,
    model,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timed_out: child.error?.code === "ETIMEDOUT",
    exit_code: child.status,
    signal: child.signal,
    error: child.error ? child.error.message : null,
    prompt_file: path.relative(runDir, promptFile),
    settings_file: config.models[model].settings_file,
    allowed_tools: [],
    project_root: null
  };
  if (child.error || child.status !== 0) {
    appendExecutionLog(runDir, "synthesis_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed"
    });
    throw new Error(
      `synthesis/${model} failed: ${child.error?.message || `exit ${child.status}`}`
    );
  }
  let parsed;
  try {
    parsed = parseAssistantOutput(child.stdout, role);
  } catch (error) {
    appendExecutionLog(runDir, "synthesis_invalid_output", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed",
      error: error.message
    });
    throw new Error(`synthesis/${model} returned invalid output: ${error.message}`);
  }
  writeJson(path.join(roleDir, "output.json"), parsed.output);
  writeJson(path.join(roleDir, "metadata.json"), {
    ...metadata,
    status: "completed",
    error: null
  });
  appendExecutionLog(runDir, "synthesis_completed", {
    role,
    model,
    elapsed_ms: Date.now() - startedMs
  });
  return {
    role,
    model,
    output: parsed.output,
    output_file: path.relative(runDir, path.join(roleDir, "output.json"))
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const runDir = path.resolve(requireArg(args, "run-dir"));
  const config = loadWorkspaceReviewFromArgs(args);
  const requestFile = path.join(runDir, "request.json");
  if (!fs.existsSync(requestFile)) {
    throw new Error(`Missing workspace review request: ${requestFile}`);
  }
  const request = parseJsonFile(requestFile);
  request.project_root = validateProjectRoot(request.project_root);
  const reviewPlan = config.execution.compact_plan
    ? compactPlanForReview(request.plan)
    : {
      text: request.plan,
      stats: {
        original_chars: String(request.plan).length,
        compacted_chars: String(request.plan).length,
        saved_chars: 0,
        code_blocks: 0,
        compacted_blocks: 0,
        preserved_blocks: 0
      }
    };
  request.review_plan = reviewPlan.text;
  request.plan_compaction = reviewPlan.stats;
  writeGenerated(path.join(runDir, "review-plan.md"), request.review_plan);
  writeJson(path.join(runDir, "plan-compaction.json"), request.plan_compaction);
  const roles = Array.isArray(request.roles) && request.roles.length
    ? request.roles
    : REVIEW_ROLES;
  for (const role of roles) {
    if (!REVIEW_ROLES.includes(role)) {
      throw new Error(`Invalid workspace review role: ${role}`);
    }
  }

  updateState(runDir, {
    status: "running",
    pid: process.pid,
    started_at: new Date().toISOString(),
    roles,
    project_root: request.project_root,
    error: null
  });
  appendExecutionLog(runDir, "run_started", {
    run_id: request.run_id,
    pid: process.pid,
    roles,
    max_concurrency: config.execution.max_concurrency
  });
  appendExecutionLog(runDir, "plan_compacted", request.plan_compaction);

  try {
    const { reviewerResults, infraErrors } = await runReviewers(config, request, roles, runDir);
    if (!reviewerResults.length) {
      throw new Error("All reviewers failed before producing valid JSON output");
    }
    const factCheck = await runFactCheck(config, request, reviewerResults, runDir);
    const synthesis = await runSynthesis(config, request, reviewerResults, factCheck, runDir);
    const outcome = summarizeReviewOutcome(reviewerResults, factCheck, synthesis, infraErrors);
    const report = {
      run_id: request.run_id,
      project_root: request.project_root,
      created_at: new Date().toISOString(),
      plan_compaction: request.plan_compaction,
      outcome,
      reviewers: Object.fromEntries(reviewerResults.map((item) => [
        item.role,
        {
          model: item.model,
          output_file: item.output_file,
          output: item.output
        }
      ])),
      infra_errors: infraErrors,
      fact_check: {
        model: factCheck.model,
        output_file: factCheck.output_file,
        summary_file: factCheck.summary_file,
        summary: factCheck.summary,
        output: factCheck.output
      },
      synthesis: {
        model: synthesis.model,
        output_file: synthesis.output_file,
        output: synthesis.output
      }
    };
    writeJson(path.join(runDir, "report.json"), report);
    updateState(runDir, {
      status: "completed",
      finished_at: new Date().toISOString(),
      report_file: "report.json",
      error: null,
      infra_errors: infraErrors
    });
    appendExecutionLog(runDir, "run_completed", {
      run_id: request.run_id,
      reviewer_count: reviewerResults.length,
      infra_error_count: infraErrors.length
    });
  } catch (error) {
    appendExecutionLog(runDir, "run_failed", {
      run_id: request.run_id
    });
    updateState(runDir, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: error.stack || error.message
    });
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runRole,
  runWithConcurrency,
  summarizeReviewOutcome,
  runSynthesis
};
