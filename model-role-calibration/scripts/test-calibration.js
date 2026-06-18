#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ROOT, loadConfig, schemaForProbe } = require("./lib");
const { parseAssistantOutput, parseJsonEnvelope, buildCliArgs } = require("./run-model");
const { MAX_CONCURRENCY, mergeRequestedJobs } = require("./run-agent-pool");
const { DEFAULT_CASE } = require("./run-calibration");
const {
  parseList,
  compactUtcTimestamp,
  uniqueRunId
} = require("./calibration/core");
const {
  DEFAULT_CONCURRENCY: ROLE_DEFAULT_CONCURRENCY,
  RoleCalibrationExecutor
} = require("./calibration/role-executor");
const { roleRecommendation } = require("./summarize-results");
const { validateJsonText } = require("./json-validator-mcp");
const {
  evaluationSchemaFile,
  validateEvaluationScore
} = require("./evaluation-lib");

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
  assert.equal(ROLE_DEFAULT_CONCURRENCY, 3);
  assert.equal(schemaForProbe("risk"), path.join(ROOT, "schemas", "risk-output.schema.json"));
  assert.equal(
    evaluationSchemaFile(),
    path.join(ROOT, "schemas", "evaluation-score.schema.json")
  );
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
  const evaluationScore = {
    case_id: "synthetic/event-reporting",
    model: "kimi",
    probe: "risk",
    score: {
      hit_rate: 4,
      contract_closure: 4,
      actionability: 4,
      evidence_discipline: 4,
      false_positive_cost: 4
    },
    total: 20,
    dimension_assessments: Object.fromEntries([
      "hit_rate",
      "contract_closure",
      "actionability",
      "evidence_discipline",
      "false_positive_cost"
    ].map((dimension) => [
      dimension,
      {
        score: 4,
        rationale: "测试",
        evidence: []
      }
    ])),
    matched_known_issues: [],
    missed_known_issues: [],
    valuable_new_findings: [],
    false_positives: [],
    failure_modes: [],
    notes: "角色判断：测试。",
    suggested_roles: ["risk"],
    unsuitable_roles: []
  };
  assert.equal(validateEvaluationScore(evaluationScore, {
    case_id: "synthetic/event-reporting",
    model: "kimi",
    probe: "risk"
  }), evaluationScore);
  assert.equal(DEFAULT_CASE, "synthetic/event-reporting");
  assert.deepEqual(parseList("kimi,kimi,qwen", config.models), ["kimi", "qwen"]);
  assert.deepEqual(parseList(undefined, ["kimi", "qwen"]), ["kimi", "qwen"]);
  assert.equal(
    compactUtcTimestamp(new Date("2026-06-11T09:45:09.123Z")),
    "20260611T094509Z"
  );
  assert.equal(
    uniqueRunId(
      "synthetic-new-case",
      ROOT,
      new Date("2026-06-11T09:45:09.123Z")
    ),
    "synthetic-new-case-20260611T094509Z"
  );
  const roleExecutor = new RoleCalibrationExecutor();
  assert.equal(roleExecutor.type, "role");
  assert.deepEqual(
    roleExecutor.buildJobs({
      run: "run-001",
      caseId: "synthetic/event-reporting",
      models: ["kimi", "qwen"],
      probes: ["planner", "risk"]
    }),
    [
      {
        run: "run-001",
        caseId: "synthetic/event-reporting",
        model: "kimi",
        probe: "planner"
      },
      {
        run: "run-001",
        caseId: "synthetic/event-reporting",
        model: "qwen",
        probe: "planner"
      },
      {
        run: "run-001",
        caseId: "synthetic/event-reporting",
        model: "kimi",
        probe: "risk"
      },
      {
        run: "run-001",
        caseId: "synthetic/event-reporting",
        model: "qwen",
        probe: "risk"
      }
    ]
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

  const validatedToolCandidate = {
    probe: "execution",
    issues: [],
    missing_questions: ["who owns event_id?"],
    false_positive_risks: []
  };
  const validatedToolEnvelope = parseAssistantOutput([
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "toolu_validated",
          name: "mcp__json_validator__validate_json_output",
          input: { candidate_text: JSON.stringify(validatedToolCandidate) }
        }]
      }
    }),
    JSON.stringify({
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_validated",
          content: [{ type: "text", text: JSON.stringify({ valid: true, stage: "schema" }) }]
        }]
      }
    }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "{\"probe\":\"execution\",\"issues\":[{\"title\":\"truncated"
    })
  ].join("\n"), "execution");
  assert.deepEqual(validatedToolEnvelope.output, validatedToolCandidate);

  assert.throws(() => parseAssistantOutput([
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "toolu_invalid",
          name: "mcp__json_validator__validate_json_output",
          input: { candidate_text: JSON.stringify(validatedToolCandidate) }
        }]
      }
    }),
    JSON.stringify({
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_invalid",
          content: [{ type: "text", text: JSON.stringify({ valid: false, stage: "schema" }) }]
        }]
      }
    }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "{\"probe\":\"execution\",\"issues\":[{\"title\":\"truncated"
    })
  ].join("\n"), "execution"), /valid JSON object|Unterminated string/);

  const wrappedFactCheckEnvelope = parseAssistantOutput([
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: [
        "<function_results>",
        JSON.stringify({ name: "Read", output: "verification notes" }),
        "</function_results>",
        "<function_calls>",
        JSON.stringify({
          probe: "fact_check",
          checked_issues: [],
          source_summaries: [],
          limits: []
        }),
        "</function_calls>"
      ].join("")
    })
  ].join("\n"), "fact_check");
  assert.equal(wrappedFactCheckEnvelope.output.probe, "fact_check");
  assert.deepEqual(wrappedFactCheckEnvelope.output.checked_issues, []);

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

  const readValidatorCliArgs = buildCliArgs(["--settings", "glm.json"], { type: "object" }, {
    persistSession: false,
    jsonValidator: true,
    run: "run-001",
    model: "glm",
    probe: "fact_check",
    schemaFile: "/tmp/fact-check-output.schema.json",
    validatorLogFile: "/tmp/attempt-001.validator.log",
    attemptLabel: "attempt-001",
    tools: "Read",
    permissionMode: "dontAsk",
    addDir: "/tmp/scoped-project"
  });
  assert.equal(readValidatorCliArgs[readValidatorCliArgs.indexOf("--tools") + 1], "Read");
  assert.equal(
    readValidatorCliArgs[readValidatorCliArgs.indexOf("--allowed-tools") + 1],
    "Read,mcp__json_validator__validate_json_output"
  );
  assert.equal(readValidatorCliArgs[readValidatorCliArgs.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(readValidatorCliArgs[readValidatorCliArgs.indexOf("--add-dir") + 1], "/tmp/scoped-project");
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
  assert.equal(validateJsonText(JSON.stringify({
    name: "",
    nodes: []
  }), {
    type: "object",
    required: ["name", "nodes"],
    properties: {
      name: {
        type: "string",
        minLength: 1,
        pattern: "^[A-Za-z]+$"
      },
      nodes: {
        type: "array",
        minItems: 1
      }
    },
    additionalProperties: false
  }).valid, false);

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
