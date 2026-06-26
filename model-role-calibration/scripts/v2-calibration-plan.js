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
exports.collectJobs = collectJobs;
exports.scoreFile = scoreFile;
exports.promptFile = promptFile;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const core_js_1 = require("./calibration/core.js");
const generate_prompts_js_1 = require("./generate-prompts.js");
const lib_js_1 = require("./lib.js");
const DEFAULT_SCORE_VERSION = 'manual-v1';
const SCRIPT = 'model-role-calibration/scripts/v2-calibration-plan.js';
const RUN_CALIBRATION = 'model-role-calibration/scripts/run-calibration.js';
const SCORE_OUTPUT = 'model-role-calibration/scripts/score-output.js';
const SUMMARIZE_RESULTS = 'model-role-calibration/scripts/summarize-results.js';
function usage() {
    return [
        'Usage:',
        `  node ${SCRIPT} --run <run-id> --action status`,
        `  node ${SCRIPT} --run <run-id> --action prepare --cases synthetic/plugin-lifecycle`,
        `  node ${SCRIPT} --run <run-id> --action commands --cases synthetic/plugin-lifecycle`,
        `  node ${SCRIPT} --run <run-id> --action score-commands`,
        '',
        'Actions:',
        '  status          Inspect prompt, output, and score coverage. Does not write files.',
        '  prepare         Generate missing prompts only. Does not run models.',
        '  commands        Print model-running commands for the user to run manually.',
        '  score-commands  Print score-output commands for completed outputs missing scores.',
        '  all             Print status, model commands, score commands, and summarize command.',
        '',
        'This helper never starts run-calibration.js or any model wrapper itself.',
    ].join('\n');
}
function rel(file) {
    return path.relative(path.resolve(lib_js_1.ROOT, '..'), file);
}
function promptFile(run, caseId, probe) {
    return path.join(lib_js_1.ROOT, 'runs', run, caseId, 'prompts', `${probe}.md`);
}
function scoreFile(run, caseId, model, probe, scoreVersion) {
    return path.join(lib_js_1.ROOT, 'runs', run, caseId, 'scores', 'versions', scoreVersion, `${(0, lib_js_1.slug)(model)}-${probe}.score.json`);
}
function validateSelection({ cases, models, probes, config }) {
    for (const caseId of cases) {
        (0, lib_js_1.assertSafeCaseId)(caseId);
    }
    for (const model of models) {
        if (!config.models.includes(model)) {
            throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`);
        }
    }
    probes.forEach(lib_js_1.assertProbe);
}
function collectJobs({ run, cases, models, probes, scoreVersion }) {
    const jobs = [];
    for (const caseId of cases) {
        for (const probe of probes) {
            const prompt = promptFile(run, caseId, probe);
            for (const model of models) {
                const output = (0, lib_js_1.agentOutputPaths)(run, caseId, model, probe).resultFile;
                const score = scoreFile(run, caseId, model, probe, scoreVersion);
                jobs.push({
                    run,
                    caseId,
                    model,
                    probe,
                    prompt,
                    output,
                    score,
                    promptExists: fs.existsSync(prompt),
                    outputExists: fs.existsSync(output),
                    scoreExists: fs.existsSync(score),
                });
            }
        }
    }
    return jobs;
}
function byCaseAndProbe(jobs, predicate) {
    const grouped = new Map();
    for (const job of jobs.filter(predicate)) {
        const key = `${job.caseId}\u0000${job.probe}`;
        if (!grouped.has(key)) {
            grouped.set(key, {
                caseId: job.caseId,
                probe: job.probe,
                models: [],
            });
        }
        grouped.get(key).models.push(job.model);
    }
    return [...grouped.values()];
}
function renderStatus({ cases, probes, jobs, scoreVersion }) {
    console.log(`Score version: ${scoreVersion}`);
    for (const caseId of cases) {
        const caseJobs = jobs.filter((job) => job.caseId === caseId);
        const promptCount = probes.filter((probe) => fs.existsSync(promptFile(caseJobs[0]?.run, caseId, probe))).length;
        const outputCount = caseJobs.filter((job) => job.outputExists).length;
        const scoreReadyJobs = caseJobs.filter((job) => job.outputExists);
        const scoreCount = scoreReadyJobs.filter((job) => job.scoreExists).length;
        console.log(`\n${caseId}`);
        console.log(`  prompts: ${promptCount}/${probes.length}`);
        console.log(`  outputs: ${outputCount}/${caseJobs.length}`);
        console.log(`  scores: ${scoreCount}/${scoreReadyJobs.length}`);
        const missingOutputs = byCaseAndProbe(caseJobs, (job) => !job.outputExists);
        if (missingOutputs.length) {
            console.log('  missing outputs:');
            for (const item of missingOutputs) {
                console.log(`    ${item.probe}: ${item.models.join(',')}`);
            }
        }
        const missingScores = byCaseAndProbe(caseJobs, (job) => job.outputExists && !job.scoreExists);
        if (missingScores.length) {
            console.log('  missing scores:');
            for (const item of missingScores) {
                console.log(`    ${item.probe}: ${item.models.join(',')}`);
            }
        }
    }
}
function preparePrompts({ run, cases, probes }) {
    for (const caseId of cases) {
        const missing = probes.filter((probe) => !fs.existsSync(promptFile(run, caseId, probe)));
        if (!missing.length) {
            console.log(`${caseId}: prompts already complete`);
            continue;
        }
        (0, generate_prompts_js_1.generatePrompts)({ run, caseId, probes: missing });
        console.log(`${caseId}: generated ${missing.length} prompt(s)`);
    }
}
function printModelCommands({ run, cases, models, probes, jobs }) {
    console.log('# Prepare prompts first. This command does not run models.');
    console.log(`node ${SCRIPT} --run ${run} --cases ${cases.join(',')} --models ${models.join(',')} ` +
        `--probes ${probes.join(',')} --action prepare`);
    console.log('');
    console.log('# Run these manually when you want to start model calls.');
    for (const caseId of cases) {
        const missing = jobs.some((job) => job.caseId === caseId && !job.outputExists);
        if (!missing) {
            console.log(`# ${caseId}: all outputs already exist`);
            continue;
        }
        console.log([
            `node ${RUN_CALIBRATION} \\`,
            `  --run ${run} \\`,
            `  --case ${caseId} \\`,
            `  --models ${models.join(',')} \\`,
            `  --probes ${probes.join(',')}`,
        ].join('\n'));
        console.log('');
    }
}
function printScoreCommands({ run, jobs, scoreVersion }) {
    const missing = jobs.filter((job) => job.outputExists && !job.scoreExists);
    if (!missing.length) {
        console.log('# No missing score files for completed outputs.');
        return;
    }
    for (const job of missing) {
        console.log([
            `node ${SCORE_OUTPUT} \\`,
            `  --run ${run} \\`,
            `  --case ${job.caseId} \\`,
            `  --model ${job.model} \\`,
            `  --probe ${job.probe} \\`,
            `  --score-version ${scoreVersion}`,
        ].join('\n'));
        console.log('');
    }
}
function printSummaryCommand(run, scoreVersion) {
    console.log('# Summarize after scores are filled.');
    console.log(`node ${SUMMARIZE_RESULTS} --run ${run} --score-version ${scoreVersion}`);
}
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    if (args.help || args.h) {
        console.log(usage());
        return;
    }
    const config = (0, lib_js_1.loadConfig)();
    const run = args.run && args.run !== true ? String(args.run) : null;
    if (!run) {
        throw new Error('Missing required argument: --run\n\n' + usage());
    }
    const action = args.action && args.action !== true ? String(args.action) : 'status';
    const cases = (0, core_js_1.parseList)(args.cases, config.primary_cases);
    const models = (0, core_js_1.parseList)(args.models, config.models).map((item) => item.toLowerCase());
    const probes = (0, core_js_1.parseList)(args.probes, lib_js_1.PROBES);
    const scoreVersion = (0, lib_js_1.optionalSlugArg)(args, 'score-version') || DEFAULT_SCORE_VERSION;
    validateSelection({ cases, models, probes, config });
    const jobs = collectJobs({ run, cases, models, probes, scoreVersion });
    if (action === 'status') {
        renderStatus({ cases, probes, jobs, scoreVersion });
        return;
    }
    if (action === 'prepare') {
        preparePrompts({ run, cases, probes });
        return;
    }
    if (action === 'commands') {
        printModelCommands({ run, cases, models, probes, jobs });
        return;
    }
    if (action === 'score-commands') {
        printScoreCommands({ run, jobs, scoreVersion });
        return;
    }
    if (action === 'all') {
        renderStatus({ cases, probes, jobs, scoreVersion });
        console.log('');
        printModelCommands({ run, cases, models, probes, jobs });
        console.log('');
        printScoreCommands({ run, jobs, scoreVersion });
        console.log('');
        printSummaryCommand(run, scoreVersion);
        return;
    }
    throw new Error(`Unknown action "${action}".\n\n${usage()}`);
}
if ((0, lib_js_1.isMainScript)(__filename)) {
    try {
        main();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    }
}
