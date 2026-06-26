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
exports.RoleCalibrationExecutor = exports.DEFAULT_CONCURRENCY = void 0;
exports.latestAttemptMetadata = latestAttemptMetadata;
exports.failureSummary = failureSummary;
exports.runModelJob = runModelJob;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const generate_prompts_js_1 = require("../generate-prompts.js");
const lib_js_1 = require("../lib.js");
const core_js_1 = require("./core.js");
exports.DEFAULT_CONCURRENCY = 3;
function jobKey(job) {
    return `${job.model}/${job.caseId}/${job.probe}`;
}
function latestAttemptMetadata(run, job) {
    const paths = (0, lib_js_1.agentOutputPaths)(run, job.caseId, job.model, job.probe);
    if (!fs.existsSync(paths.attemptsDir)) {
        return null;
    }
    const attempts = fs
        .readdirSync(paths.attemptsDir)
        .map((name) => {
        const match = /^attempt-(\d+)\.meta\.json$/.exec(name);
        return match ? { name, number: Number(match[1]) } : null;
    })
        .filter((item) => Boolean(item))
        .sort((a, b) => b.number - a.number);
    for (const attempt of attempts) {
        const file = path.join(paths.attemptsDir, attempt.name);
        try {
            return {
                file,
                metadata: (0, lib_js_1.parseJsonFile)(file),
            };
        }
        catch {
            // Try the preceding attempt if the newest metadata is incomplete.
        }
    }
    return null;
}
function failureSummary(metadata, exitCode, signal, spawnError) {
    const compactMessage = (message) => {
        const compact = String(message).replace(/\s+/g, ' ').trim();
        return compact.length > 300 ? `${compact.slice(0, 297)}...` : compact;
    };
    if (spawnError) {
        return `Unable to start model runner: ${spawnError}`;
    }
    if (metadata?.timed_out) {
        return `Model command timed out after ${metadata.timeout_ms}ms`;
    }
    if (metadata?.error) {
        const position = /position (\d+)/i.exec(metadata.error);
        if (position && /valid JSON object|JSON parse/i.test(metadata.error)) {
            return `Invalid model output: JSON parse error at position ${position[1]}`;
        }
        const prefix = metadata.exit_code === 0 ? 'Invalid model output' : 'Model command failed';
        return `${prefix}: ${compactMessage(metadata.error)}`;
    }
    if (exitCode !== null) {
        return `Model runner exited with status ${exitCode}`;
    }
    if (signal) {
        return `Model runner terminated by signal ${signal}`;
    }
    return 'Model runner failed without a recorded error';
}
function runModelJob(job, options = {}) {
    return new Promise((resolve) => {
        const runner = process.env.MODEL_ROLE_CALIBRATION_RUNNER || path.join(lib_js_1.ROOT, 'scripts', 'run-model.js');
        const startedAt = new Date().toISOString();
        const childArgs = [
            runner,
            '--run',
            job.run,
            '--case',
            job.caseId,
            '--model',
            job.model,
            '--probe',
            job.probe,
            '--with-json-validator',
        ];
        if (options.force) {
            childArgs.push('--force');
        }
        const child = (0, node_child_process_1.spawn)(process.execPath, childArgs, {
            cwd: lib_js_1.ROOT,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let spawnError = null;
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', (error) => {
            spawnError = error.message;
        });
        child.on('close', (code, signal) => {
            const paths = (0, lib_js_1.agentOutputPaths)(job.run, job.caseId, job.model, job.probe);
            const base = {
                caseId: job.caseId,
                model: job.model,
                probe: job.probe,
                started_at: startedAt,
                finished_at: new Date().toISOString(),
                exit_code: code,
                signal,
                stdout,
                stderr,
            };
            if (code === 0 && !spawnError && fs.existsSync(paths.resultFile)) {
                resolve({
                    ...base,
                    status: 'completed',
                    error: null,
                });
                return;
            }
            if (code === 0 && !spawnError) {
                resolve({
                    ...base,
                    status: 'failed',
                    error: `Model runner exited successfully without output: ${path.relative(lib_js_1.ROOT, paths.resultFile)}`,
                    attempt_file: null,
                });
                return;
            }
            const attempt = latestAttemptMetadata(job.run, job);
            resolve({
                ...base,
                status: 'failed',
                error: failureSummary(attempt?.metadata, code, signal, spawnError),
                attempt_file: attempt?.file ? path.relative(lib_js_1.ROOT, attempt.file) : null,
            });
        });
    });
}
class RoleCalibrationExecutor {
    get type() {
        return 'role';
    }
    get root() {
        return lib_js_1.ROOT;
    }
    validateOptions({ caseId, models, probes, config, }) {
        (0, lib_js_1.assertSafeCaseId)(caseId);
        if (!models.length) {
            throw new Error('At least one model is required');
        }
        for (const model of models) {
            if (!config.models.includes(model)) {
                throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`);
            }
        }
        if (!probes.length) {
            throw new Error('At least one probe is required');
        }
        probes.forEach(lib_js_1.assertProbe);
    }
    uniqueRunId(caseId) {
        return (0, core_js_1.uniqueRunId)((0, core_js_1.slug)(caseId), lib_js_1.ROOT);
    }
    generatePrompts({ run, caseId, probes, force = false, }) {
        const promptDir = path.join(lib_js_1.ROOT, 'runs', run, caseId, 'prompts');
        const generatedProbes = force
            ? probes
            : probes.filter((probe) => !fs.existsSync(path.join(promptDir, `${probe}.md`)));
        if (generatedProbes.length) {
            (0, generate_prompts_js_1.generatePrompts)({
                run,
                caseId,
                probes: generatedProbes,
                force,
            });
        }
        return {
            promptDir,
            generated: generatedProbes.length,
            reused: probes.length - generatedProbes.length,
            prompts: probes.map((probe) => ({
                probe,
                file: path.join(promptDir, `${probe}.md`),
            })),
        };
    }
    buildJobs({ run, caseId, models, probes, }) {
        const jobs = [];
        for (const probe of probes) {
            for (const model of models) {
                jobs.push({ run, caseId, model, probe });
            }
        }
        return jobs;
    }
    planJobStages({ jobs, concurrency, config, }) {
        const overrides = config.probe_concurrency_overrides || {};
        const stages = [];
        for (const job of jobs) {
            const configuredLimit = overrides[job.probe];
            const effectiveConcurrency = Number.isInteger(configuredLimit)
                ? Math.min(concurrency, configuredLimit)
                : concurrency;
            const label = effectiveConcurrency === concurrency ? 'default' : job.probe;
            const key = `${label}:${effectiveConcurrency}`;
            const current = stages[stages.length - 1];
            if (!current || current.key !== key) {
                stages.push({
                    key,
                    label,
                    concurrency: effectiveConcurrency,
                    jobs: [],
                });
            }
            stages[stages.length - 1].jobs.push(job);
        }
        return stages.map(({ key, ...stage }) => stage);
    }
    async runJob(job, options = {}) {
        const paths = (0, lib_js_1.agentOutputPaths)(job.run, job.caseId, job.model, job.probe);
        const label = jobKey(job);
        if (fs.existsSync(paths.resultFile) && !options.force) {
            console.log(`[skip] ${label}: completed output exists`);
            return {
                caseId: job.caseId,
                model: job.model,
                probe: job.probe,
                status: 'skipped',
                reason: 'completed_output_exists',
                result_file: path.relative(lib_js_1.ROOT, paths.resultFile),
            };
        }
        console.log(`[start] ${label}`);
        const result = await runModelJob(job, options);
        if (result.status === 'completed') {
            console.log(`[done] ${label}`);
        }
        else {
            console.error(`[fail] ${label}`);
            console.error(`  ${result.error}`);
            if (result.attempt_file) {
                console.error(`  attempt: ${result.attempt_file}`);
            }
        }
        return result;
    }
    summarizeRun(run) {
        return {
            run,
            automated_evaluation: false,
        };
    }
}
exports.RoleCalibrationExecutor = RoleCalibrationExecutor;
