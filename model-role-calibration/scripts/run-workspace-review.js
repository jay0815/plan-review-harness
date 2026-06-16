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

async function runRole(config, request, role, runDir) {
  const model = config.roles[role];
  const startedMs = Date.now();
  const roleDir = path.join(runDir, "roles", role);
  fs.mkdirSync(roleDir, { recursive: true });
  const prompt = buildWorkspacePrompt(
    role,
    request.project_root,
    request.review_plan || request.plan,
    request.context || ""
  );
  const promptFile = path.join(roleDir, "prompt.md");
  writeGenerated(promptFile, prompt);
  const args = buildClaudeWorkspaceArgs(config, model, role, request.project_root);
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
    project_root: request.project_root
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
    appendExecutionLog(runDir, "agent_invalid_output", {
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
  const prompt = buildWorkspacePrompt(
    role,
    request.project_root,
    request.review_plan || request.plan,
    request.context || "",
    reviewerOutputs
  );
  const promptFile = path.join(roleDir, "prompt.md");
  writeGenerated(promptFile, prompt);
  const args = buildClaudeWorkspaceArgs(config, model, role, request.project_root, {
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
    project_root: request.project_root
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
  writeJson(path.join(roleDir, "metadata.json"), {
    ...metadata,
    status: "completed",
    error: null
  });
  appendExecutionLog(runDir, "fact_check_completed", {
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
    const reviewerResults = await runWithConcurrency(
      roles,
      config.execution.max_concurrency,
      (role) => runRole(config, request, role, runDir)
    );
    const factCheck = await runFactCheck(config, request, reviewerResults, runDir);
    const synthesis = await runSynthesis(config, request, reviewerResults, factCheck, runDir);
    const report = {
      run_id: request.run_id,
      project_root: request.project_root,
      created_at: new Date().toISOString(),
      plan_compaction: request.plan_compaction,
      reviewers: Object.fromEntries(reviewerResults.map((item) => [
        item.role,
        {
          model: item.model,
          output_file: item.output_file,
          output: item.output
        }
      ])),
      fact_check: {
        model: factCheck.model,
        output_file: factCheck.output_file,
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
      error: null
    });
    appendExecutionLog(runDir, "run_completed", {
      run_id: request.run_id,
      reviewer_count: reviewerResults.length
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
  runSynthesis
};
