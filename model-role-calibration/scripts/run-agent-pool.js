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
exports.MAX_CONCURRENCY = void 0;
exports.acquireRunLock = acquireRunLock;
exports.failureSummary = failureSummary;
exports.latestAttemptMetadata = latestAttemptMetadata;
exports.mergeRequestedJobs = mergeRequestedJobs;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const lib_js_1 = require("./lib.js");
const MAX_CONCURRENCY = 3;
exports.MAX_CONCURRENCY = MAX_CONCURRENCY;
function parseList(value, fallback) {
    if (!value || value === true) {
        return [...fallback];
    }
    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
function jobKey(job) {
    return `${job.model}/${job.caseId}/${job.probe}`;
}
function validateSelection(cases, models, probes, config, run) {
    for (const caseId of cases) {
        (0, lib_js_1.assertSafeCaseId)(caseId);
    }
    for (const model of models) {
        if (!config.models.includes(model)) {
            throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`);
        }
    }
    for (const probe of probes) {
        (0, lib_js_1.assertProbe)(probe);
    }
    for (const caseId of cases) {
        for (const probe of probes) {
            const promptFile = path.join(lib_js_1.ROOT, 'runs', run, caseId, 'prompts', `${probe}.md`);
            if (!fs.existsSync(promptFile)) {
                throw new Error(`Missing generated prompt: ${promptFile}`);
            }
        }
    }
}
function processExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
function acquireRunLock(lockFile) {
    (0, lib_js_1.ensureDir)(path.dirname(lockFile));
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const fd = fs.openSync(lockFile, 'wx');
            fs.writeFileSync(fd, JSON.stringify({
                pid: process.pid,
                started_at: new Date().toISOString(),
            }, null, 2) + '\n');
            fs.closeSync(fd);
            return () => {
                if (fs.existsSync(lockFile)) {
                    fs.unlinkSync(lockFile);
                }
            };
        }
        catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
            let existing;
            try {
                existing = (0, lib_js_1.parseJsonFile)(lockFile);
            }
            catch {
                existing = null;
            }
            if (!existing?.pid) {
                throw new Error(`Agent pool lock exists but is not readable: ${lockFile}`);
            }
            if (existing?.pid && processExists(existing.pid)) {
                throw new Error(`Another agent pool is active for this harness (pid ${existing.pid})`);
            }
            fs.unlinkSync(lockFile);
        }
    }
    throw new Error(`Unable to acquire run lock: ${lockFile}`);
}
function loadPoolIndex(indexFile) {
    if (!fs.existsSync(indexFile)) {
        return {
            version: 2,
            batches: [],
            requested_jobs: [],
        };
    }
    const existing = (0, lib_js_1.parseJsonFile)(indexFile);
    if (existing.version === 2 && Array.isArray(existing.batches)) {
        return existing;
    }
    const legacyJobs = [...(existing.completed || []), ...(existing.failed || [])]
        .map((item) => ({
        caseId: item.caseId,
        model: item.model,
        probe: item.probe,
    }))
        .filter((item) => item.caseId && item.model && item.probe);
    return {
        version: 2,
        batches: [
            {
                id: 'legacy-agent-pool',
                file: null,
                requested: existing.requested || legacyJobs.length,
                completed: (existing.completed || []).length,
                failed: (existing.failed || []).length,
                skipped: 0,
                imported_legacy_record: true,
            },
        ],
        requested_jobs: legacyJobs,
    };
}
function uniqueBatchId(batchDir) {
    const base = `batch-${(0, lib_js_1.timestamp)()}`;
    let id = base;
    let suffix = 2;
    while (fs.existsSync(path.join(batchDir, `${id}.json`))) {
        id = `${base}-${suffix}`;
        suffix += 1;
    }
    return id;
}
function mergeRequestedJobs(previous, current) {
    const jobs = new Map();
    for (const job of [...previous, ...current]) {
        jobs.set(jobKey(job), {
            caseId: job.caseId,
            model: job.model,
            probe: job.probe,
        });
    }
    return [...jobs.values()].sort((a, b) => jobKey(a).localeCompare(jobKey(b)));
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
        .filter((attempt) => Boolean(attempt))
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
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const run = (0, lib_js_1.requireArg)(args, 'run');
    const config = (0, lib_js_1.loadConfig)();
    const cases = parseList(args.cases, config.primary_cases);
    const models = parseList(args.models, config.models).map((item) => item.toLowerCase());
    const probes = parseList(args.probes, lib_js_1.PROBES);
    validateSelection(cases, models, probes, config, run);
    const requestedJobs = [];
    for (const caseId of cases) {
        for (const probe of probes) {
            for (const model of models) {
                requestedJobs.push({ caseId, model, probe });
            }
        }
    }
    const runDir = path.join(lib_js_1.ROOT, 'runs', run);
    const lockFile = process.env.MODEL_ROLE_CALIBRATION_POOL_LOCK || path.join(lib_js_1.ROOT, 'runs', '.agent-pool.lock');
    const releaseLock = acquireRunLock(lockFile);
    let lockReleased = false;
    const releaseOnce = () => {
        if (!lockReleased) {
            releaseLock();
            lockReleased = true;
        }
    };
    process.once('exit', releaseOnce);
    const batchDir = path.join(runDir, 'agent-pools');
    (0, lib_js_1.ensureDir)(batchDir);
    const batchId = uniqueBatchId(batchDir);
    const batchFile = path.join(batchDir, `${batchId}.json`);
    const indexFile = path.join(runDir, 'agent-pool.json');
    const poolIndex = loadPoolIndex(indexFile);
    const skipped = [];
    const jobs = [];
    for (const job of requestedJobs) {
        const paths = (0, lib_js_1.agentOutputPaths)(run, job.caseId, job.model, job.probe);
        if (fs.existsSync(paths.resultFile)) {
            skipped.push({
                ...job,
                reason: 'completed_output_exists',
                result_file: path.relative(lib_js_1.ROOT, paths.resultFile),
            });
        }
        else {
            jobs.push(job);
        }
    }
    const runner = process.env.MODEL_ROLE_CALIBRATION_RUNNER || path.join(lib_js_1.ROOT, 'scripts', 'run-model.js');
    const pending = [...jobs];
    const active = new Map();
    const completed = [];
    const failed = [];
    const startedAt = new Date().toISOString();
    let sequence = 0;
    let finishing = false;
    function finish() {
        if (finishing) {
            return;
        }
        finishing = true;
        const finishedAt = new Date().toISOString();
        const batch = {
            id: batchId,
            run,
            max_concurrency: MAX_CONCURRENCY,
            started_at: startedAt,
            finished_at: finishedAt,
            requested: requestedJobs.length,
            scheduled: jobs.length,
            pending: 0,
            active: 0,
            ready_for_evaluation: failed.length === 0,
            skipped,
            completed,
            failed,
        };
        (0, lib_js_1.writeFileNew)(batchFile, JSON.stringify(batch, null, 2) + '\n');
        const allRequestedJobs = mergeRequestedJobs(poolIndex.requested_jobs || [], requestedJobs);
        const unresolved = allRequestedJobs.filter((job) => {
            const paths = (0, lib_js_1.agentOutputPaths)(run, job.caseId, job.model, job.probe);
            return !fs.existsSync(paths.resultFile);
        });
        const nextIndex = {
            version: 2,
            run,
            max_concurrency: MAX_CONCURRENCY,
            updated_at: finishedAt,
            ready_for_evaluation: unresolved.length === 0,
            requested_jobs: allRequestedJobs,
            unresolved_jobs: unresolved,
            batches: [
                ...(poolIndex.batches || []),
                {
                    id: batchId,
                    file: path.relative(lib_js_1.ROOT, batchFile),
                    requested: batch.requested,
                    scheduled: batch.scheduled,
                    completed: completed.length,
                    failed: failed.length,
                    skipped: skipped.length,
                    started_at: startedAt,
                    finished_at: finishedAt,
                },
            ],
        };
        (0, lib_js_1.writeGenerated)(indexFile, JSON.stringify(nextIndex, null, 2) + '\n');
        releaseOnce();
        console.log(`Agent pool drained: ${completed.length} completed, ${failed.length} failed, ${skipped.length} skipped`);
        console.log(`Batch summary saved: ${batchFile}`);
        console.log(`Pool index updated: ${indexFile}`);
        if (unresolved.length) {
            console.error(`Role play still has ${unresolved.length} unresolved job(s); retry before evaluation.`);
            process.exitCode = 1;
        }
        else {
            console.log('All requested role-play jobs are complete. Ready for output ingestion and evaluation.');
        }
    }
    function fillPool() {
        while (active.size < MAX_CONCURRENCY && pending.length) {
            const job = pending.shift();
            if (!job) {
                continue;
            }
            sequence += 1;
            const id = sequence;
            const label = jobKey(job);
            const child = (0, node_child_process_1.spawn)(process.execPath, [
                runner,
                '--run',
                run,
                '--case',
                job.caseId,
                '--model',
                job.model,
                '--probe',
                job.probe,
                '--with-json-validator',
            ], {
                cwd: lib_js_1.ROOT,
                env: process.env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            const record = {
                id,
                ...job,
                started_at: new Date().toISOString(),
            };
            active.set(id, { child, record, stdout: '', stderr: '' });
            console.log(`[start ${id}/${jobs.length}] ${label} (active=${active.size})`);
            child.stdout.on('data', (chunk) => {
                const state = active.get(id);
                if (state) {
                    state.stdout += chunk.toString();
                }
            });
            child.stderr.on('data', (chunk) => {
                const state = active.get(id);
                if (state) {
                    state.stderr += chunk.toString();
                }
            });
            child.on('error', (error) => {
                const state = active.get(id);
                if (state) {
                    state.spawnError = error.message;
                }
            });
            child.on('close', (code, signal) => {
                const state = active.get(id);
                if (!state) {
                    return;
                }
                active.delete(id);
                const result = {
                    ...state.record,
                    finished_at: new Date().toISOString(),
                    exit_code: code,
                    signal,
                    stdout: state.stdout,
                    stderr: state.stderr,
                    error: state.spawnError || null,
                };
                const target = code === 0 && !state.spawnError ? completed : failed;
                target.push(result);
                if (target === completed) {
                    console.log(`[done ${id}/${jobs.length}] ${label} (active=${active.size}, pending=${pending.length})`);
                }
                else {
                    const attempt = latestAttemptMetadata(run, job);
                    console.error(`[fail ${id}/${jobs.length}] ${label} (active=${active.size}, pending=${pending.length})`);
                    console.error(`  ${failureSummary(attempt?.metadata, code, signal, state.spawnError)}`);
                    if (attempt?.file) {
                        console.error(`  attempt: ${path.relative(lib_js_1.ROOT, attempt.file)}`);
                    }
                }
                if (!pending.length && !active.size) {
                    finish();
                    return;
                }
                fillPool();
            });
        }
    }
    if (!pending.length) {
        finish();
        return;
    }
    fillPool();
}
if ((0, lib_js_1.isMainScript)(__filename)) {
    try {
        main();
    }
    catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
