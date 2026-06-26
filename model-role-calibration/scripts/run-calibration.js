#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CASE = void 0;
exports.main = main;
const path = require("node:path");
const core_1 = require("./calibration/core");
const runner_1 = require("./calibration/runner");
const { PROBES, parseArgs, loadConfig } = require('./lib');
const { RoleCalibrationExecutor, DEFAULT_CONCURRENCY } = require('./calibration/role-executor');
exports.DEFAULT_CASE = 'synthetic/event-reporting';
async function main() {
    const args = parseArgs(process.argv);
    const config = loadConfig();
    const run = args.run && args.run !== true ? String(args.run) : null;
    const caseId = args.case && args.case !== true ? String(args.case) : exports.DEFAULT_CASE;
    const models = (0, core_1.parseList)(args.models, config.models).map((item) => item.toLowerCase());
    const probes = (0, core_1.parseList)(args.probes, PROBES);
    const concurrency = args.concurrency && args.concurrency !== true ? Number(args.concurrency) : DEFAULT_CONCURRENCY;
    const force = args.force === true;
    const executor = new RoleCalibrationExecutor();
    if (force) {
        console.warn('Warning: --force refreshes matching prompts and model outputs. ' +
            'Existing score files are not updated and must be rescored before summarization.');
    }
    const batch = await (0, runner_1.runCalibration)(executor, {
        run,
        caseId,
        models,
        probes,
        concurrency,
        force,
        config,
    });
    if (batch.failed > 0) {
        console.error(`\nRole-play workflow finished with ${batch.failed} failed job(s).`);
    }
    else {
        console.log('\nRole-play workflow completed.');
    }
    console.log(`Run directory: ${path.join(executor.root, 'runs', batch.run)}`);
    console.log('Automated evaluation is not enabled yet.');
}
if (require.main === module) {
    main().catch((error) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    });
}
