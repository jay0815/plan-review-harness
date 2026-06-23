#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  ROOT,
  parseArgs,
  requireArg,
  assertSafeCaseId,
  assertProbe,
  ensureDir,
  readText,
  writeFileNew,
  writeGenerated,
  loadConfig,
  parseJsonFile,
  schemaForProbe,
  agentOutputPaths
} = require("./lib");

const ALIAS_MARKER = Buffer.from("\0MRC_ARGV\0");
const CALIBRATION_SYSTEM_PROMPT = [
  "You are a non-interactive calibration probe runner.",
  "Follow the user prompt exactly."
].join(" ");
const HEARTBEAT_MS = 30000;

function extractJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (start === -1) {
      if (char === "{") {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
}

function parseJsonEnvelope(stdout) {
  const text = String(stdout || "").trim();
  let parseError;
  try {
    return JSON.parse(text);
  } catch (error) {
    parseError = error;
    const candidates = extractJsonObjects(text);
    const parsedCandidates = [];
    for (const candidate of candidates) {
      try {
        parsedCandidates.push(JSON.parse(candidate));
      } catch (candidateError) {
        parseError = candidateError;
        // Continue collecting complete stream-json events.
      }
    }
    if (parsedCandidates.length === 1) {
      return parsedCandidates[0];
    }
    if (parsedCandidates.length > 1) {
      return parsedCandidates;
    }
  }
  const detail = parseError ? `: ${parseError.message}` : "";
  const match = parseError?.message ? /position (\d+)/.exec(parseError.message) : null;
  const position = match ? Number(match[1]) : null;
  const context = Number.isInteger(position)
    ? ` near ${JSON.stringify(text.slice(Math.max(0, position - 120), position + 120))}`
    : "";
  throw new Error(`Claude Code output does not contain a valid JSON object${detail}${context}`);
}

function parseOutputValue(value) {
  if (value && typeof value === "object") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const result = value.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return parseJsonEnvelope(result);
}

function findOutputCandidate(value, probe) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    let fallback = null;
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const candidate = findOutputCandidate(value[index], probe);
      if (!candidate) {
        continue;
      }
      if (candidate.matched) {
        return candidate;
      }
      fallback ||= candidate;
    }
    return fallback;
  }
  if (Object.prototype.hasOwnProperty.call(value, "probe")) {
    return {
      output: value,
      matched: value.probe === probe
    };
  }
  if (value.structured_output && typeof value.structured_output === "object") {
    return findOutputCandidate(value.structured_output, probe) || {
      output: value.structured_output,
      matched: false
    };
  }
  if (value.result !== undefined) {
    const parsedResult = parseOutputValue(value.result);
    const candidate = findOutputCandidate(parsedResult, probe);
    if (candidate) {
      return candidate;
    }
    if (parsedResult && typeof parsedResult === "object") {
      return {
        output: parsedResult,
        matched: false
      };
    }
  }
  const content = value.message?.content;
  if (Array.isArray(content)) {
    let fallback = null;
    for (let index = content.length - 1; index >= 0; index -= 1) {
      const block = content[index];
      if (block?.type !== "text" || typeof block.text !== "string") {
        continue;
      }
      try {
        const parsedText = parseOutputValue(block.text);
        const candidate = findOutputCandidate(parsedText, probe);
        if (candidate?.matched) {
          return candidate;
        }
        fallback ||= candidate;
      } catch {
        // Continue to earlier text blocks.
      }
    }
    return fallback;
  }
  return null;
}

function parseToolResultBlock(block) {
  if (!block || block.type !== "tool_result" || !block.tool_use_id) {
    return null;
  }
  const content = Array.isArray(block.content)
    ? block.content.map((item) => typeof item?.text === "string" ? item.text : "").join("\n")
    : String(block.content || "");
  if (!content.trim()) {
    return null;
  }
  try {
    return {
      toolUseId: block.tool_use_id,
      result: parseJsonEnvelope(content)
    };
  } catch {
    return null;
  }
}

function validatedToolUseIds(envelope) {
  const ids = new Set();
  for (const item of envelope) {
    const content = item?.message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      const parsed = parseToolResultBlock(block);
      if (parsed?.result?.valid === true) {
        ids.add(parsed.toolUseId);
      }
    }
  }
  return ids;
}

function findValidatedToolCandidate(envelope, probe) {
  const validIds = validatedToolUseIds(envelope);
  if (!validIds.size) {
    return null;
  }
  for (let itemIndex = envelope.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const content = envelope[itemIndex]?.message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (let blockIndex = content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = content[blockIndex];
      if (
        block?.type !== "tool_use" ||
        block.name !== "mcp__json_validator__validate_json_output" ||
        !validIds.has(block.id) ||
        typeof block.input?.candidate_text !== "string"
      ) {
        continue;
      }
      const parsed = parseOutputValue(block.input.candidate_text);
      const candidate = findOutputCandidate(parsed, probe);
      if (candidate?.matched) {
        return candidate.output;
      }
    }
  }
  return null;
}

function parseArrayEnvelope(envelope, probe) {
  let fallback = null;
  let parseError = null;
  for (let index = envelope.length - 1; index >= 0; index -= 1) {
    const item = envelope[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    if (item.type === "result" && item.is_error) {
      throw new Error(`Claude Code result is_error: ${item.result || item.error || "unknown"}`);
    }
    let candidate = null;
    try {
      candidate = findOutputCandidate(item, probe);
    } catch (error) {
      parseError ||= error;
      continue;
    }
    if (candidate?.matched) {
      return candidate.output;
    }
    fallback ||= candidate?.output || null;
  }
  const validatedCandidate = findValidatedToolCandidate(envelope, probe);
  if (validatedCandidate) {
    return validatedCandidate;
  }
  if (fallback) {
    return fallback;
  }
  if (parseError) {
    throw parseError;
  }
  return null;
}

function parseAssistantOutput(stdout, probe) {
  const envelope = parseJsonEnvelope(stdout);
  let output;

  if (Array.isArray(envelope)) {
    output = parseArrayEnvelope(envelope, probe);
  } else if (envelope?.type === "result" && envelope.is_error) {
    throw new Error(`Claude Code result is_error: ${envelope.result || envelope.error || "unknown"}`);
  } else if (envelope && typeof envelope === "object" && envelope.probe) {
    output = envelope;
  } else if (envelope && typeof envelope.structured_output === "object") {
    output = envelope.structured_output;
  } else if (envelope && typeof envelope.result === "object") {
    output = findOutputCandidate(envelope.result, probe)?.output || envelope.result;
  } else if (envelope && typeof envelope.result === "string") {
    const parsedResult = parseOutputValue(envelope.result);
    output = findOutputCandidate(parsedResult, probe)?.output || parsedResult;
  } else {
    throw new Error("Claude Code JSON output does not contain result or structured_output");
  }

  if (!output || typeof output !== "object") {
    throw new Error("Claude Code JSON output does not contain result or structured_output");
  }
  if (output.probe !== probe) {
    throw new Error(`Probe mismatch: output has "${output.probe}", expected "${probe}"`);
  }
  return { envelope, output };
}

function resolveWrapperCommand(shell, model, timeoutMs, maxBuffer) {
  const resolver = [
    "alias_value=${aliases[$MODEL]-}",
    "if [[ -z $alias_value ]]; then",
    "  print -u2 -- \"Missing Claude Code wrapper alias: $MODEL\"",
    "  exit 127",
    "fi",
    "eval \"set -- $alias_value\"",
    "printf '\\0MRC_ARGV\\0'",
    "printf '%s\\0' \"$@\""
  ].join("\n");
  const child = spawnSync(shell, ["-lic", resolver], {
    encoding: null,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer,
    env: {
      ...process.env,
      MODEL: model
    }
  });
  const stdout = child.stdout || Buffer.alloc(0);
  const markerIndex = stdout.lastIndexOf(ALIAS_MARKER);
  if (child.error || child.status !== 0 || markerIndex === -1) {
    const stderr = (child.stderr || Buffer.alloc(0)).toString("utf8").trim();
    const reason = child.error?.message || stderr || `exit ${child.status}`;
    throw new Error(`Unable to resolve wrapper alias "${model}": ${reason}`);
  }
  const commandParts = stdout.subarray(markerIndex + ALIAS_MARKER.length)
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (!commandParts.length) {
    throw new Error(`Wrapper alias "${model}" resolved to an empty command`);
  }
  return {
    command: commandParts[0],
    args: commandParts.slice(1)
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
    rawJsonFile: path.join(paths.attemptsDir, `${label}.cli.json`),
    rawTextFile: path.join(paths.attemptsDir, `${label}.cli.txt`),
    resultFile: path.join(paths.attemptsDir, `${label}.result.json`),
    metadataFile: path.join(paths.attemptsDir, `${label}.meta.json`),
    validatorLogFile: path.join(paths.attemptsDir, `${label}.validator.log`)
  };
}

function attemptFiles(paths, label) {
  if (!/^attempt-\d{3}$/.test(label)) {
    throw new Error(`Invalid attempt label "${label}". Expected attempt-001.`);
  }
  return {
    rawJsonFile: path.join(paths.attemptsDir, `${label}.cli.json`),
    rawTextFile: path.join(paths.attemptsDir, `${label}.cli.txt`),
    resultFile: path.join(paths.attemptsDir, `${label}.result.json`),
    metadataFile: path.join(paths.attemptsDir, `${label}.meta.json`),
    validatorLogFile: path.join(paths.attemptsDir, `${label}.validator.log`)
  };
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function buildCliArgs(wrapperArgs, schema, options) {
  const maxTurns = options.jsonValidator ? "4" : "1";
  const tools = options.tools === undefined ? "" : options.tools;
  const cliArgs = [
    ...wrapperArgs,
    "--bare",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--tools",
    tools,
    "--no-chrome",
    "--permission-mode",
    options.permissionMode || "default",
    "--system-prompt",
    CALIBRATION_SYSTEM_PROMPT,
    "--input-format",
    "text",
    "--output-format",
    "stream-json",
    "--json-schema",
    JSON.stringify(schema),
    "--max-turns",
    maxTurns
  ];

  if (options.jsonValidator) {
    cliArgs.push("--mcp-config", JSON.stringify({
      mcpServers: {
        json_validator: {
          type: "stdio",
          command: process.execPath,
          args: [path.join(ROOT, "scripts", "json-validator-mcp.js")],
          env: {
            MODEL_ROLE_CALIBRATION_SCHEMA_FILE: options.schemaFile,
            MODEL_ROLE_CALIBRATION_VALIDATOR_LOG: options.validatorLogFile,
            MODEL_ROLE_CALIBRATION_ATTEMPT: options.attemptLabel,
            MODEL_ROLE_CALIBRATION_MODEL: options.model,
            MODEL_ROLE_CALIBRATION_PROBE: options.probe
          },
          alwaysLoad: true,
          timeout: 10000
        }
      }
    }));
    cliArgs.push(
      "--allowed-tools",
      [tools, "mcp__json_validator__validate_json_output"].filter(Boolean).join(",")
    );
  } else if (tools) {
    cliArgs.push("--allowed-tools", tools);
  } else {
    cliArgs.push("--disallowed-tools", "mcp__*");
  }

  if (options.persistSession) {
    cliArgs.push("--name", `mrc-${options.run}-${options.model}-${options.probe}`);
  } else {
    cliArgs.push("--no-session-persistence");
  }

  if (options.addDir) {
    cliArgs.push("--add-dir", options.addDir);
  }

  cliArgs.push("-p");
  return cliArgs;
}

function logProgress(message) {
  console.error(`[run-model] ${new Date().toISOString()} ${message}`);
}

function durationLabel(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

function validatorLogSummary(file) {
  if (!file) {
    return "";
  }
  if (!fs.existsSync(file)) {
    return "validatorLog=missing calls=0 last=none";
  }
  try {
    const stats = fs.statSync(file);
    const text = fs.readFileSync(file, "utf8").trim();
    const lines = text ? text.split(/\n+/) : [];
    let calls = 0;
    let last = null;
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.event === "tool_call") {
          calls += 1;
        }
        last = event;
      } catch {
        last = { event: "unparseable_log_line" };
      }
    }
    let lastLabel = "none";
    if (last?.event === "tool_call") {
      lastLabel = last.valid
        ? "tool_call:valid"
        : `tool_call:${last.stage || "invalid"}:${last.error_count || 0}`;
    } else if (last?.event) {
      lastLabel = last.event;
    }
    return `validatorLog=${stats.size}B calls=${calls} last=${lastLabel}`;
  } catch (error) {
    return `validatorLog=error:${error.message}`;
  }
}

function summarizeArgs(args) {
  const redactedValueFlags = new Set(["--json-schema", "--system-prompt", "--mcp-config"]);
  const summary = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    summary.push(arg);
    if (redactedValueFlags.has(arg) && index + 1 < args.length) {
      summary.push("<redacted>");
      index += 1;
    }
  }
  return summary.join(" ");
}

function runCommand(command, args, options) {
  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let error = null;
    let killed = false;
    const startedAt = Date.now();

    logProgress(`starting process: ${command} ${summarizeArgs(args)}`);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const heartbeat = setInterval(() => {
      const validatorStatus = validatorLogSummary(options.validatorLogFile);
      logProgress(
        `still running after ${durationLabel(Date.now() - startedAt)} ` +
        `(pid=${child.pid || "unknown"}, stdout=${stdoutBytes}B, stderr=${stderrBytes}B` +
        `${validatorStatus ? `, ${validatorStatus}` : ""})`
      );
    }, HEARTBEAT_MS);

    const timeout = setTimeout(() => {
      killed = true;
      error = new Error(`timed out after ${options.timeoutMs}ms`);
      error.code = "ETIMEDOUT";
      logProgress(`timeout reached after ${durationLabel(Date.now() - startedAt)}; sending ${options.killSignal}`);
      child.kill(options.killSignal);
    }, options.timeoutMs);

    function appendChunk(target, chunk) {
      if (target === "stdout") {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      } else {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }

      if (!killed && stdoutBytes + stderrBytes > options.maxBuffer) {
        killed = true;
        error = new Error(`combined stdout/stderr exceeded maxBuffer ${options.maxBuffer}`);
        error.code = "ENOBUFS";
        logProgress(`maxBuffer exceeded; sending ${options.killSignal}`);
        child.kill(options.killSignal);
      }
    }

    child.stdout.on("data", (chunk) => appendChunk("stdout", chunk));
    child.stderr.on("data", (chunk) => appendChunk("stderr", chunk));
    child.on("error", (spawnError) => {
      if (!error) {
        error = spawnError;
      }
    });
    child.on("close", (code, signal) => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      const validatorStatus = validatorLogSummary(options.validatorLogFile);
      logProgress(
        `process finished after ${durationLabel(Date.now() - startedAt)} ` +
        `(exit=${code}, signal=${signal || "none"}, stdout=${stdoutBytes}B, stderr=${stderrBytes}B` +
        `${validatorStatus ? `, ${validatorStatus}` : ""})`
      );
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        status: code,
        signal,
        error
      });
    });

    child.stdin.on("error", (stdinError) => {
      if (stdinError.code !== "EPIPE" && !error) {
        error = stdinError;
      }
    });
    child.stdin.end(options.input);
  });
}

function writeCompletedArtifacts(paths, attempt, metadata, envelope, output) {
  metadata.status = "completed";
  metadata.error = null;
  writeFileNew(attempt.rawJsonFile, JSON.stringify(envelope, null, 2) + "\n");
  writeFileNew(attempt.resultFile, JSON.stringify(output, null, 2) + "\n");
  writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + "\n");
  writeGenerated(paths.rawFile, JSON.stringify(envelope, null, 2) + "\n");
  writeGenerated(paths.metadataFile, JSON.stringify(metadata, null, 2) + "\n");
  writeGenerated(paths.resultFile, JSON.stringify(output, null, 2) + "\n");
}

function reparseAttempt(paths, sourceLabel, newAttempt, metadataBase, probe) {
  const source = attemptFiles(paths, sourceLabel);
  const sourceRawFile = fs.existsSync(source.rawTextFile) ? source.rawTextFile : source.rawJsonFile;
  if (!fs.existsSync(sourceRawFile)) {
    throw new Error(`Missing raw CLI output for ${sourceLabel}: ${source.rawTextFile} or ${source.rawJsonFile}`);
  }
  const stdout = readText(sourceRawFile);
  const parsed = parseAssistantOutput(stdout, probe);
  let sourceMetadata = {};
  if (fs.existsSync(source.metadataFile)) {
    sourceMetadata = parseJsonFile(source.metadataFile);
  }
  const metadata = {
    ...metadataBase,
    started_at: sourceMetadata.started_at || metadataBase.started_at,
    finished_at: new Date().toISOString(),
    timeout_ms: sourceMetadata.timeout_ms || metadataBase.timeout_ms,
    timed_out: false,
    exit_code: sourceMetadata.exit_code ?? 0,
    signal: sourceMetadata.signal ?? null,
    command: sourceMetadata.command || null,
    command_args: sourceMetadata.command_args || [],
    persist_session: Boolean(sourceMetadata.persist_session),
    session_name: sourceMetadata.session_name || null,
    stderr: sourceMetadata.stderr || "",
    reparsed_from_attempt: sourceLabel
  };
  writeCompletedArtifacts(paths, newAttempt, metadata, parsed.envelope, parsed.output);
  return {
    sourceRawFile,
    output: parsed.output
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const run = requireArg(args, "run");
  const caseId = requireArg(args, "case");
  const model = requireArg(args, "model").toLowerCase();
  const probe = requireArg(args, "probe");
  const force = args.force === true;
  assertSafeCaseId(caseId);
  assertProbe(probe);

  const config = loadConfig();
  if (!config.models.includes(model)) {
    throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(", ")}`);
  }

  const promptFile = path.join(ROOT, "runs", run, caseId, "prompts", `${probe}.md`);
  if (!fs.existsSync(promptFile)) {
    throw new Error(`Missing generated prompt: ${promptFile}`);
  }

  const paths = agentOutputPaths(run, caseId, model, probe);
  if (fs.existsSync(paths.resultFile) && !force) {
    console.log(`Model output already complete, skipping: ${paths.resultFile}`);
    return;
  }
  if (force && fs.existsSync(paths.resultFile)) {
    logProgress(`force enabled; refreshing completed output: ${paths.resultFile}`);
  }
  ensureDir(paths.outputDir);

  const schemaFile = schemaForProbe(probe);
  const schema = parseJsonFile(schemaFile);
  const executionConfig = config.agent_execution;
  const timeoutMs = positiveInteger(
    args["timeout-ms"] && args["timeout-ms"] !== true
      ? args["timeout-ms"]
      : executionConfig.timeout_ms,
    "--timeout-ms"
  );
  const aliasTimeoutMs = positiveInteger(
    executionConfig.alias_resolution_timeout_ms,
    "agent_execution.alias_resolution_timeout_ms"
  );
  const maxBuffer = positiveInteger(
    executionConfig.max_buffer_bytes,
    "agent_execution.max_buffer_bytes"
  );
  const reparseAttemptLabel = args["reparse-attempt"] && args["reparse-attempt"] !== true
    ? String(args["reparse-attempt"])
    : null;
  if (reparseAttemptLabel) {
    const attempt = nextAttempt(paths);
    const metadataBase = {
      run,
      case_id: caseId,
      model,
      probe,
      attempt: attempt.number,
      started_at: new Date().toISOString(),
      timeout_ms: timeoutMs,
      prompt_file: path.relative(ROOT, promptFile),
      schema_file: path.relative(ROOT, schemaFile)
    };
    logProgress(`run=${run} case=${caseId} model=${model} probe=${probe} attempt=${attempt.label}`);
    logProgress(`reparsing existing attempt=${reparseAttemptLabel}`);
    const reparsed = reparseAttempt(paths, reparseAttemptLabel, attempt, metadataBase, probe);
    logProgress(`source raw CLI output=${reparsed.sourceRawFile}`);
    console.log(`Attempt reparsed: ${attempt.label}`);
    console.log(`Ingestable output saved: ${paths.resultFile}`);
    console.log(`Metadata saved: ${paths.metadataFile}`);
    return;
  }

  const attempt = nextAttempt(paths);
  const shell = process.env.MODEL_ROLE_CALIBRATION_SHELL || "/bin/zsh";
  const persistSession = Boolean(args["persist-session"]);
  const jsonValidator = Boolean(args["with-json-validator"]);
  const validatorLogFile = jsonValidator ? attempt.validatorLogFile : null;
  const sessionName = persistSession ? `mrc-${run}-${model}-${probe}` : null;
  logProgress(`run=${run} case=${caseId} model=${model} probe=${probe} attempt=${attempt.label}`);
  logProgress(`prompt=${path.relative(ROOT, promptFile)} schema=${path.relative(ROOT, schemaFile)}`);
  logProgress(`timeout=${timeoutMs}ms maxBuffer=${maxBuffer} persistSession=${persistSession} jsonValidator=${jsonValidator}`);
  if (validatorLogFile) {
    logProgress(`validator log=${validatorLogFile}`);
  }
  if (sessionName) {
    logProgress(`session name=${sessionName}`);
  }
  logProgress(`resolving alias with shell=${shell}`);
  const wrapper = resolveWrapperCommand(shell, model, aliasTimeoutMs, maxBuffer);
  logProgress(`alias resolved: command=${wrapper.command} args=${summarizeArgs(wrapper.args) || "(none)"}`);
  const cliArgs = buildCliArgs(wrapper.args, schema, {
    persistSession,
    jsonValidator,
    run,
    model,
    probe,
    schemaFile,
    validatorLogFile,
    attemptLabel: attempt.label
  });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "model-role-calibration-"));
  const startedAt = new Date().toISOString();
  let child;
  try {
    logProgress(`temporary cwd=${workDir}`);
    child = await runCommand(wrapper.command, cliArgs, {
      cwd: workDir,
      input: readText(promptFile),
      timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer,
      validatorLogFile,
      env: {
        ...process.env,
        CLAUDE_CODE_SIMPLE: "1",
        MODEL_ROLE_CALIBRATION_MODEL: model,
        MODEL_ROLE_CALIBRATION_PROBE: probe,
        MODEL_ROLE_CALIBRATION_ATTEMPT: attempt.label
      }
    });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    logProgress(`removed temporary cwd=${workDir}`);
  }

  const timedOut = child.error?.code === "ETIMEDOUT";
  const metadata = {
    run,
    case_id: caseId,
    model,
    probe,
    attempt: attempt.number,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timeout_ms: timeoutMs,
    timed_out: timedOut,
    exit_code: child.status,
    signal: child.signal,
    prompt_file: path.relative(ROOT, promptFile),
    schema_file: path.relative(ROOT, schemaFile),
    command: wrapper.command,
    command_args: cliArgs,
    persist_session: persistSession,
    session_name: sessionName,
    json_validator_enabled: jsonValidator,
    validator_log_file: validatorLogFile ? path.relative(ROOT, validatorLogFile) : null,
    stderr: child.stderr || "",
    error: child.error ? child.error.message : null,
    status: "failed"
  };

  if (child.error || child.status !== 0) {
    if (child.stdout) {
      writeFileNew(attempt.rawTextFile, child.stdout);
      logProgress(`raw CLI output saved: ${attempt.rawTextFile}`);
    }
    writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + "\n");
    logProgress(`metadata saved: ${attempt.metadataFile}`);
    const reason = timedOut ? `timed out after ${timeoutMs}ms` : `exited with status ${child.status}`;
    throw new Error(`Model command ${reason} for ${model}/${probe}; retry will create a new attempt`);
  }

  let parsed;
  try {
    parsed = parseAssistantOutput(child.stdout, probe);
  } catch (error) {
    metadata.error = error.message;
    writeFileNew(attempt.rawTextFile, child.stdout);
    writeFileNew(attempt.metadataFile, JSON.stringify(metadata, null, 2) + "\n");
    logProgress(`raw CLI output saved: ${attempt.rawTextFile}`);
    logProgress(`metadata saved: ${attempt.metadataFile}`);
    throw new Error(`Invalid model output for ${model}/${probe}: ${error.message}; retry will create a new attempt`);
  }

  const { envelope, output } = parsed;
  writeCompletedArtifacts(paths, attempt, metadata, envelope, output);

  console.log(`Attempt completed: ${attempt.label}`);
  console.log(`CLI output saved: ${paths.rawFile}`);
  console.log(`Ingestable output saved: ${paths.resultFile}`);
  console.log(`Metadata saved: ${paths.metadataFile}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  extractJsonObjects,
  parseJsonEnvelope,
  parseAssistantOutput,
  resolveWrapperCommand,
  buildCliArgs,
  runCommand
};
