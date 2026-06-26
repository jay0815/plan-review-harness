#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CASE = void 0;
exports.main = main;
const path = __importStar(require("node:path"));
const core_js_1 = require("./calibration/core.js");
const runner_js_1 = require("./calibration/runner.js");
const role_executor_js_1 = require("./calibration/role-executor.js");
const lib_js_1 = require("./lib.js");
exports.DEFAULT_CASE = 'synthetic/event-reporting';
async function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const config = (0, lib_js_1.loadConfig)();
    const run = args.run && args.run !== true ? String(args.run) : null;
    const caseId = args.case && args.case !== true ? String(args.case) : exports.DEFAULT_CASE;
    const models = (0, core_js_1.parseList)(args.models, config.models).map((item) => item.toLowerCase());
    const probes = (0, core_js_1.parseList)(args.probes, lib_js_1.PROBES);
    const concurrency = args.concurrency && args.concurrency !== true ? Number(args.concurrency) : role_executor_js_1.DEFAULT_CONCURRENCY;
    const force = args.force === true;
    const executor = new role_executor_js_1.RoleCalibrationExecutor();
    if (force) {
        console.warn('Warning: --force refreshes matching prompts and model outputs. ' +
            'Existing score files are not updated and must be rescored before summarization.');
    }
    const batch = await (0, runner_js_1.runCalibration)(executor, {
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
if ((0, lib_js_1.isMainScript)(__filename)) {
    main().catch((error) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    });
}
