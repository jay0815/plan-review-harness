#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ROOT, loadConfig, schemaForProbe } = require("./lib");
const { parseAssistantOutput, parseJsonEnvelope, buildCliArgs } = require("./run-model");
const { MAX_CONCURRENCY, mergeRequestedJobs } = require("./run-agent-pool");
const {
  DEFAULT_CASE,
  parseList,
  compactUtcTimestamp,
  uniqueRunId
} = require("./run-calibration");
const { roleRecommendation } = require("./summarize-results");
const { validateJsonText } = require("./json-validator-mcp");

function modelStats(model, plannerCases) {
  return {
    model,
    byProbeCase: {
      planner: plannerCases
    },
    failure_modes: []
  };
}

function main() {
  const config = loadConfig();
  const [caseA, caseB, caseC] = config.primary_cases;

  assert.equal(MAX_CONCURRENCY, 3);
  assert.equal(schemaForProbe("risk"), path.join(ROOT, "schemas", "risk-output.schema.json"));
  const riskSchema = JSON.parse(fs.readFileSync(schemaForProbe("risk"), "utf8"));
  const validRiskOutput = {
    probe: "risk",
    issues: [{
      title: "阻塞风险",
      type: "risk",
      severity: "blocker",
      evidence: "await reportEvent",
      why_it_matters: "支付成功页等待遥测请求",
      confidence: 0.9
    }],
    missing_questions: [],
    false_positive_risks: []
  };
  assert.equal(validateJsonText(JSON.stringify(validRiskOutput), riskSchema).valid, true);
  assert.equal(validateJsonText(JSON.stringify({
    ...validRiskOutput,
    issues: [{
      ...validRiskOutput.issues[0],
      suggested_fix: "改为异步"
    }]
  }), riskSchema).stage, "schema");
  assert.equal(DEFAULT_CASE, "synthetic/event-reporting");
  assert.deepEqual(parseList("kimi,kimi,qwen", config.models), ["kimi", "qwen"]);
  assert.deepEqual(parseList(undefined, ["kimi", "qwen"]), ["kimi", "qwen"]);
  assert.equal(
    compactUtcTimestamp(new Date("2026-06-11T09:45:09.123Z")),
    "20260611T094509Z"
  );
  assert.equal(
    uniqueRunId("synthetic/new-case", new Date("2026-06-11T09:45:09.123Z")),
    "synthetic-new-case-20260611T094509Z"
  );

  const singleCase = roleRecommendation("planner", [
    modelStats("kimi", { [caseA]: 25 })
  ], config);
  assert.equal(singleCase.status, "insufficient_data");
  assert.equal(singleCase.recommended, null);
  assert.equal(singleCase.comparable_models, 0);

  const oneCompleteModel = roleRecommendation("planner", [
    modelStats("kimi", { [caseA]: 25, [caseB]: 25, [caseC]: 25 }),
    modelStats("deepseek", { [caseA]: 20, [caseB]: 20 })
  ], config);
  assert.equal(oneCompleteModel.status, "insufficient_data");
  assert.equal(oneCompleteModel.comparable_models, 1);

  const comparableModels = roleRecommendation("planner", [
    modelStats("kimi", { [caseA]: 24, [caseB]: 23, [caseC]: 24 }),
    modelStats("deepseek", { [caseA]: 20, [caseB]: 20, [caseC]: 20 })
  ], config);
  assert.equal(comparableModels.status, "candidate");
  assert.equal(comparableModels.recommended, "kimi");
  assert.equal(comparableModels.comparable_models, 2);

  const parsed = parseAssistantOutput(JSON.stringify({
    result: "ok",
    structured_output: {
      probe: "planner"
    }
  }), "planner");
  assert.equal(parsed.output.probe, "planner");

  const noisy = parseJsonEnvelope(`\u001b]1337;startup\u0007\nwarning\n${JSON.stringify({
    structured_output: {
      probe: "planner"
    }
  })}\n`);
  assert.equal(noisy.structured_output.probe, "planner");

  const arrayEnvelope = parseAssistantOutput(JSON.stringify([
    { type: "system", subtype: "init" },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: JSON.stringify({ probe: "planner" })
    }
  ]), "planner");
  assert.equal(arrayEnvelope.output.probe, "planner");

  const streamEnvelope = parseAssistantOutput([
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "working" }]
      }
    }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      structured_output: { probe: "planner" }
    })
  ].join("\n"), "planner");
  assert.equal(streamEnvelope.output.probe, "planner");
  assert.equal(streamEnvelope.envelope.length, 3);

  const largeStream = [
    ...Array.from({ length: 140 }, (_, index) => JSON.stringify({
      type: "assistant",
      sequence: index,
      message: {
        content: [{ type: "text", text: "x".repeat(1000) }]
      }
    })),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      structured_output: { probe: "planner" }
    })
  ].join("\n");
  assert(Buffer.byteLength(largeStream) > 128 * 1024);
  const largeStreamEnvelope = parseAssistantOutput(largeStream, "planner");
  assert.equal(largeStreamEnvelope.output.probe, "planner");
  assert.equal(largeStreamEnvelope.envelope.length, 141);

  const defaultCliArgs = buildCliArgs(["--settings", "deepseek.json"], { type: "object" }, {
    persistSession: false,
    run: "run-001",
    model: "deepseek",
    probe: "planner"
  });
  assert(defaultCliArgs.includes("--bare"));
  assert(defaultCliArgs.includes("--no-session-persistence"));
  assert(defaultCliArgs.includes("--strict-mcp-config"));
  assert(defaultCliArgs.includes("--disable-slash-commands"));
  assert(defaultCliArgs.includes("--tools"));
  assert(defaultCliArgs.includes("--disallowed-tools"));
  assert(defaultCliArgs.includes("mcp__*"));
  assert(defaultCliArgs.includes("--permission-mode"));
  assert(defaultCliArgs.includes("default"));
  assert(defaultCliArgs.includes("--system-prompt"));
  assert.equal(
    defaultCliArgs[defaultCliArgs.indexOf("--output-format") + 1],
    "stream-json"
  );
  assert(defaultCliArgs.includes("--max-turns"));
  assert(defaultCliArgs.includes("1"));
  assert(defaultCliArgs.includes("-p"));

  const validatorCliArgs = buildCliArgs(["--settings", "qwen.json"], { type: "object" }, {
    persistSession: false,
    jsonValidator: true,
    run: "run-001",
    model: "qwen",
    probe: "planner",
    schemaFile: "/tmp/planner-output.schema.json",
    validatorLogFile: "/tmp/attempt-001.validator.log",
    attemptLabel: "attempt-001"
  });
  assert(validatorCliArgs.includes("--mcp-config"));
  assert(validatorCliArgs.includes("--allowed-tools"));
  assert(validatorCliArgs.includes("mcp__json_validator__validate_json_output"));
  assert(!validatorCliArgs.includes("mcp__*"));
  assert(validatorCliArgs.includes("--max-turns"));
  assert.equal(validatorCliArgs[validatorCliArgs.indexOf("--max-turns") + 1], "4");
  assert.equal(
    validatorCliArgs[validatorCliArgs.indexOf("--output-format") + 1],
    "stream-json"
  );
  const validatorMcpConfig = JSON.parse(validatorCliArgs[validatorCliArgs.indexOf("--mcp-config") + 1]);
  assert.equal(
    validatorMcpConfig.mcpServers.json_validator.env.MODEL_ROLE_CALIBRATION_VALIDATOR_LOG,
    "/tmp/attempt-001.validator.log"
  );
  assert.equal(
    validatorMcpConfig.mcpServers.json_validator.env.MODEL_ROLE_CALIBRATION_ATTEMPT,
    "attempt-001"
  );

  const persistentCliArgs = buildCliArgs(["--settings", "deepseek.json"], { type: "object" }, {
    persistSession: true,
    run: "run-001",
    model: "deepseek",
    probe: "planner"
  });
  assert(!persistentCliArgs.includes("--no-session-persistence"));
  assert(persistentCliArgs.includes("--name"));
  assert(persistentCliArgs.includes("mrc-run-001-deepseek-planner"));

  const plannerSchema = {
    type: "object",
    required: ["probe", "summary"],
    properties: {
      probe: { const: "planner" },
      summary: { type: "string" }
    },
    additionalProperties: false
  };
  assert.equal(validateJsonText(JSON.stringify({ probe: "planner", summary: "ok" }), plannerSchema).valid, true);
  assert.equal(validateJsonText("```json\n{}\n```", plannerSchema).stage, "json_parse");
  assert.equal(validateJsonText("{\"probe\":\"planner\",\"summary\":\"符合\"不新增平行 API\"的约束\"}", plannerSchema).valid, false);
  assert.equal(validateJsonText(JSON.stringify({ probe: "planner", extra: true }), plannerSchema).stage, "schema");

  const mergedJobs = mergeRequestedJobs([
    { caseId: caseA, model: "kimi", probe: "planner" }
  ], [
    { caseId: caseA, model: "kimi", probe: "planner" },
    { caseId: caseA, model: "kimi", probe: "risk" }
  ]);
  assert.equal(mergedJobs.length, 2);

  console.log("Calibration runtime tests passed");
}

main();
