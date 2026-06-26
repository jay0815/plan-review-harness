#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fact_check_executor_js_1 = require("./calibration/fact-check-executor.js");
const runner_js_1 = require("./calibration/runner.js");
const lib_js_1 = require("./lib.js");
function parseModels(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}
async function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const config = (0, lib_js_1.loadConfig)();
    const run = args.run && args.run !== true ? String(args.run) : null;
    const caseId = (0, lib_js_1.requireArg)(args, 'case');
    const models = parseModels((0, lib_js_1.requireArg)(args, 'models'));
    const concurrency = args.concurrency && args.concurrency !== true ? Number(args.concurrency) : fact_check_executor_js_1.DEFAULT_CONCURRENCY;
    const executor = new fact_check_executor_js_1.FactCheckExecutor();
    const batch = await (0, runner_js_1.runCalibration)(executor, {
        run,
        caseId,
        models,
        probes: [],
        concurrency,
        config,
    });
    console.log(JSON.stringify(batch, null, 2));
}
if ((0, lib_js_1.isMainScript)(__filename)) {
    main().catch((error) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    });
}
