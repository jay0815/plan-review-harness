#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const runner_1 = require("./calibration/runner");
const { parseArgs, requireArg, loadConfig } = require('./lib');
const { FactCheckExecutor, DEFAULT_CONCURRENCY } = require('./calibration/fact-check-executor');
function parseModels(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}
async function main() {
    const args = parseArgs(process.argv);
    const config = loadConfig();
    const run = args.run && args.run !== true ? String(args.run) : null;
    const caseId = requireArg(args, 'case');
    const models = parseModels(requireArg(args, 'models'));
    const concurrency = args.concurrency && args.concurrency !== true ? Number(args.concurrency) : DEFAULT_CONCURRENCY;
    const executor = new FactCheckExecutor();
    const batch = await (0, runner_1.runCalibration)(executor, {
        run,
        caseId,
        models,
        probes: [],
        concurrency,
        config,
    });
    console.log(JSON.stringify(batch, null, 2));
}
if (require.main === module) {
    main().catch((error) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    });
}
