#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { ROOT, agentOutputPaths, parseJsonFile } = require("./lib");

function runNode(script, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: path.resolve(ROOT, ".."),
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      ...env
    }
  });
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function generatePrompts(run, probes) {
  const result = runNode(path.join(ROOT, "scripts", "generate-prompts.js"), [
    "--run", run,
    "--case", "synthetic/event-reporting",
    "--probes", probes.join(",")
  ]);
  requireSuccess(result, `generate prompts for ${run}`);
}

function maxConcurrency(logFile) {
  return maxConcurrencyFor(logFile, () => true);
}

function maxConcurrencyFor(logFile, predicate) {
  const events = fs.readFileSync(logFile, "utf8").trim().split("\n")
    .filter(Boolean)
    .map(JSON.parse)
    .sort((a, b) => a.time - b.time || (a.event === "start" ? -1 : 1));
  let active = 0;
  let maximum = 0;
  for (const event of events) {
    if (!predicate(event.id)) {
      continue;
    }
    active += event.event === "start" ? 1 : -1;
    maximum = Math.max(maximum, active);
    assert(active >= 0);
  }
  assert.equal(active, 0);
  return maximum;
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "calibration-runtime-test-"));
  const fakeShell = path.join(tempDir, "fake-shell");
  const fakeModel = path.join(tempDir, "fake-model.js");
  const noOutputRunner = path.join(tempDir, "no-output-runner.js");
  const runModel = path.join(ROOT, "scripts", "run-model.js");
  const runPool = path.join(ROOT, "scripts", "run-agent-pool.js");
  const runCalibration = path.join(ROOT, "scripts", "run-calibration.js");
  const runIds = [
    `runtime-retry-${process.pid}-${Date.now()}`,
    `runtime-pool-${process.pid}-${Date.now()}`,
    `runtime-partial-retry-${process.pid}-${Date.now()}`,
    `runtime-workflow-${process.pid}-${Date.now()}`,
    `runtime-pool-failure-${process.pid}-${Date.now()}`,
    `runtime-workflow-failure-${process.pid}-${Date.now()}`,
    `runtime-workflow-missing-output-${process.pid}-${Date.now()}`,
    `runtime-synthesis-stage-${process.pid}-${Date.now()}`
  ];

  fs.writeFileSync(fakeShell, `#!/bin/sh
printf 'startup-noise-from-zsh\\n'
printf '\\0MRC_ARGV\\0'
printf '%s\\0' "$FAKE_MODEL_BIN"
`);
  fs.writeFileSync(fakeModel, `#!/usr/bin/env node
const fs = require("fs");
const mode = process.env.FAKE_MODEL_MODE || "success";
const log = process.env.FAKE_POOL_LOG;
const id = process.env.MODEL_ROLE_CALIBRATION_MODEL + "/" + process.env.MODEL_ROLE_CALIBRATION_PROBE;
const failIds = new Set((process.env.FAKE_MODEL_FAIL_IDS || "").split(",").filter(Boolean));
if (log) fs.appendFileSync(log, JSON.stringify({ event: "start", id, time: Date.now() }) + "\\n");
const finish = () => {
  if (log) fs.appendFileSync(log, JSON.stringify({ event: "end", id, time: Date.now() }) + "\\n");
  if (mode === "fail" || failIds.has(id)) process.exit(7);
  const probe = process.env.MODEL_ROLE_CALIBRATION_PROBE;
  process.stdout.write("\\u001b]1337;model-noise\\u0007\\n");
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init" }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "working" }] }
  }) + "\\n");
  if (mode === "invalid-json") {
    process.stdout.write(JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "{\\"probe\\":\\"planner\\",\\"summary\\":\\"broken\\"quote\\"}"
    }) + "\\n");
    return;
  }
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ok",
    structured_output: { probe }
  }) + "\\n");
};
if (mode === "hang") setTimeout(finish, 60000);
else setTimeout(finish, Number(process.env.FAKE_MODEL_DELAY_MS || 0));
`);
  fs.writeFileSync(noOutputRunner, "#!/usr/bin/env node\nprocess.exit(0);\n");
  fs.chmodSync(fakeShell, 0o755);
  fs.chmodSync(fakeModel, 0o755);

  const baseEnv = {
    MODEL_ROLE_CALIBRATION_SHELL: fakeShell,
    MODEL_ROLE_CALIBRATION_POOL_LOCK: path.join(tempDir, "agent-pool.lock"),
    FAKE_MODEL_BIN: fakeModel
  };

  try {
    const retryRun = runIds[0];
    generatePrompts(retryRun, ["planner"]);
    let result = runNode(runModel, [
      "--run", retryRun,
      "--case", "synthetic/event-reporting",
      "--model", "kimi",
      "--probe", "planner"
    ], {
      ...baseEnv,
      FAKE_MODEL_MODE: "fail"
    });
    assert.notEqual(result.status, 0);

    result = runNode(runModel, [
      "--run", retryRun,
      "--case", "synthetic/event-reporting",
      "--model", "kimi",
      "--probe", "planner"
    ], baseEnv);
    requireSuccess(result, "retry after transient failure");

    const retryPaths = agentOutputPaths(
      retryRun,
      "synthetic/event-reporting",
      "kimi",
      "planner"
    );
    assert(fs.existsSync(retryPaths.resultFile));
    assert.equal(parseJsonFile(path.join(retryPaths.attemptsDir, "attempt-001.meta.json")).status, "failed");
    assert.equal(parseJsonFile(path.join(retryPaths.attemptsDir, "attempt-002.meta.json")).status, "completed");

    result = runNode(runModel, [
      "--run", retryRun,
      "--case", "synthetic/event-reporting",
      "--model", "deepseek",
      "--probe", "planner",
      "--timeout-ms", "100"
    ], {
      ...baseEnv,
      FAKE_MODEL_MODE: "hang"
    });
    assert.notEqual(result.status, 0);
    const timeoutPaths = agentOutputPaths(
      retryRun,
      "synthetic/event-reporting",
      "deepseek",
      "planner"
    );
    assert.equal(parseJsonFile(path.join(timeoutPaths.attemptsDir, "attempt-001.meta.json")).timed_out, true);

    result = runNode(runModel, [
      "--run", retryRun,
      "--case", "synthetic/event-reporting",
      "--model", "deepseek",
      "--probe", "planner"
    ], baseEnv);
    requireSuccess(result, "retry after timeout");
    assert(fs.existsSync(timeoutPaths.resultFile));

    const poolRun = runIds[1];
    generatePrompts(poolRun, ["planner", "risk"]);
    const poolLog = path.join(tempDir, "pool.log");
    result = runNode(runPool, [
      "--run", poolRun,
      "--cases", "synthetic/event-reporting",
      "--models", "kimi,deepseek,glm,qwen",
      "--probes", "planner"
    ], {
      ...baseEnv,
      FAKE_POOL_LOG: poolLog,
      FAKE_MODEL_DELAY_MS: "100"
    });
    requireSuccess(result, "first pool batch");
    assert.equal(maxConcurrency(poolLog), 3);

    result = runNode(runPool, [
      "--run", poolRun,
      "--cases", "synthetic/event-reporting",
      "--models", "kimi,deepseek,glm,qwen",
      "--probes", "risk"
    ], baseEnv);
    requireSuccess(result, "second pool batch");

    result = runNode(runPool, [
      "--run", poolRun,
      "--cases", "synthetic/event-reporting",
      "--models", "kimi,deepseek,glm,qwen",
      "--probes", "planner"
    ], baseEnv);
    requireSuccess(result, "idempotent pool rerun");

    const poolIndex = parseJsonFile(path.join(ROOT, "runs", poolRun, "agent-pool.json"));
    assert.equal(poolIndex.version, 2);
    assert.equal(poolIndex.max_concurrency, 3);
    assert.equal(poolIndex.batches.length, 3);
    assert.equal(poolIndex.requested_jobs.length, 8);
    assert.equal(poolIndex.unresolved_jobs.length, 0);
    assert.equal(poolIndex.ready_for_evaluation, true);
    const lastBatch = parseJsonFile(path.join(
      path.resolve(ROOT),
      poolIndex.batches[2].file
    ));
    assert.equal(lastBatch.max_concurrency, 3);
    assert.equal(lastBatch.scheduled, 0);
    assert.equal(lastBatch.skipped.length, 4);

    const partialRetryRun = runIds[2];
    generatePrompts(partialRetryRun, ["planner"]);
    result = runNode(runPool, [
      "--run", partialRetryRun,
      "--cases", "synthetic/event-reporting",
      "--models", "kimi,deepseek,glm,qwen",
      "--probes", "planner"
    ], {
      ...baseEnv,
      FAKE_MODEL_FAIL_IDS: "glm/planner,qwen/planner"
    });
    assert.notEqual(result.status, 0);

    const partialRetryLog = path.join(tempDir, "partial-retry.log");
    result = runNode(runPool, [
      "--run", partialRetryRun,
      "--cases", "synthetic/event-reporting",
      "--models", "kimi,deepseek,glm,qwen",
      "--probes", "planner"
    ], {
      ...baseEnv,
      FAKE_POOL_LOG: partialRetryLog,
      FAKE_MODEL_DELAY_MS: "100"
    });
    requireSuccess(result, "partial pool retry");
    assert.equal(maxConcurrency(partialRetryLog), 2);

    const partialRetryIndex = parseJsonFile(path.join(
      ROOT,
      "runs",
      partialRetryRun,
      "agent-pool.json"
    ));
    assert.equal(partialRetryIndex.max_concurrency, 3);
    assert.equal(partialRetryIndex.ready_for_evaluation, true);
    assert.equal(partialRetryIndex.unresolved_jobs.length, 0);
    const partialRetryBatch = parseJsonFile(path.join(
      path.resolve(ROOT),
      partialRetryIndex.batches[1].file
    ));
    assert.equal(partialRetryBatch.max_concurrency, 3);
    assert.equal(partialRetryBatch.scheduled, 2);
    assert.equal(partialRetryBatch.completed.length, 2);
    assert.equal(partialRetryBatch.skipped.length, 2);

    const workflowRun = runIds[3];
    const workflowLog = path.join(tempDir, "workflow.log");
    result = runNode(runCalibration, [
      "--run", workflowRun,
      "--case", "synthetic/event-reporting",
      "--models", "kimi,deepseek",
      "--probes", "planner,risk"
    ], {
      ...baseEnv,
      FAKE_POOL_LOG: workflowLog,
      FAKE_MODEL_DELAY_MS: "100"
    });
    requireSuccess(result, "full workflow");
    assert.equal(maxConcurrency(workflowLog), 3);
    assert(fs.existsSync(path.join(
      ROOT,
      "runs",
      workflowRun,
      "synthetic/event-reporting/prompts/planner.md"
    )));
    assert(fs.existsSync(path.join(
      ROOT,
      "runs",
      workflowRun,
      "synthetic/event-reporting/prompts/risk.md"
    )));
    let workflowBatch = parseJsonFile(path.join(ROOT, "runs", workflowRun, "batch.json"));
    assert.equal(workflowBatch.type, "role");
    assert.equal(workflowBatch.requested, 4);
    assert.equal(workflowBatch.completed, 4);
    assert.equal(workflowBatch.failed, 0);
    assert.equal(workflowBatch.skipped, 0);

    result = runNode(runCalibration, [
      "--run", workflowRun,
      "--case", "synthetic/event-reporting",
      "--models", "kimi,deepseek",
      "--probes", "planner,risk"
    ], baseEnv);
    requireSuccess(result, "resumable full workflow");
    assert(result.stdout.includes("Prompts: 0 generated, 2 reused"));
    workflowBatch = parseJsonFile(path.join(ROOT, "runs", workflowRun, "batch.json"));
    assert.equal(workflowBatch.requested, 4);
    assert.equal(workflowBatch.completed, 4);
    assert.equal(workflowBatch.failed, 0);
    assert.equal(workflowBatch.skipped, 4);
    assert(workflowBatch.results.every((item) => item.status === "skipped"));

    const forceLog = path.join(tempDir, "force-workflow.log");
    result = runNode(runCalibration, [
      "--run", workflowRun,
      "--case", "synthetic/event-reporting",
      "--models", "kimi,deepseek",
      "--probes", "planner",
      "--concurrency", "2",
      "--force"
    ], {
      ...baseEnv,
      FAKE_POOL_LOG: forceLog,
      FAKE_MODEL_DELAY_MS: "100"
    });
    requireSuccess(result, "forced workflow refresh");
    workflowBatch = parseJsonFile(path.join(ROOT, "runs", workflowRun, "batch.json"));
    assert.equal(workflowBatch.force, true);
    assert.equal(workflowBatch.requested, 2);
    assert.equal(workflowBatch.completed, 2);
    assert.equal(workflowBatch.skipped, 0);
    assert.equal(maxConcurrency(forceLog), 2);
    for (const model of ["kimi", "deepseek"]) {
      const paths = agentOutputPaths(
        workflowRun,
        "synthetic/event-reporting",
        model,
        "planner"
      );
      assert.equal(
        parseJsonFile(path.join(paths.attemptsDir, "attempt-002.meta.json")).status,
        "completed"
      );
    }

    const synthesisStageRun = runIds[7];
    const synthesisStageLog = path.join(tempDir, "synthesis-stage.log");
    result = runNode(runCalibration, [
      "--run", synthesisStageRun,
      "--case", "synthetic/event-reporting",
      "--models", "kimi,deepseek,glm,qwen",
      "--probes", "risk,synthesis",
      "--concurrency", "4",
      "--force"
    ], {
      ...baseEnv,
      FAKE_POOL_LOG: synthesisStageLog,
      FAKE_MODEL_DELAY_MS: "100"
    });
    requireSuccess(result, "synthesis stage concurrency override");
    const synthesisStageBatch = parseJsonFile(path.join(ROOT, "runs", synthesisStageRun, "batch.json"));
    assert.deepEqual(synthesisStageBatch.job_stages, [
      { label: "default", concurrency: 4, jobs: 4 },
      { label: "synthesis", concurrency: 1, jobs: 4 }
    ]);
    assert.equal(maxConcurrencyFor(synthesisStageLog, (id) => id.endsWith("/risk")), 4);
    assert.equal(maxConcurrencyFor(synthesisStageLog, (id) => id.endsWith("/synthesis")), 1);

    const failureRun = runIds[4];
    generatePrompts(failureRun, ["planner"]);
    result = runNode(runPool, [
      "--run", failureRun,
      "--cases", "synthetic/event-reporting",
      "--models", "deepseek",
      "--probes", "planner"
    ], {
      ...baseEnv,
      FAKE_MODEL_MODE: "invalid-json"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\[fail 1\/1\] deepseek\/synthetic\/event-reporting\/planner/);
    assert.match(result.stderr, /Invalid model output: JSON parse error at position \d+/);
    assert.match(
      result.stderr,
      /attempt: runs\/runtime-pool-failure-[^/]+\/synthetic\/event-reporting\/agent-outputs\/attempts\/deepseek-planner\/attempt-001\.meta\.json/
    );
    const failurePaths = agentOutputPaths(
      failureRun,
      "synthetic/event-reporting",
      "deepseek",
      "planner"
    );
    const failureMetadata = parseJsonFile(path.join(
      failurePaths.attemptsDir,
      "attempt-001.meta.json"
    ));
    assert.equal(failureMetadata.json_validator_enabled, true);
    assert.equal(
      failureMetadata.command_args[failureMetadata.command_args.indexOf("--max-turns") + 1],
      "4"
    );

    const workflowFailureRun = runIds[5];
    result = runNode(runCalibration, [
      "--run", workflowFailureRun,
      "--case", "synthetic/event-reporting",
      "--models", "deepseek",
      "--probes", "planner"
    ], {
      ...baseEnv,
      FAKE_MODEL_MODE: "invalid-json"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\[fail\] deepseek\/synthetic\/event-reporting\/planner/);
    assert.match(result.stderr, /Invalid model output: JSON parse error at position \d+/);
    const workflowFailureBatch = parseJsonFile(path.join(
      ROOT,
      "runs",
      workflowFailureRun,
      "batch.json"
    ));
    assert.equal(workflowFailureBatch.requested, 1);
    assert.equal(workflowFailureBatch.completed, 0);
    assert.equal(workflowFailureBatch.failed, 1);
    assert.equal(workflowFailureBatch.results[0].status, "failed");

    const missingOutputRun = runIds[6];
    result = runNode(runCalibration, [
      "--run", missingOutputRun,
      "--case", "synthetic/event-reporting",
      "--models", "deepseek",
      "--probes", "planner"
    ], {
      ...baseEnv,
      MODEL_ROLE_CALIBRATION_RUNNER: noOutputRunner
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Model runner exited successfully without output/);
    const missingOutputBatch = parseJsonFile(path.join(
      ROOT,
      "runs",
      missingOutputRun,
      "batch.json"
    ));
    assert.equal(missingOutputBatch.failed, 1);
    assert.equal(missingOutputBatch.results[0].status, "failed");

    console.log("Calibration integration tests passed");
  } finally {
    for (const run of runIds) {
      fs.rmSync(path.join(ROOT, "runs", run), { recursive: true, force: true });
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
