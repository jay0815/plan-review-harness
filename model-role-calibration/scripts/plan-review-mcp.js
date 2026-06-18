#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  ROOT,
  parseArgs,
  parseJsonFile,
  writeFileNew
} = require("./lib");
const {
  REVIEW_ROLES,
  MAX_EXECUTOR_RETRIES,
  loadWorkspaceReviewFromArgs,
  configSummary,
  validateProjectRoot,
  runDirectory,
  executionLogPath,
  appendExecutionLog,
  updateState,
  redactedSettingsWarnings,
  withoutAnthropicApiKey
} = require("./workspace-review-lib");

const DEFAULT_WAIT_MS = 60000;
const MAX_WAIT_MS = 300000;
const STATUS_POLL_MS = 1000;
const PROGRESS_INTERVAL_MS = 5000;
const MAX_PLAN_BYTES = 2 * 1024 * 1024;

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function uniqueRunId(config, date = new Date()) {
  const base = `workspace-review-${compactTimestamp(date)}`;
  let runId = base;
  let index = 2;
  while (fs.existsSync(runDirectory(config, runId))) {
    runId = `${base}-${index}`;
    index += 1;
  }
  return runId;
}

function toolList() {
  return [
    {
      name: "configuration_status",
      description: "返回已通过启动校验的模型 settings 路径和角色路由，不返回任何密钥。",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: "start_plan_review",
      description: [
        "启动一次后台 Plan Review；同一计划只调用一次本工具。",
        "启动后会先执行本地确定性 Plan 结构检查，并将结果保存为 plan-authoring-lint.json；该步骤不调用模型。",
        "结构检查 error 会使最终 outcome 至少为 needs_revision，warning 只展示不自动阻塞。",
        "评审模型只能使用 Read、Glob、Grep 读取 project_root，不能修改文件或执行 Bash。",
        "Reviewer 完成后会先执行 Fact Check 校验 evidence，Synthesizer 不读取工程目录，只基于计划、Reviewer JSON 和 Fact Check 报告合成。",
        "返回后必须立即使用 next_action 指定的参数调用 get_plan_review。",
        "不要自行读取 execution_log 判断完成状态，也不要使用 Bash、sleep、Monitor 或其他轮询方式。"
      ].join(" "),
      annotations: {
        title: "启动计划评审",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        properties: {
          project_root: {
            type: "string",
            description: [
              "允许评审模型只读访问的项目绝对路径。",
              "通常省略，MCP 会使用 Claude Code 提供的 CLAUDE_PROJECT_DIR。"
            ].join("")
          },
          plan: {
            type: "string",
            description: "待评审计划全文。仅在没有计划文件、由用户直接粘贴正文时使用。"
          },
          plan_file: {
            type: "string",
            description: [
              "待评审 Markdown 文件的绝对路径。",
              "有计划文件时优先使用本字段，不要先读取文件并传入 plan。"
            ].join("")
          },
          context: {
            type: "string",
            description: "可选的需求、约束或变更范围。"
          },
          roles: {
            type: "array",
            items: {
              type: "string",
              enum: REVIEW_ROLES
            },
            description: "可选 Reviewer 列表；默认运行 risk、architecture、execution、rebuttal。"
          }
        },
        oneOf: [
          {
            required: ["plan"],
            not: {
              required: ["plan_file"]
            }
          },
          {
            required: ["plan_file"],
            not: {
              required: ["plan"]
            }
          }
        ],
        additionalProperties: false
      }
    },
    {
      name: "retry_plan_review_stage",
      description: [
        "对失败或包含 Reviewer 基础设施错误、但已有中间产物的 Plan Review 执行断点重试。",
        "stage=reviewers 只重跑失败或缺失的 Reviewer，成功后继续 Fact Check 和 Synthesis。",
        "stage=fact_check 复用全部 Reviewer，重跑 Fact Check 和 Synthesis。",
        "stage=synthesis 复用 Reviewer 与 Fact Check，只重跑 Synthesis。",
        `每个 executor 最多重试 ${MAX_EXECUTOR_RETRIES} 次，超过上限会在调用模型前拒绝。`,
        "返回后必须立即使用 next_action 指定的参数调用 get_plan_review。"
      ].join(" "),
      annotations: {
        title: "重试计划评审阶段",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        required: ["run_id", "stage"],
        properties: {
          run_id: {
            type: "string",
            description: "需要断点重试的 workspace review run_id。"
          },
          stage: {
            type: "string",
            enum: ["reviewers", "fact_check", "synthesis"],
            description: "按失败阶段选择 reviewers、fact_check 或 synthesis。"
          },
          force: {
            type: "boolean",
            description: "仅当确认旧进程已死亡但 state 仍为 queued 或 running 时使用；默认 false。"
          }
        },
        additionalProperties: false
      }
    },
    {
      name: "get_plan_review",
      description: [
        "这是等待 Plan Review 完成的唯一状态接口。",
        "默认在 MCP 调用内等待最多 60 秒，并通过 progress notification 报告 Agent 进度。",
        "收到 progress notification 表示 Reviewer、Fact Check 或 Synthesis 正常执行，应保持当前工具调用等待，不要发起其他状态查询。",
        "禁止使用 Bash、sleep、Monitor、execution_log 或 claude mcp call 观察状态。",
        "只有当本工具返回 status=running 和 next_action 时，才按 next_action 再次调用。",
        "status=completed 时直接使用返回的结构化报告。"
      ].join(" "),
      annotations: {
        title: "等待计划评审",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        required: ["run_id"],
        properties: {
          run_id: {
            type: "string",
            description: "必须使用 start_plan_review 返回的 run_id。"
          },
          include_report: {
            type: "boolean",
            description: "完成后是否返回 report.json 内容，默认 true。"
          },
          wait_ms: {
            type: "integer",
            minimum: 0,
            maximum: MAX_WAIT_MS,
            description: [
              "在本次 MCP 调用内等待完成的最长时间。",
              "通常省略并使用默认 60000；不要为了主动轮询而设为 0。"
            ].join("")
          }
        },
        additionalProperties: false
      }
    }
  ];
}

function textResult(value, isError = false) {
  return {
    content: [{
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
    }],
    isError
  };
}

function resolvePlanInput(input) {
  const hasPlan = typeof input.plan === "string";
  const hasPlanFile = typeof input.plan_file === "string";
  if (hasPlan === hasPlanFile) {
    throw new Error("Provide exactly one of plan or plan_file");
  }
  if (hasPlan) {
    if (!input.plan.trim()) {
      throw new Error("plan must be a non-empty string");
    }
    return {
      plan: input.plan,
      plan_file: null
    };
  }

  if (!input.plan_file.trim()) {
    throw new Error("plan_file must be a non-empty absolute path");
  }
  if (!path.isAbsolute(input.plan_file)) {
    throw new Error("plan_file must be an absolute path");
  }
  const planFile = path.normalize(input.plan_file);
  if (!fs.existsSync(planFile)) {
    throw new Error(`Plan file does not exist: ${planFile}`);
  }
  const stat = fs.statSync(planFile);
  if (!stat.isFile()) {
    throw new Error(`Plan path is not a file: ${planFile}`);
  }
  if (stat.size > MAX_PLAN_BYTES) {
    throw new Error(
      `Plan file exceeds ${MAX_PLAN_BYTES} bytes: ${planFile}`
    );
  }
  fs.accessSync(planFile, fs.constants.R_OK);
  const plan = fs.readFileSync(planFile, "utf8");
  if (!plan.trim()) {
    throw new Error(`Plan file is empty: ${planFile}`);
  }
  return {
    plan,
    plan_file: planFile
  };
}

function startPlanReview(config, input) {
  const planInput = resolvePlanInput(input);
  const projectRoot = validateProjectRoot(
    input.project_root || process.env.CLAUDE_PROJECT_DIR
  );
  const roles = input.roles?.length ? [...new Set(input.roles)] : REVIEW_ROLES;
  for (const role of roles) {
    if (!REVIEW_ROLES.includes(role)) {
      throw new Error(`Invalid review role: ${role}`);
    }
  }

  const runId = uniqueRunId(config);
  const runDir = runDirectory(config, runId);
  fs.mkdirSync(config.workspace_runs_dir, { recursive: true });
  fs.mkdirSync(runDir, { recursive: false });
  const request = {
    run_id: runId,
    created_at: new Date().toISOString(),
    project_root: projectRoot,
    plan: planInput.plan,
    plan_file: planInput.plan_file,
    context: input.context || "",
    roles
  };
  writeFileNew(path.join(runDir, "request.json"), JSON.stringify(request, null, 2) + "\n");
  writeFileNew(path.join(runDir, "state.json"), JSON.stringify({
    run_id: runId,
    status: "queued",
    created_at: request.created_at,
    updated_at: request.created_at,
    project_root: projectRoot,
    roles,
    execution_log: executionLogPath(runDir),
    error: null
  }, null, 2) + "\n");
  appendExecutionLog(runDir, "run_queued", {
    run_id: runId,
    roles
  });

  const stdoutFd = fs.openSync(path.join(runDir, "runner.stdout.log"), "a");
  const stderrFd = fs.openSync(path.join(runDir, "runner.stderr.log"), "a");
  const runner = path.join(ROOT, "scripts", "run-workspace-review.js");
  const child = spawn(process.execPath, [
    runner,
    ...config.loader_args,
    "--run-dir",
    runDir
  ], {
    cwd: path.resolve(ROOT, ".."),
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    env: withoutAnthropicApiKey(process.env)
  });
  child.on("error", (error) => {
    appendExecutionLog(runDir, "runner_start_failed", {
      run_id: runId
    });
    updateState(runDir, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: `Unable to start workspace review runner: ${error.message}`
    });
  });
  child.unref();
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);

  return {
    run_id: runId,
    status: "queued",
    pid: child.pid,
    project_root: projectRoot,
    roles,
    run_dir: runDir,
    execution_log: executionLogPath(runDir),
    next_action: {
      tool: "get_plan_review",
      arguments: {
        run_id: runId,
        include_report: true,
        wait_ms: DEFAULT_WAIT_MS
      },
      instruction: [
        "立即调用 get_plan_review，并保持该工具调用等待 progress notification。",
        "不要调用 Bash、sleep、Monitor、execution_log 或其他状态检查方式。"
      ].join("")
    }
  };
}

function retryPlanReviewStage(config, input) {
  const runId = String(input.run_id || "");
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new Error(`Invalid run_id: ${runId}`);
  }
  if (!["reviewers", "fact_check", "synthesis"].includes(input.stage)) {
    throw new Error(`Unsupported retry stage: ${input.stage}`);
  }
  const runDir = runDirectory(config, runId);
  const stateFile = path.join(runDir, "state.json");
  if (!fs.existsSync(stateFile)) {
    throw new Error(`Unknown plan review run: ${runId}`);
  }
  const state = parseJsonFile(stateFile);
  if (["queued", "running"].includes(state.status) && !input.force) {
    throw new Error("Run is still queued or running. Retry only after it fails, or pass force when the old process is known to be dead.");
  }
  const roles = Array.isArray(state.roles) && state.roles.length ? state.roles : REVIEW_ROLES;
  const reviewerCompleted = (role) => {
    const outputFile = path.join(runDir, "roles", role, "output.json");
    const metadataFile = path.join(runDir, "roles", role, "metadata.json");
    if (!fs.existsSync(outputFile) || !fs.existsSync(metadataFile)) {
      return false;
    }
    return parseJsonFile(metadataFile).status === "completed";
  };
  const incompleteReviewers = roles.filter((role) => !reviewerCompleted(role));
  if (input.stage === "reviewers" && !incompleteReviewers.length) {
    throw new Error("Cannot retry reviewers: all requested reviewers are already completed");
  }
  if (input.stage !== "reviewers" && incompleteReviewers.length) {
    throw new Error(
      `Cannot retry ${input.stage}; incomplete reviewer(s): ${incompleteReviewers.join(", ")}`
    );
  }
  if (input.stage === "synthesis") {
    const requiredFiles = [
      "roles/fact_check/output.json",
      "roles/fact_check/fact-check-summary.json",
      "roles/fact_check/metadata.json"
    ];
    const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(runDir, file)));
    if (missing.length) {
      throw new Error(`Cannot retry synthesis; missing prerequisite artifact(s): ${missing.join(", ")}`);
    }
    const factCheckMetadata = parseJsonFile(path.join(
      runDir,
      "roles",
      "fact_check",
      "metadata.json"
    ));
    if (factCheckMetadata.status !== "completed") {
      throw new Error(`Cannot retry synthesis; fact_check status is ${factCheckMetadata.status || "unknown"}`);
    }
  }
  const retryCounts = state.retry_counts || {};
  const plannedExecutors = input.stage === "reviewers"
    ? [...incompleteReviewers, "fact_check", "synthesis"]
    : input.stage === "fact_check"
      ? ["fact_check", "synthesis"]
      : ["synthesis"];
  const exhausted = [...new Set(plannedExecutors)].filter(
    (executor) => Number(retryCounts[executor] || 0) >= MAX_EXECUTOR_RETRIES
  );
  if (exhausted.length) {
    throw new Error(
      `Retry limit reached (${MAX_EXECUTOR_RETRIES}) for executor(s): ${exhausted.join(", ")}`
    );
  }

  updateState(runDir, {
    status: "queued",
    retry_stage: input.stage,
    retry_queued_at: new Date().toISOString(),
    error: null,
    retry_limit: MAX_EXECUTOR_RETRIES
  });
  appendExecutionLog(runDir, "stage_retry_queued", {
    stage: input.stage,
    retry_roles: input.stage === "reviewers" ? incompleteReviewers : []
  });

  const stdoutFd = fs.openSync(path.join(runDir, "runner.stdout.log"), "a");
  const stderrFd = fs.openSync(path.join(runDir, "runner.stderr.log"), "a");
  const runner = path.join(ROOT, "scripts", "retry-workspace-review-stage.js");
  const child = spawn(process.execPath, [
    runner,
    ...config.loader_args,
    "--run-dir",
    runDir,
    "--stage",
    input.stage,
    ...(input.force ? ["--force"] : [])
  ], {
    cwd: path.resolve(ROOT, ".."),
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    env: withoutAnthropicApiKey(process.env)
  });
  child.on("error", (error) => {
    appendExecutionLog(runDir, "stage_retry_start_failed", {
      stage: input.stage
    });
    updateState(runDir, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: `Unable to start workspace review stage retry: ${error.message}`
    });
  });
  child.unref();
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);

  return {
    run_id: runId,
    status: "queued",
    stage: input.stage,
    pid: child.pid,
    run_dir: runDir,
    execution_log: executionLogPath(runDir),
    next_action: {
      tool: "get_plan_review",
      arguments: {
        run_id: runId,
        include_report: true,
        wait_ms: DEFAULT_WAIT_MS
      },
      instruction: [
        "立即调用 get_plan_review，并保持该工具调用等待 progress notification。",
        "不要调用 Bash、sleep、Monitor、execution_log 或其他状态检查方式。"
      ].join("")
    }
  };
}

function parseExecutionLogLine(line) {
  const match = /^\[[^\]]+\]\s+(\S+)(?:\s+(.*))?$/.exec(line);
  if (!match) {
    return null;
  }
  const details = {};
  const fieldPattern = /(\w+)=("(?:\\.|[^"])*"|\[[^\]]*\]|\{[^}]*\}|[^\s]+)/g;
  let field;
  while ((field = fieldPattern.exec(match[2] || "")) !== null) {
    try {
      details[field[1]] = JSON.parse(field[2]);
    } catch {
      details[field[1]] = field[2];
    }
  }
  return {
    event: match[1],
    ...details
  };
}

function progressSnapshot(config, runDir, state) {
  const reviewers = Object.fromEntries((state.roles || []).map((role) => [
    role,
    {
      model: config.roles[role],
      status: "pending"
    }
  ]));
  let factCheck = {
    model: config.roles.fact_check,
    status: "pending"
  };
  let synthesis = {
    model: config.roles.synthesis,
    status: "pending"
  };
  const logFile = executionLogPath(runDir);
  if (fs.existsSync(logFile)) {
    const events = fs.readFileSync(logFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(parseExecutionLogLine)
      .filter(Boolean);
    for (const event of events) {
      if (
        event.event === "stage_retry_queued" ||
        event.event === "stage_retry_started"
      ) {
        if (event.stage === "reviewers") {
          const retryRoles = Array.isArray(event.retry_roles) ? event.retry_roles : [];
          for (const role of retryRoles) {
            if (reviewers[role]) {
              reviewers[role].status = "pending";
            }
          }
          factCheck.status = "pending";
          synthesis.status = "pending";
        } else if (event.stage === "fact_check") {
          factCheck.status = "pending";
          synthesis.status = "pending";
        } else if (event.stage === "synthesis") {
          synthesis.status = "pending";
        }
      }
      if (event.role && reviewers[event.role]) {
        if (event.event === "agent_started") {
          reviewers[event.role].status = "running";
        } else if (event.event === "agent_completed") {
          reviewers[event.role].status = "completed";
        } else if (
          event.event === "agent_failed" ||
          event.event === "agent_invalid_output"
        ) {
          reviewers[event.role].status = "failed";
        }
      }
      if (event.event === "fact_check_started") {
        factCheck = {
          model: event.model || factCheck.model,
          status: "running"
        };
      } else if (event.event === "fact_check_completed") {
        factCheck = {
          model: event.model || factCheck.model,
          status: "completed"
        };
      } else if (
        event.event === "fact_check_failed" ||
        event.event === "fact_check_invalid_output"
      ) {
        factCheck = {
          model: event.model || factCheck.model,
          status: "failed"
        };
      }
      if (event.event === "synthesis_started") {
        synthesis = {
          model: event.model || synthesis.model,
          status: "running"
        };
      } else if (event.event === "synthesis_completed") {
        synthesis = {
          model: event.model || synthesis.model,
          status: "completed"
        };
      } else if (
        event.event === "synthesis_failed" ||
        event.event === "synthesis_invalid_output"
      ) {
        synthesis = {
          model: event.model || synthesis.model,
          status: "failed"
        };
      }
    }
  }

  const reviewerValues = Object.values(reviewers);
  const completedReviewers = reviewerValues.filter(
    (item) => item.status === "completed"
  ).length;
  const active = Object.entries(reviewers)
    .filter(([, item]) => item.status === "running")
    .map(([role, item]) => `${role}/${item.model}`);
  if (factCheck.status === "running") {
    active.push(`fact_check/${factCheck.model}`);
  }
  if (synthesis.status === "running") {
    active.push(`synthesis/${synthesis.model}`);
  }
  const infraErrorCount = Array.isArray(state.infra_errors) ? state.infra_errors.length : 0;
  const message = state.status === "completed"
    ? infraErrorCount
      ? `计划评审已完成但存在 ${infraErrorCount} 个 Reviewer 基础设施错误：Reviewer ${completedReviewers}/${reviewerValues.length} 已完成；Fact Check 已完成；Synthesis 已完成。`
      : `计划评审已完成：Reviewer ${completedReviewers}/${reviewerValues.length}，Fact Check 已完成，Synthesis 已完成。`
    : state.status === "failed"
      ? `计划评审失败：Reviewer ${completedReviewers}/${reviewerValues.length} 已完成；Fact Check ${factCheck.status}；Synthesis ${synthesis.status}。`
      : [
        `计划评审执行中：Reviewer ${completedReviewers}/${reviewerValues.length} 已完成`,
        active.length ? `运行中 ${active.join(", ")}` : "等待下一阶段",
        `Fact Check ${factCheck.status}`,
        `Synthesis ${synthesis.status}`
      ].join("；") + "。";
  return {
    reviewers,
    fact_check: factCheck,
    synthesis,
    completed_reviewers: completedReviewers,
    total_reviewers: reviewerValues.length,
    active,
    message
  };
}

function planReviewResult(config, input) {
  const runDir = runDirectory(config, input.run_id);
  const stateFile = path.join(runDir, "state.json");
  if (!fs.existsSync(stateFile)) {
    throw new Error(`Unknown plan review run: ${input.run_id}`);
  }
  const state = parseJsonFile(stateFile);
  const result = {
    ...state,
    run_dir: runDir,
    execution_log: executionLogPath(runDir),
    progress: progressSnapshot(config, runDir, state)
  };
  const includeReport = input.include_report !== false;
  const reportFile = path.join(runDir, "report.json");
  if (includeReport && state.status === "completed" && fs.existsSync(reportFile)) {
    result.report = parseJsonFile(reportFile);
  }
  if (state.status === "completed" || state.status === "failed") {
    result.next_action = null;
  }
  return result;
}

function waitDuration(input) {
  const value = input.wait_ms === undefined ? DEFAULT_WAIT_MS : Number(input.wait_ms);
  if (!Number.isInteger(value) || value < 0 || value > MAX_WAIT_MS) {
    throw new Error(`wait_ms must be an integer between 0 and ${MAX_WAIT_MS}`);
  }
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPlanReview(config, input, onProgress = null) {
  const waitMs = waitDuration(input);
  const startedAt = Date.now();
  let lastNotificationAt = 0;
  let lastSignature = "";
  let progressSequence = 0;

  while (true) {
    const result = planReviewResult(config, input);
    if (result.status === "completed" || result.status === "failed") {
      return result;
    }

    const signature = JSON.stringify(result.progress);
    const now = Date.now();
    if (
      onProgress &&
      (signature !== lastSignature || now - lastNotificationAt >= PROGRESS_INTERVAL_MS)
    ) {
      progressSequence += 1;
      onProgress({
        progress: progressSequence,
        message: result.progress.message
      });
      lastSignature = signature;
      lastNotificationAt = now;
    }

    const elapsedMs = now - startedAt;
    if (waitMs === 0 || elapsedMs >= waitMs) {
      return {
        ...result,
        wait: {
          timed_out: waitMs > 0,
          waited_ms: elapsedMs
        },
        next_action: {
          tool: "get_plan_review",
          arguments: {
            run_id: input.run_id,
            include_report: input.include_report !== false,
            wait_ms: DEFAULT_WAIT_MS
          },
          instruction: [
            "评审仍在 MCP 后台正常执行。",
            "立即按以上参数再次调用 get_plan_review。",
            "不要调用 Bash、sleep、Monitor、execution_log 或 claude mcp call。"
          ].join("")
        }
      };
    }
    await delay(Math.min(STATUS_POLL_MS, waitMs - elapsedMs));
  }
}

function createHandler(config) {
  return async function handle(message, sendNotification = null) {
    if (message.method === "initialize") {
      return {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "plan-review-harness",
          version: "1.0.0"
        },
        instructions: [
          "同一计划只调用一次 start_plan_review。",
          "随后立即使用返回的 next_action 参数调用 get_plan_review。",
          "收到 progress notification 时保持当前 get_plan_review 调用等待。",
          "只有 get_plan_review 返回 status=running 和 next_action 时才再次调用。",
          `若 get_plan_review 返回失败，或 completed 但 Reviewer 未全部完成，可按 progress 调用 retry_plan_review_stage：reviewers 只重跑失败节点，fact_check 或 synthesis 复用已完成上游；每个 executor 最多重试 ${MAX_EXECUTOR_RETRIES} 次。`,
          "禁止使用 Bash、sleep、Monitor、execution_log 或外部命令观察评审状态。",
          "禁止暴露或请求 ANTHROPIC_API_KEY。"
        ].join(" ")
      };
    }
    if (message.method === "notifications/initialized") {
      return null;
    }
    if (message.method === "tools/list") {
      return {
        tools: toolList()
      };
    }
    if (message.method === "tools/call") {
      const name = message.params?.name;
      const input = message.params?.arguments || {};
      if (name === "configuration_status") {
        return textResult({
          valid: true,
          ...configSummary(config),
          warnings: redactedSettingsWarnings(config)
        });
      }
      if (name === "start_plan_review") {
        return textResult(startPlanReview(config, input));
      }
      if (name === "retry_plan_review_stage") {
        return textResult(retryPlanReviewStage(config, input));
      }
      if (name === "get_plan_review") {
        const progressToken = message.params?._meta?.progressToken;
        const notifyProgress = (
          sendNotification &&
          (typeof progressToken === "string" || typeof progressToken === "number")
        )
          ? (progress) => sendNotification("notifications/progress", {
            progressToken,
            ...progress
          })
          : null;
        return textResult(await getPlanReview(config, input, notifyProgress));
      }
      throw new Error(`Unknown tool: ${name}`);
    }
    throw new Error(`Unknown method: ${message.method}`);
  };
}

function response(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function notification(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function errorResponse(id, code, message) {
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  }) + "\n");
}

function main() {
  const args = parseArgs(process.argv);
  const config = loadWorkspaceReviewFromArgs(args);
  const warnings = redactedSettingsWarnings(config);
  if (args["validate-only"]) {
    console.log(JSON.stringify({
      valid: true,
      ...configSummary(config),
      warnings
    }, null, 2));
    return;
  }

  console.error(
    `[plan-review-mcp] configuration valid: ${Object.keys(config.models).join(", ")}`
  );
  for (const warning of warnings) {
    console.error(`[plan-review-mcp] warning: ${warning}`);
  }

  const handle = createHandler(config);
  async function processMessage(message) {
    try {
      const result = await handle(message, notification);
      if (message.method === "notifications/initialized") {
        return;
      }
      response(message.id, result);
    } catch (error) {
      console.error(error.stack || error.message);
      errorResponse(message?.id ?? null, -32603, error.message);
    }
  }
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) {
        continue;
      }
      try {
        const message = JSON.parse(line);
        void processMessage(message);
      } catch (error) {
        console.error(error.stack || error.message);
        errorResponse(null, -32700, error.message);
      }
    }
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[plan-review-mcp] startup validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  compactTimestamp,
  uniqueRunId,
  toolList,
  resolvePlanInput,
  startPlanReview,
  retryPlanReviewStage,
  parseExecutionLogLine,
  progressSnapshot,
  planReviewResult,
  getPlanReview,
  createHandler
};
