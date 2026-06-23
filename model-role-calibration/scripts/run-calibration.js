#!/usr/bin/env node
// @ts-check
/**
 * 普通角色校准 CLI（基于通用校准框架）。
 */

const path = require("path");
const {
  PROBES,
  parseArgs,
  loadConfig
} = require("./lib");
const { parseList } = require("./calibration/core");
const { runCalibration } = require("./calibration/runner");
const {
  RoleCalibrationExecutor,
  DEFAULT_CONCURRENCY
} = require("./calibration/role-executor");

const DEFAULT_CASE = "synthetic/event-reporting";

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig();
  const run = args.run && args.run !== true ? String(args.run) : null;
  const caseId = args.case && args.case !== true ? String(args.case) : DEFAULT_CASE;
  const models = parseList(args.models, config.models).map((item) => item.toLowerCase());
  const probes = parseList(args.probes, PROBES);
  const concurrency = args.concurrency && args.concurrency !== true
    ? Number(args.concurrency)
    : DEFAULT_CONCURRENCY;
  const force = args.force === true;

  const executor = new RoleCalibrationExecutor();
  if (force) {
    console.warn(
      "Warning: --force refreshes matching prompts and model outputs. " +
      "Existing score files are not updated and must be rescored before summarization."
    );
  }
  const batch = await runCalibration(executor, {
    run,
    caseId,
    models,
    probes,
    concurrency,
    force,
    config
  });

  if (batch.failed > 0) {
    console.error(`\nRole-play workflow finished with ${batch.failed} failed job(s).`);
  } else {
    console.log("\nRole-play workflow completed.");
  }
  console.log(`Run directory: ${path.join(executor.root, "runs", batch.run)}`);
  console.log("Automated evaluation is not enabled yet.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_CASE,
  main
};
