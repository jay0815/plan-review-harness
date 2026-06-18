#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseArgs } = require("./lib");
const { inspect } = require("./inspect-workspace-run");

const REVIEWER_ROLES = ["risk", "architecture", "execution", "rebuttal"];
const JSON_VALIDATOR_TOOL = "mcp__json_validator__validate_json_output";
const INCOMPLETE_STATUSES = new Set(["queued", "running"]);
const DEFAULT_WORKSPACE_RUNS_DIR = path.join(
  os.homedir(),
  ".claude",
  "plan-review-harness",
  "mcp",
  "workspace-runs"
);

function resolveRunDir(args, options = {}) {
  const hasRunDir = args["run-dir"] && args["run-dir"] !== true;
  const hasRunId = args["run-id"] && args["run-id"] !== true;
  if (hasRunDir && hasRunId) {
    throw new Error("Use either --run-id or --run-dir, not both.");
  }
  if (hasRunDir) {
    return path.resolve(String(args["run-dir"]));
  }
  if (hasRunId) {
    const runId = String(args["run-id"]);
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
      throw new Error(`Invalid run id: ${runId}`);
    }
    return path.join(options.workspaceRunsDir || DEFAULT_WORKSPACE_RUNS_DIR, runId);
  }
  throw new Error("Missing required argument: --run-id or --run-dir.");
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function durationMs(start, end) {
  if (!start || !end) {
    return null;
  }
  const value = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(value) ? value : null;
}

function roleByName(inspectSummary) {
  return Object.fromEntries(inspectSummary.roles.map((role) => [role.role, role]));
}

function check(results, id, status, message, details = null) {
  results.push({
    id,
    status,
    message,
    ...(details ? { details } : {})
  });
}

function pass(results, id, message, details = null) {
  check(results, id, "pass", message, details);
}

function warn(results, id, message, details = null) {
  check(results, id, "warn", message, details);
}

function pending(results, id, message, details = null) {
  check(results, id, "pending", message, details);
}

function fail(results, id, message, details = null) {
  check(results, id, "fail", message, details);
}

function summarizeRoles(inspected) {
  return Object.fromEntries(inspected.roles.map((role) => [
    role.role,
    {
      model: role.model,
      elapsed_ms: role.elapsed_ms,
      max_input_tokens: role.usage?.max_input_tokens ?? null,
      read_count: role.read_files.length,
      out_of_boundary_read_count: role.out_of_boundary_read_files.length
    }
  ]));
}

function inspectIfReady(runDir) {
  const rolesDir = path.join(runDir, "roles");
  if (!fs.existsSync(rolesDir)) {
    return {
      run_id: path.basename(runDir),
      run_dir: runDir,
      roles: []
    };
  }
  return inspect(runDir);
}

function infraErrorsFrom(report, state) {
  if (Array.isArray(report?.infra_errors)) {
    return report.infra_errors;
  }
  if (Array.isArray(state?.infra_errors)) {
    return state.infra_errors;
  }
  const error = typeof state?.error === "string" ? state.error : "";
  const match = /([a-z_]+)\/([A-Za-z0-9_-]+) returned invalid output/.exec(error);
  if (match) {
    return [{
      role: match[1],
      model: match[2],
      type: "invalid_output",
      message: error.split("\n")[0]
    }];
  }
  return [];
}

function buildResult({ absoluteRunDir, state, report, inspected, compaction, totalElapsedMs, results, ready }) {
  const counts = {
    pass: results.filter((item) => item.status === "pass").length,
    warn: results.filter((item) => item.status === "warn").length,
    fail: results.filter((item) => item.status === "fail").length,
    pending: results.filter((item) => item.status === "pending").length
  };
  return {
    run_id: path.basename(absoluteRunDir),
    run_dir: absoluteRunDir,
    run_status: state?.status || null,
    ready,
    project_root: state?.project_root || null,
    logs: {
      execution_log: path.join(absoluteRunDir, "execution.log"),
      runner_stdout_log: path.join(absoluteRunDir, "runner.stdout.log"),
      runner_stderr_log: path.join(absoluteRunDir, "runner.stderr.log")
    },
    infra_errors: infraErrorsFrom(report, state),
    outcome: report?.outcome || null,
    valid: ready ? counts.fail === 0 : null,
    counts,
    timings: {
      total_elapsed_ms: totalElapsedMs,
      roles: summarizeRoles(inspected)
    },
    plan_compaction: compaction,
    checks: results
  };
}

function verifyRun(runDir) {
  const absoluteRunDir = path.resolve(runDir);
  const results = [];
  const state = readJsonIfExists(path.join(absoluteRunDir, "state.json"));
  const report = readJsonIfExists(path.join(absoluteRunDir, "report.json"));
  const compaction = readJsonIfExists(path.join(absoluteRunDir, "plan-compaction.json"));
  const executionLog = readTextIfExists(path.join(absoluteRunDir, "execution.log"));
  const inspected = inspectIfReady(absoluteRunDir);
  const roles = roleByName(inspected);
  const runStatus = state?.status || null;
  const ready = runStatus === "completed";
  const incomplete = INCOMPLETE_STATUSES.has(runStatus);

  if (ready) {
    pass(results, "state.completed", "run 状态为 completed");
  } else if (incomplete) {
    pending(results, "state.completed", "run 尚未完成，等待 get_plan_review 返回 completed 后再做完整验证", {
      status: runStatus
    });
  } else {
    fail(results, "state.completed", "run 状态不是 completed", {
      status: runStatus,
      error: state?.error || null
    });
  }

  const totalElapsedMs = durationMs(state?.started_at, state?.finished_at);
  if (Number.isFinite(totalElapsedMs)) {
    pass(results, "timing.total_elapsed", "总耗时可解析", {
      elapsed_ms: totalElapsedMs
    });
  } else if (incomplete) {
    pending(results, "timing.total_elapsed", "run 尚未完成，暂时没有 finished_at，无法计算总耗时");
  } else {
    warn(results, "timing.total_elapsed", "缺少 started_at 或 finished_at，无法计算总耗时");
  }

  if (compaction && Number.isInteger(compaction.original_chars) && Number.isInteger(compaction.compacted_chars)) {
    pass(results, "plan.compaction_present", "plan 压缩指标存在", compaction);
    if ((compaction.saved_chars || 0) > 0) {
      pass(results, "plan.compaction_saved", "review-plan.md 相比原始计划有压缩收益", {
        saved_chars: compaction.saved_chars
      });
    } else {
      warn(results, "plan.compaction_saved", "本次计划没有压缩收益", compaction);
    }
  } else {
    fail(results, "plan.compaction_present", "缺少 plan-compaction.json 或字段不完整");
  }

  if (incomplete) {
    pending(results, "run.await_completion", "本次输出只是运行中快照，不检查尚未产生的 Reviewer/Fact Check/Synthesis 产物", {
      status: runStatus
    });
    return buildResult({
      absoluteRunDir,
      state,
      report,
      inspected,
      compaction,
      totalElapsedMs,
      results,
      ready: false
    });
  }

  const infraErrors = infraErrorsFrom(report, state);
  if (infraErrors.length) {
    warn(results, "run.infra_errors", "存在 Reviewer/模型输出基础设施错误；这不是计划本身的阻塞结论", {
      infra_errors: infraErrors
    });
  } else if (ready) {
    pass(results, "run.infra_errors", "没有 Reviewer 基础设施错误");
  }
  if (ready && report?.outcome?.status) {
    pass(results, "report.outcome", "report.json 包含计划审查 outcome", report.outcome);
  } else if (ready) {
    fail(results, "report.outcome", "report.json 缺少 outcome；新版本运行产物必须包含计划审查结果状态");
  }

  for (const role of REVIEWER_ROLES) {
    const item = roles[role];
    if (!item) {
      fail(results, `reviewer.${role}.present`, `${role} Reviewer 缺失`);
      continue;
    }
    if (item.status === "completed") {
      pass(results, `reviewer.${role}.completed`, `${role} Reviewer 已完成`, {
        model: item.model,
        elapsed_ms: item.elapsed_ms
      });
    } else {
      fail(results, `reviewer.${role}.completed`, `${role} Reviewer 未完成`, {
        status: item.status
      });
    }
    if (item.read_boundary?.mode === "scoped_mirror") {
      pass(results, `reviewer.${role}.scoped_mirror`, `${role} 使用 scoped mirror`, {
        file_count: item.read_boundary.file_count
      });
    } else {
      fail(results, `reviewer.${role}.scoped_mirror`, `${role} 未使用 scoped mirror`, {
        read_boundary: item.read_boundary || null
      });
    }
    if ((item.out_of_boundary_read_files || []).length === 0) {
      pass(results, `reviewer.${role}.no_out_of_boundary_reads`, `${role} 没有越界读取`);
    } else {
      fail(results, `reviewer.${role}.no_out_of_boundary_reads`, `${role} 存在越界读取`, {
        out_of_boundary_read_files: item.out_of_boundary_read_files
      });
    }
  }

  const factCheck = roles.fact_check;
  if (!factCheck) {
    fail(results, "fact_check.present", "Fact Check 阶段缺失");
  } else {
    if (factCheck.status === "completed") {
      pass(results, "fact_check.completed", "Fact Check 已完成", {
        model: factCheck.model,
        elapsed_ms: factCheck.elapsed_ms
      });
    } else {
      fail(results, "fact_check.completed", "Fact Check 未完成", {
        status: factCheck.status
      });
    }
    const grantedNonReadTools = (factCheck.tools || []).filter(
      (name) => name !== "Read" && name !== JSON_VALIDATOR_TOOL
    );
    const usedToolNames = Object.keys(factCheck.tool_counts || {});
    const usedNonReadTools = usedToolNames.filter(
      (name) => name !== "Read" && name !== JSON_VALIDATOR_TOOL
    );
    if (grantedNonReadTools.length === 0 && usedNonReadTools.length === 0) {
      pass(results, "fact_check.read_only", "Fact Check 只获得并使用 Read 工具", {
        tools: factCheck.tools,
        tool_counts: factCheck.tool_counts
      });
    } else {
      fail(results, "fact_check.read_only", "Fact Check 获得或使用了 Read 以外的工具", {
        tools: factCheck.tools,
        tool_counts: factCheck.tool_counts
      });
    }
    if (factCheck.read_boundary?.mode === "scoped_mirror") {
      pass(results, "fact_check.scoped_mirror", "Fact Check 使用 scoped mirror", {
        file_count: factCheck.read_boundary.file_count
      });
    } else {
      fail(results, "fact_check.scoped_mirror", "Fact Check 未使用 scoped mirror", {
        read_boundary: factCheck.read_boundary || null
      });
    }
    if ((factCheck.out_of_boundary_read_files || []).length === 0) {
      pass(results, "fact_check.no_out_of_boundary_reads", "Fact Check 没有越界读取");
    } else {
      fail(results, "fact_check.no_out_of_boundary_reads", "Fact Check 存在越界读取", {
        out_of_boundary_read_files: factCheck.out_of_boundary_read_files
      });
    }
    if (factCheck.fact_check_summary) {
      pass(results, "fact_check.summary_present", "Fact Check strictness summary 存在", factCheck.fact_check_summary);
      if (["all_verified", "no_issues_checked"].includes(factCheck.fact_check_summary.strictness_signal)) {
        warn(results, "fact_check.strictness_signal", "Fact Check 本轮没有挑战性信号，需要人工关注是否偏宽或无可检验问题", {
          strictness_signal: factCheck.fact_check_summary.strictness_signal,
          status_counts: factCheck.fact_check_summary.status_counts
        });
      } else {
        pass(results, "fact_check.strictness_signal", "Fact Check strictness signal 有区分度", {
          strictness_signal: factCheck.fact_check_summary.strictness_signal,
          status_counts: factCheck.fact_check_summary.status_counts
        });
      }
    } else {
      fail(results, "fact_check.summary_present", "缺少 roles/fact_check/fact-check-summary.json");
    }
  }

  const synthesis = roles.synthesis;
  if (!synthesis) {
    fail(results, "synthesis.present", "Synthesis 阶段缺失");
  } else {
    if (synthesis.status === "completed") {
      pass(results, "synthesis.completed", "Synthesis 已完成", {
        model: synthesis.model,
        elapsed_ms: synthesis.elapsed_ms
      });
    } else {
      fail(results, "synthesis.completed", "Synthesis 未完成", {
        status: synthesis.status
      });
    }
    const synthesisProjectTools = (synthesis.tools || []).filter(
      (name) => name !== JSON_VALIDATOR_TOOL
    );
    const synthesisProjectToolCalls = Object.keys(synthesis.tool_counts || {}).filter(
      (name) => name !== JSON_VALIDATOR_TOOL
    );
    if (synthesisProjectTools.length === 0 && synthesisProjectToolCalls.length === 0) {
      pass(results, "synthesis.no_tools", "Synthesis 未获得工程读取工具，仅允许 JSON validator");
    } else {
      fail(results, "synthesis.no_tools", "Synthesis 仍有可用工具或工具调用", {
        tools: synthesis.tools,
        tool_counts: synthesis.tool_counts
      });
    }
    if ((synthesis.read_files || []).length === 0) {
      pass(results, "synthesis.no_reads", "Synthesis 没有读取工程文件");
    } else {
      fail(results, "synthesis.no_reads", "Synthesis 读取了工程文件", {
        read_files: synthesis.read_files
      });
    }
  }

  if (report?.fact_check?.summary) {
    pass(results, "report.fact_check_summary", "report.json 包含 fact_check.summary");
  } else {
    fail(results, "report.fact_check_summary", "report.json 缺少 fact_check.summary");
  }
  if (executionLog.includes("read_scope_prepared")) {
    pass(results, "log.read_scope_prepared", "execution.log 包含 read_scope_prepared");
  } else {
    fail(results, "log.read_scope_prepared", "execution.log 缺少 read_scope_prepared");
  }
  if (executionLog.includes("fact_check_summary")) {
    pass(results, "log.fact_check_summary", "execution.log 包含 fact_check_summary");
  } else {
    fail(results, "log.fact_check_summary", "execution.log 缺少 fact_check_summary");
  }

  return buildResult({
    absoluteRunDir,
    state,
    report,
    inspected,
    compaction,
    totalElapsedMs,
    results,
    ready: true
  });
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return "-";
  }
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

function printMarkdown(result) {
  console.log(`# Plan Review Run Verification: ${result.run_id}`);
  console.log("");
  console.log(`Run dir: ${result.run_dir}`);
  console.log(`Project root: ${result.project_root || "-"}`);
  console.log(`Execution log: ${result.logs.execution_log}`);
  console.log(`Run status: ${result.run_status || "-"}`);
  const label = result.ready ? (result.valid ? "PASS" : "FAIL") : "NOT_READY";
  console.log(`Result: ${label} (${result.counts.pass} pass, ${result.counts.warn} warn, ${result.counts.fail} fail, ${result.counts.pending} pending)`);
  console.log(`Total elapsed: ${formatDuration(result.timings.total_elapsed_ms)}`);
  if (result.plan_compaction) {
    console.log(`Plan compaction: ${result.plan_compaction.original_chars} -> ${result.plan_compaction.compacted_chars}, saved ${result.plan_compaction.saved_chars}`);
  }
  if (result.infra_errors.length) {
    console.log(`Infra errors: ${result.infra_errors.length}`);
  }
  if (result.outcome) {
    console.log(`Outcome: ${result.outcome.status} - ${result.outcome.message}`);
  }
  console.log("");
  console.log("| Check | Status | Message |");
  console.log("|---|---|---|");
  for (const item of result.checks) {
    console.log(`| ${item.id} | ${item.status.toUpperCase()} | ${item.message.replace(/\|/g, "\\|")} |`);
  }
  console.log("");
  console.log("| Role | Model | Elapsed | Reads | Out-of-boundary | Max input tokens |");
  console.log("|---|---|---:|---:|---:|---:|");
  for (const [role, value] of Object.entries(result.timings.roles)) {
    console.log([
      `| ${role}`,
      value.model || "-",
      formatDuration(value.elapsed_ms),
      value.read_count,
      value.out_of_boundary_read_count,
      value.max_input_tokens ?? "-"
    ].join(" | ") + " |");
  }
}

function main() {
  const args = parseArgs(process.argv);
  const result = verifyRun(resolveRunDir(args));
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printMarkdown(result);
  }
  if (!result.ready) {
    process.exitCode = 2;
  } else if (!result.valid) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  resolveRunDir,
  verifyRun
};
