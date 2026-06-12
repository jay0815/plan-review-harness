#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  ROOT,
  PROBES,
  parseArgs,
  assertSafeCaseId,
  assertProbe,
  loadConfig
} = require("./lib");

const DEFAULT_CASE = "synthetic/event-reporting";

function parseList(value, fallback) {
  const items = !value || value === true
    ? fallback
    : String(value).split(",").map((item) => item.trim()).filter(Boolean);
  return [...new Set(items)];
}

function compactUtcTimestamp(date = new Date()) {
  return date.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function runPrefix(caseId) {
  return caseId.replace(/[^A-Za-z0-9_-]+/g, "-");
}

function uniqueRunId(caseId, date = new Date()) {
  const base = `${runPrefix(caseId)}-${compactUtcTimestamp(date)}`;
  let run = base;
  let suffix = 2;
  while (fs.existsSync(path.join(ROOT, "runs", run))) {
    run = `${base}-${suffix}`;
    suffix += 1;
  }
  return run;
}

function validateOptions(caseId, models, probes, config) {
  assertSafeCaseId(caseId);
  for (const model of models) {
    if (!config.models.includes(model)) {
      throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(", ")}`);
    }
  }
  probes.forEach(assertProbe);
}

function missingPrompts(run, caseId, probes) {
  return probes.filter((probe) => {
    const file = path.join(ROOT, "runs", run, caseId, "prompts", `${probe}.md`);
    return !fs.existsSync(file);
  });
}

function runNodeScript(script, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n== ${label} ==`);
    const child = spawn(process.execPath, [script, ...args], {
      cwd: path.resolve(ROOT, ".."),
      env: process.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(
        signal
          ? `${label} terminated by signal ${signal}`
          : `${label} exited with status ${code}`
      );
      error.exitCode = Number.isInteger(code) ? code : 1;
      reject(error);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig();
  const caseId = args.case && args.case !== true ? String(args.case) : DEFAULT_CASE;
  const models = parseList(args.models, config.models).map((item) => item.toLowerCase());
  const probes = parseList(args.probes, PROBES);
  validateOptions(caseId, models, probes, config);

  const run = args.run && args.run !== true
    ? String(args.run)
    : uniqueRunId(caseId);

  console.log(`Run ID: ${run}`);
  console.log(`Case: ${caseId}`);
  console.log(`Models: ${models.join(",")}`);
  console.log(`Probes: ${probes.join(",")}`);

  const generatePrompts = path.join(ROOT, "scripts", "generate-prompts.js");
  const runAgentPool = path.join(ROOT, "scripts", "run-agent-pool.js");
  const missing = missingPrompts(run, caseId, probes);

  if (missing.length) {
    await runNodeScript(generatePrompts, [
      "--run", run,
      "--case", caseId,
      "--probes", missing.join(",")
    ], `Generate ${missing.length} prompt(s)`);
  } else {
    console.log("\n== Generate prompts ==");
    console.log("All requested prompts already exist; skipping generation.");
  }

  await runNodeScript(runAgentPool, [
    "--run", run,
    "--cases", caseId,
    "--models", models.join(","),
    "--probes", probes.join(",")
  ], `Run ${models.length * probes.length} role-play job(s)`);

  console.log("\nRole-play workflow completed.");
  console.log(`Run directory: ${path.join(ROOT, "runs", run)}`);
  console.log("Automated evaluation is not enabled yet.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = {
  DEFAULT_CASE,
  parseList,
  compactUtcTimestamp,
  uniqueRunId,
  missingPrompts,
  validateOptions,
  runNodeScript
};
