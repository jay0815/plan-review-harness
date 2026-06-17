#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const {
  ROOT,
  ensureDir,
  loadConfig,
  parseArgs,
  parseJsonFile,
  readText,
  requireArg,
  slug,
  writeFileNew,
  writeGenerated
} = require("./lib");
const {
  FACT_CHECK_ROOT,
  assertFactCheckCaseId,
  ingestOutput,
  loadCase,
  renderFactCheckPrompt,
  scoreOutput,
  summarizeRun
} = require("./fact-check-calibration-lib");
const {
  buildFactCheckReadScope,
  copyScopedWorkspace
} = require("./workspace-review-lib");
const {
  buildCliArgs,
  parseAssistantOutput,
  resolveWrapperCommand,
  runCommand
} = require("./run-model");

const CALIBRATION_PROBE = "fact_check";
const DEFAULT_CONCURRENCY = 2;

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function promptPaths(run, caseId) {
  return path.join(FACT_CHECK_ROOT, "runs", run, caseId, "prompts");
}

function scopedPaths(run, caseId) {
  return path.join(FACT_CHECK_ROOT, "runs", run, caseId, "scoped");
}

function artifactPaths(run, caseId, model) {
  const base = path.join(FACT_CHECK_ROOT, "runs", run, caseId);
  const modelSlug = slug(model);
  return {
    base,
    outputDir: path.join(base, "agent-outputs", modelSlug),
    attemptsDir: path.join(base, "agent-outputs", modelSlug, "attempts"),
    resultFile: path.join(base, "agent-outputs", modelSlug, "result.json"),
    rawCliFile: path.join(base, "agent-outputs", modelSlug, "cli.json"),
    metadataFile: path.join(base, "agent-outputs", modelSlug, "meta.json")
  };
}

function nextAttempt(paths) {
  ensureDir(paths.attemptsDir);
  const attempts = fs.readdirSync(paths.attemptsDir)
    .map((name) => /^attempt-(\d+)\.meta\.json$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const number = attempts.length ? Math.max(...attempts) + 1 : 1;
  const label = `attempt-${String(number).padStart(3, "0")}`;
  return {
    number,
    label,
    rawCliFile: path.join(paths.attemptsDir, `${label}.cli.json`),
    rawTextFile: path.join(paths.attemptsDir, `${label}.cli.txt`),
    resultFile: path.join(paths.attemptsDir, `${label}.result.json`),
    metadataFile: path.join(paths.attemptsDir, `${label}.meta.json`),
    validatorLogFile: path.join(paths.attemptsDir, `${label}.validator.log`)
  };
}

function completedOutputExists(run, caseId, model) {
  const normalized = path.join(
    FACT_CHECK_ROOT,
    "runs",
    run,
    caseId,
    "outputs",
    "normalized",
    `${slug(model)}.json`
  );
  return fs.existsSync(normalized);
}

function log(message) {
  console.error(`[run-fact-check] ${new Date().toISOString()} ${message}`);
}

function renderScopedPrompt(fixture, projectRoot, readBoundary) {
  const fileList = readBoundary.files?.length
    ? readBoundary.files.map((file) => `- ${file}`).join("\n")
    : "- （无可读取工程文件）";
  const blocked = readBoundary.blocked_refs?.length
    ? [
      "",
      "已阻止的外部路径引用：",
      ...readBoundary.blocked_refs.map((item) => `- ${item}`)
    ].join("\n")
    : "";
  const skipped = readBoundary.skipped_refs?.length
    ? [
      "",
      "未暴露或不存在的引用：",
      ...readBoundary.skipped_refs.slice(0, 30).map((item) => `- ${item}`)
    ].join("\n")
    : "";
  return [
    "# 工程读取能力",
    "",
    `工程原始目录：\`${projectRoot}\``,
    `只读镜像目录：\`${readBoundary.exposed_root}\``,
    "",
    "你可以且只能使用 Read 读取下列相对路径对应的镜像文件。",
    "读取时使用只读镜像目录下的绝对路径；禁止使用 Glob/Grep 搜索新证据，禁止新增 Reviewer 未提出的问题。",
    "",
    "可读取文件：",
    fileList,
    blocked,
    skipped,
    "",
    renderFactCheckPrompt(fixture)
  ].filter(Boolean).join("\n");
}

function extractValidatorCandidate(stdout) {
  const lines = String(stdout || "").trim().split(/\n+/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    const content = event.message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const block = content[contentIndex];
      if (
        block?.type === "tool_use" &&
        block.name === "mcp__json_validator__validate_json_output" &&
        typeof block.input?.candidate_text === "string"
      ) {
        try {
          return parseAssistantOutput(block.input.candidate_text, CALIBRATION_PROBE);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function writeCompletedArtifacts(paths, attempt, metadata, parsed) {
  metadata.status = "completed";
  metadata.error = null;
  writeFileNew(attempt.rawCliFile, JSON.stringify(parsed.envelope, null, 2) + "\n");
  writeFileNew(attempt.resultFile, JSON.stringify(parsed.output, null, 2) + "\n");
  writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + "\n");
  writeGenerated(paths.rawCliFile, JSON.stringify(parsed.envelope, null, 2) + "\n");
  writeGenerated(paths.resultFile, JSON.stringify(parsed.output, null, 2) + "\n");
  writeGenerated(paths.metadataFile, JSON.stringify(metadata, null, 2) + "\n");
}

async function runOne({
  run,
  caseId,
  model,
  prompt,
  promptHash,
  schema,
  schemaFile,
  timeoutMs,
  maxBuffer,
  shell,
  jsonValidator,
  readBoundary
}) {
  if (completedOutputExists(run, caseId, model)) {
    log(`[skip] ${model}: normalized output already exists`);
    return { model, status: "skipped" };
  }

  const paths = artifactPaths(run, caseId, model);
  ensureDir(paths.outputDir);
  const attempt = nextAttempt(paths);
  const startedAt = new Date().toISOString();
  const metadataBase = {
    run,
    case_id: caseId,
    model,
    probe: CALIBRATION_PROBE,
    attempt: attempt.number,
    started_at: startedAt,
    timeout_ms: timeoutMs,
    prompt_hash: promptHash,
    schema_file: path.relative(ROOT, schemaFile),
    read_boundary: readBoundary ? {
      mode: readBoundary.mode,
      source_root: readBoundary.source_root,
      exposed_root: readBoundary.exposed_root,
      file_count: readBoundary.files.length
    } : null,
    status: "failed"
  };

  log(`[start] ${model} ${attempt.label}`);
  const wrapper = resolveWrapperCommand(shell, model, 10000, maxBuffer);
  const cliArgs = buildCliArgs(wrapper.args, schema, {
    persistSession: false,
    jsonValidator,
    run,
    model,
    probe: CALIBRATION_PROBE,
    schemaFile,
    validatorLogFile: jsonValidator ? attempt.validatorLogFile : null,
    attemptLabel: attempt.label,
    tools: readBoundary ? "Read" : "",
    permissionMode: readBoundary ? "dontAsk" : "default",
    addDir: readBoundary ? readBoundary.exposed_root : null
  });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fact-check-calibration-"));
  let child;
  try {
    child = await runCommand(wrapper.command, cliArgs, {
      cwd: workDir,
      input: prompt,
      timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer,
      validatorLogFile: jsonValidator ? attempt.validatorLogFile : null,
      env: {
        ...process.env,
        CLAUDE_CODE_SIMPLE: "1",
        MODEL_ROLE_CALIBRATION_MODEL: model,
        MODEL_ROLE_CALIBRATION_PROBE: CALIBRATION_PROBE,
        MODEL_ROLE_CALIBRATION_ATTEMPT: attempt.label
      }
    });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const metadata = {
    ...metadataBase,
    finished_at: new Date().toISOString(),
    exit_code: child.status,
    signal: child.signal,
    timed_out: child.error?.code === "ETIMEDOUT",
    command: wrapper.command,
    command_args: cliArgs,
    json_validator_enabled: jsonValidator,
    validator_log_file: jsonValidator ? path.relative(ROOT, attempt.validatorLogFile) : null,
    stderr: child.stderr || "",
    error: child.error ? child.error.message : null
  };

  if (child.error || child.status !== 0) {
    const recovered = extractValidatorCandidate(child.stdout);
    if (recovered) {
      metadata.recovered_from_validator = true;
      writeCompletedArtifacts(paths, attempt, metadata, recovered);
      const ingest = ingestOutput({
        run,
        caseId,
        model,
        file: paths.resultFile
      });
      const score = scoreOutput({ run, caseId, model });
      log(
        `[recovered] ${model}: status_accuracy=${score.metrics.status_accuracy} ` +
        `challenge_recall=${score.metrics.challenge_recall}`
      );
      return {
        model,
        status: "completed",
        recovered_from_validator: true,
        raw_file: ingest.raw_file,
        normalized_file: ingest.normalized_file,
        score_file: path.join(FACT_CHECK_ROOT, "runs", run, caseId, "scores", `${slug(model)}.score.json`)
      };
    }
    if (child.stdout) {
      writeFileNew(attempt.rawTextFile, child.stdout);
    }
    writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + "\n");
    log(`[fail] ${model}: command failed`);
    return { model, status: "failed", error: metadata.error || `exit ${child.status}` };
  }

  let parsed;
  try {
    parsed = parseAssistantOutput(child.stdout, CALIBRATION_PROBE);
  } catch (error) {
    metadata.error = error.message;
    writeFileNew(attempt.rawTextFile, child.stdout);
    writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + "\n");
    log(`[fail] ${model}: invalid JSON output`);
    return { model, status: "failed", error: error.message };
  }

  metadata.status = "completed";
  writeCompletedArtifacts(paths, attempt, metadata, parsed);

  const ingest = ingestOutput({
    run,
    caseId,
    model,
    file: paths.resultFile
  });
  const score = scoreOutput({ run, caseId, model });
  log(`[done] ${model}: status_accuracy=${score.metrics.status_accuracy} challenge_recall=${score.metrics.challenge_recall}`);
  return {
    model,
    status: "completed",
    raw_file: ingest.raw_file,
    normalized_file: ingest.normalized_file,
    score_file: path.join(FACT_CHECK_ROOT, "runs", run, caseId, "scores", `${slug(model)}.score.json`)
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = [];
  let next = 0;
  async function consume() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  const run = requireArg(args, "run");
  const caseId = requireArg(args, "case");
  const models = parseList(requireArg(args, "models"));
  const projectRoot = args["project-root"] && args["project-root"] !== true
    ? path.resolve(String(args["project-root"]))
    : null;
  assertFactCheckCaseId(caseId);
  if (!models.length) {
    throw new Error("At least one model is required");
  }

  const config = loadConfig();
  for (const model of models) {
    if (!config.models.includes(model)) {
      throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(", ")}`);
    }
  }

  const fixture = loadCase(caseId);
  let readBoundary = null;
  if (projectRoot) {
    if (!fs.existsSync(projectRoot) || !fs.lstatSync(projectRoot).isDirectory()) {
      throw new Error(`Invalid --project-root: ${projectRoot}`);
    }
    const readScope = buildFactCheckReadScope(projectRoot, fixture.reviewer_outputs, {
      maxFiles: args["read-scope-max-files"] && args["read-scope-max-files"] !== true
        ? positiveInteger(args["read-scope-max-files"], "--read-scope-max-files")
        : 80
    });
    readBoundary = copyScopedWorkspace(projectRoot, readScope, scopedPaths(run, caseId));
    writeGenerated(
      path.join(FACT_CHECK_ROOT, "runs", run, caseId, "read-scope.json"),
      JSON.stringify(readScope, null, 2) + "\n"
    );
    writeGenerated(
      path.join(FACT_CHECK_ROOT, "runs", run, caseId, "read-boundary.json"),
      JSON.stringify(readBoundary, null, 2) + "\n"
    );
  }
  const prompt = readBoundary
    ? renderScopedPrompt(fixture, projectRoot, readBoundary)
    : renderFactCheckPrompt(fixture);
  const promptHash = sha256(prompt);
  const promptDir = promptPaths(run, caseId);
  ensureDir(promptDir);
  writeGenerated(path.join(promptDir, "fact_check.md"), prompt);
  for (const model of models) {
    writeGenerated(path.join(promptDir, `${slug(model)}-fact_check.md`), prompt);
  }

  for (const model of models) {
    const modelPrompt = readText(path.join(promptDir, `${slug(model)}-fact_check.md`));
    const modelHash = sha256(modelPrompt);
    if (modelHash !== promptHash) {
      throw new Error(`Prompt hash mismatch for ${model}: ${modelHash} !== ${promptHash}`);
    }
  }

  const executionConfig = config.agent_execution;
  const timeoutMs = positiveInteger(
    args["timeout-ms"] && args["timeout-ms"] !== true ? args["timeout-ms"] : executionConfig.timeout_ms,
    "--timeout-ms"
  );
  const concurrency = positiveInteger(
    args.concurrency && args.concurrency !== true ? args.concurrency : DEFAULT_CONCURRENCY,
    "--concurrency"
  );
  const maxBuffer = positiveInteger(executionConfig.max_buffer_bytes, "agent_execution.max_buffer_bytes");
  const shell = process.env.MODEL_ROLE_CALIBRATION_SHELL || "/bin/zsh";
  const jsonValidator = args["without-json-validator"] ? false : true;
  const schemaFile = path.join(ROOT, "schemas", "fact-check-output.schema.json");
  const schema = parseJsonFile(schemaFile);

  log(`run=${run} case=${caseId} models=${models.join(",")} concurrency=${concurrency}`);
  log(`prompt_hash=${promptHash} prompt_file=${path.relative(ROOT, path.join(promptDir, "fact_check.md"))}`);
  if (readBoundary) {
    log(`read_boundary=mode:${readBoundary.mode} files:${readBoundary.files.length} exposed_root=${readBoundary.exposed_root}`);
  }
  const results = await runWithConcurrency(models, concurrency, (model) => runOne({
    run,
    caseId,
    model,
    prompt,
    promptHash,
    schema,
    schemaFile,
    timeoutMs,
    maxBuffer,
    shell,
    jsonValidator,
    readBoundary
  }));

  const completed = results.filter((item) => item.status === "completed" || item.status === "skipped").length;
  const failed = results.filter((item) => item.status === "failed").length;
  let summary = null;
  if (completed > 0) {
    summary = summarizeRun(run);
  }
  const batch = {
    run,
    case_id: caseId,
    prompt_hash: promptHash,
    project_root: projectRoot,
    read_boundary_file: readBoundary
      ? path.join(FACT_CHECK_ROOT, "runs", run, caseId, "read-boundary.json")
      : null,
    models,
    completed,
    failed,
    results,
    summary_file: summary ? path.join(FACT_CHECK_ROOT, "outputs", `${run}.summary.md`) : null
  };
  writeGenerated(path.join(FACT_CHECK_ROOT, "runs", run, caseId, "batch.json"), JSON.stringify(batch, null, 2) + "\n");
  console.log(JSON.stringify(batch, null, 2));
  if (failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
