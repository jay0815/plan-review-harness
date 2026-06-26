#!/usr/bin/env node
// @ts-check
/**
 * Fact-check 校准 CLI（基于通用校准框架）。
 *
 * 保留原有命令行接口，内部通过 CalibrationRunner + FactCheckExecutor 执行。
 */

const {
  parseArgs,
  requireArg,
  loadConfig
} = require("./lib");
const { runCalibration } = require("./calibration/runner");
const { FactCheckExecutor, DEFAULT_CONCURRENCY } = require("./calibration/fact-check-executor");

function parseModels(value, config) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig();

  const run = args.run && args.run !== true ? String(args.run) : null;
  const caseId = requireArg(args, "case");
  const models = parseModels(requireArg(args, "models"), config);
  const concurrency = args.concurrency && args.concurrency !== true
    ? Number(args.concurrency)
    : DEFAULT_CONCURRENCY;

  const executor = new FactCheckExecutor();
  const batch = await runCalibration(executor, {
    run,
    caseId,
    models,
    probes: [],
    concurrency,
    config
  });

  console.log(JSON.stringify(batch, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
