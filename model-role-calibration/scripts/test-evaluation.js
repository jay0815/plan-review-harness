#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  ROOT,
  parseJsonFile,
  writeGenerated
} = require("./lib");
const {
  buildEvaluationPrompt,
  evaluationPaths,
  evaluationSchemaFile,
  validateEvaluationScore,
  buildCodexArgs
} = require("./evaluation-lib");

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

function scoreFixture(model = "kimi", probe = "planner") {
  const dimensions = {
    hit_rate: 4,
    contract_closure: 4,
    actionability: 4,
    evidence_discipline: 4,
    false_positive_cost: 4
  };
  return {
    case_id: "synthetic/event-reporting",
    model,
    probe,
    score: dimensions,
    total: 20,
    dimension_assessments: Object.fromEntries(
      Object.entries(dimensions).map(([name, score]) => [
        name,
        {
          score,
          rationale: `${name} 评分依据`,
          evidence: ["测试证据"]
        }
      ])
    ),
    matched_known_issues: ["命中问题"],
    missed_known_issues: [],
    valuable_new_findings: [],
    false_positives: [],
    failure_modes: [],
    notes: "角色判断：适合作为测试主模型。",
    suggested_roles: [probe],
    unsuitable_roles: []
  };
}

function main() {
  const run = `evaluation-test-${process.pid}-${Date.now()}`;
  const caseId = "synthetic/event-reporting";
  const probe = "planner";
  const model = "kimi";
  const runDir = path.join(ROOT, "runs", run);
  const outputDir = path.join(runDir, caseId, "agent-outputs");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-test-"));
  const fakeCodex = path.join(tempDir, "fake-codex.js");
  const invocationFile = path.join(tempDir, "invocation.json");
  const runEvaluation = path.join(ROOT, "scripts", "run-evaluation.js");
  const promoteEvaluation = path.join(ROOT, "scripts", "promote-evaluation.js");
  const summarizeResults = path.join(ROOT, "scripts", "summarize-results.js");
  const generatedOutputs = [
    path.join(ROOT, "outputs", "calibration-results.json"),
    path.join(ROOT, "outputs", "calibration-summary.md"),
    path.join(ROOT, "outputs", "model-role-map.md")
  ];
  const outputBackups = new Map(generatedOutputs.map((file) => [
    file,
    fs.existsSync(file) ? fs.readFileSync(file) : null
  ]));

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    writeGenerated(
      path.join(outputDir, `${model}-${probe}.json`),
      JSON.stringify({ probe, summary: "candidate" }, null, 2) + "\n"
    );

    const built = buildEvaluationPrompt(run, caseId, model, probe);
    assert(!built.prompt.includes("{{CASE_ID}}"));
    assert(built.prompt.includes("synthetic/event-reporting"));
    assert(built.prompt.includes("\"summary\": \"candidate\""));

    const validScore = scoreFixture();
    assert.equal(
      validateEvaluationScore(validScore, {
        case_id: caseId,
        model,
        probe
      }),
      validScore
    );
    assert.throws(() => validateEvaluationScore({
      ...validScore,
      total: 19
    }, {
      case_id: caseId,
      model,
      probe
    }), /total mismatch/);

    const cliArgs = buildCodexArgs({
      workDir: "/tmp/evaluation-work",
      schemaFile: evaluationSchemaFile(),
      resultFile: "/tmp/evaluation-result.json",
      codexModel: "test-evaluator"
    });
    assert(cliArgs.includes("--ignore-user-config"));
    assert(cliArgs.includes("--ignore-rules"));
    assert(cliArgs.includes("--ephemeral"));
    assert.equal(cliArgs[cliArgs.indexOf("--sandbox") + 1], "read-only");
    assert.equal(cliArgs[cliArgs.indexOf("--ask-for-approval") + 1], "never");
    assert(cliArgs.includes("--skip-git-repo-check"));
    assert(cliArgs.includes("--output-schema"));
    assert(cliArgs.includes("--output-last-message"));
    assert(cliArgs.includes("--json"));
    assert.equal(cliArgs[cliArgs.indexOf("--model") + 1], "test-evaluator");

    let result = runNode(runEvaluation, [
      "--run", run,
      "--case", caseId,
      "--probe", probe,
      "--models", model
    ]);
    requireSuccess(result, "generate evaluation prompt");
    assert(result.stdout.includes("No model was executed."));
    const paths = evaluationPaths(run, caseId, model, probe);
    assert(fs.existsSync(paths.promptFile));
    assert(!fs.existsSync(paths.draftFile));

    fs.writeFileSync(fakeCodex, `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const outputFile = args[args.indexOf("--output-last-message") + 1];
const prompt = fs.readFileSync(0, "utf8");
fs.writeFileSync(process.env.FAKE_CODEX_INVOCATION, JSON.stringify({
  args,
  cwd: process.cwd(),
  prompt_has_candidate: prompt.includes('"summary": "candidate"')
}, null, 2));
fs.writeFileSync(outputFile, JSON.stringify(${JSON.stringify(validScore)}, null, 2) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", status: "completed" }) + "\\n");
`);
    fs.chmodSync(fakeCodex, 0o755);

    result = runNode(runEvaluation, [
      "--run", run,
      "--case", caseId,
      "--probe", probe,
      "--models", model,
      "--execute",
      "--codex-model", "test-evaluator"
    ], {
      MODEL_ROLE_CALIBRATION_CODEX_BIN: fakeCodex,
      FAKE_CODEX_INVOCATION: invocationFile
    });
    requireSuccess(result, "execute draft evaluation");
    assert(fs.existsSync(paths.draftFile));
    assert.equal(parseJsonFile(paths.draftFile).total, 20);
    const invocation = parseJsonFile(invocationFile);
    assert(invocation.args.includes("--ignore-user-config"));
    assert(invocation.args.includes("--ignore-rules"));
    assert.equal(invocation.args[invocation.args.indexOf("--sandbox") + 1], "read-only");
    assert.equal(invocation.prompt_has_candidate, true);
    assert(path.basename(invocation.cwd).startsWith("model-role-evaluation-"));

    result = runNode(summarizeResults, ["--run", run]);
    requireSuccess(result, "summarize with draft only");
    assert(result.stdout.includes("Scores read: 0"));

    result = runNode(promoteEvaluation, [
      "--run", run,
      "--case", caseId,
      "--probe", probe,
      "--models", model
    ]);
    assert.notEqual(result.status, 0);
    assert(result.stderr.includes("--confirmed"));
    assert(!fs.existsSync(paths.formalFile));

    result = runNode(promoteEvaluation, [
      "--run", run,
      "--case", caseId,
      "--probe", probe,
      "--models", model,
      "--confirmed"
    ]);
    requireSuccess(result, "promote confirmed evaluation");
    assert(fs.existsSync(paths.formalFile));
    assert.equal(parseJsonFile(paths.formalFile).total, 20);
    const decisions = fs.readdirSync(paths.decisionsDir).filter((file) => file.endsWith(".json"));
    assert.equal(decisions.length, 1);
    assert.equal(
      parseJsonFile(path.join(paths.decisionsDir, decisions[0])).decision,
      "human_confirmed"
    );

    result = runNode(summarizeResults, ["--run", run]);
    requireSuccess(result, "summarize promoted score");
    assert(result.stdout.includes("Scores read: 1"));

    console.log("Evaluation workflow tests passed");
  } finally {
    for (const [file, content] of outputBackups) {
      if (content === null) {
        fs.rmSync(file, { force: true });
      } else {
        fs.writeFileSync(file, content);
      }
    }
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
