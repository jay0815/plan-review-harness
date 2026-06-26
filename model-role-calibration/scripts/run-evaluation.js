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
exports.positiveInteger = positiveInteger;
exports.runProcess = runProcess;
exports.executeEvaluation = executeEvaluation;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const evaluation_lib_js_1 = require("./evaluation-lib.js");
const lib_js_1 = require("./lib.js");
const parseList = evaluation_lib_js_1.parseList;
const buildEvaluationPrompt = evaluation_lib_js_1.buildEvaluationPrompt;
const evaluationPaths = evaluation_lib_js_1.evaluationPaths;
const nextEvaluationAttempt = evaluation_lib_js_1.nextEvaluationAttempt;
const validateEvaluationScore = evaluation_lib_js_1.validateEvaluationScore;
const buildCodexArgs = evaluation_lib_js_1.buildCodexArgs;
function positiveInteger(value, name) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
}
function runProcess(command, args, options) {
    return new Promise((resolve) => {
        const stdout = [];
        const stderr = [];
        let outputBytes = 0;
        let error = null;
        let killed = false;
        const child = (0, node_child_process_1.spawn)(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const timeout = setTimeout(() => {
            killed = true;
            error = new Error(`timed out after ${options.timeoutMs}ms`);
            error.code = 'ETIMEDOUT';
            child.kill('SIGKILL');
        }, options.timeoutMs);
        function append(target, chunk) {
            target.push(chunk);
            outputBytes += chunk.length;
            if (!killed && outputBytes > options.maxBuffer) {
                killed = true;
                error = new Error(`combined stdout/stderr exceeded maxBuffer ${options.maxBuffer}`);
                error.code = 'ENOBUFS';
                child.kill('SIGKILL');
            }
        }
        child.stdout.on('data', (chunk) => append(stdout, chunk));
        child.stderr.on('data', (chunk) => append(stderr, chunk));
        child.on('error', (spawnError) => {
            if (!error) {
                error = spawnError;
            }
        });
        child.on('close', (status, signal) => {
            clearTimeout(timeout);
            resolve({
                status,
                signal,
                error,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
            });
        });
        child.stdin.on('error', (stdinError) => {
            if (stdinError.code !== 'EPIPE' && !error) {
                error = stdinError;
            }
        });
        child.stdin.end(options.input);
    });
}
async function executeEvaluation(options) {
    const paths = evaluationPaths(options.run, options.caseId, options.model, options.probe);
    if (fs.existsSync(paths.draftFile)) {
        console.log(`[skip] draft exists: ${path.relative(lib_js_1.ROOT, paths.draftFile)}`);
        return { status: 'skipped', paths };
    }
    const built = buildEvaluationPrompt(options.run, options.caseId, options.model, options.probe);
    (0, lib_js_1.writeGenerated)(paths.promptFile, built.prompt);
    const attempt = nextEvaluationAttempt(paths);
    (0, lib_js_1.writeFileNew)(attempt.promptFile, built.prompt);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-role-evaluation-'));
    const schemaFile = (0, evaluation_lib_js_1.evaluationSchemaFile)();
    const commandArgs = buildCodexArgs({
        workDir,
        schemaFile,
        resultFile: attempt.resultFile,
        codexModel: options.codexModel,
    });
    const startedAt = new Date().toISOString();
    let child;
    try {
        child = await runProcess(options.codexBin, commandArgs, {
            cwd: workDir,
            env: {
                ...process.env,
                MODEL_ROLE_CALIBRATION_EVALUATION_MODEL: options.model,
                MODEL_ROLE_CALIBRATION_EVALUATION_PROBE: options.probe,
            },
            input: built.prompt,
            timeoutMs: options.timeoutMs,
            maxBuffer: options.maxBuffer,
        });
    }
    finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
    if (child.stdout) {
        (0, lib_js_1.writeFileNew)(attempt.stdoutFile, child.stdout);
    }
    if (child.stderr) {
        (0, lib_js_1.writeFileNew)(attempt.stderrFile, child.stderr);
    }
    const metadata = {
        run: options.run,
        case_id: options.caseId,
        model: options.model,
        probe: options.probe,
        attempt: attempt.number,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        timeout_ms: options.timeoutMs,
        timed_out: child.error?.code === 'ETIMEDOUT',
        exit_code: child.status,
        signal: child.signal,
        status: 'failed',
        error: child.error ? child.error.message : null,
        codex_command: options.codexBin,
        codex_args: commandArgs,
        codex_model: options.codexModel || null,
        prompt_file: path.relative(lib_js_1.ROOT, paths.promptFile),
        attempt_prompt_file: path.relative(lib_js_1.ROOT, attempt.promptFile),
        schema_file: path.relative(lib_js_1.ROOT, schemaFile),
        evaluator_file: path.relative(lib_js_1.ROOT, built.files.evaluatorFile),
        rubric_file: path.relative(lib_js_1.ROOT, built.files.rubricFile),
        candidate_output_file: path.relative(lib_js_1.ROOT, built.files.outputFile),
        hashes: {
            ...built.hashes,
            schema_sha256: (0, evaluation_lib_js_1.hashText)((0, lib_js_1.readText)(schemaFile)),
        },
    };
    if (child.error || child.status !== 0) {
        (0, lib_js_1.writeFileNew)(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n');
        const reason = child.error?.message || `exited with status ${child.status}`;
        throw new Error(`Codex evaluation failed for ${options.model}/${options.probe}: ${reason}`);
    }
    if (!fs.existsSync(attempt.resultFile)) {
        metadata.error = 'Codex did not write --output-last-message';
        (0, lib_js_1.writeFileNew)(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n');
        throw new Error(`Codex evaluation produced no result for ${options.model}/${options.probe}`);
    }
    let score;
    try {
        score = (0, lib_js_1.parseJsonFile)(attempt.resultFile);
        validateEvaluationScore(score, {
            case_id: options.caseId,
            model: options.model,
            probe: options.probe,
        });
    }
    catch (error) {
        metadata.error = error.message;
        (0, lib_js_1.writeFileNew)(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n');
        throw error;
    }
    metadata.status = 'completed';
    metadata.error = null;
    metadata.result_sha256 = (0, evaluation_lib_js_1.hashText)(JSON.stringify(score));
    (0, lib_js_1.writeFileNew)(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n');
    (0, lib_js_1.writeFileNew)(paths.draftFile, JSON.stringify(score, null, 2) + '\n');
    console.log(`[done] ${options.model}/${options.probe}: ${score.total}/25`);
    console.log(`  draft: ${path.relative(lib_js_1.ROOT, paths.draftFile)}`);
    return { status: 'completed', paths, score };
}
async function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const run = (0, lib_js_1.requireArg)(args, 'run');
    const caseId = (0, lib_js_1.requireArg)(args, 'case');
    const probe = (0, lib_js_1.requireArg)(args, 'probe');
    (0, lib_js_1.assertSafeCaseId)(caseId);
    (0, lib_js_1.assertProbe)(probe);
    const config = (0, lib_js_1.loadConfig)();
    const models = parseList(args.models, config.models).map((item) => item.toLowerCase());
    for (const model of models) {
        if (!config.models.includes(model)) {
            throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`);
        }
    }
    const execute = Boolean(args.execute);
    const codexBin = process.env.MODEL_ROLE_CALIBRATION_CODEX_BIN || 'codex';
    const codexModel = args['codex-model'] && args['codex-model'] !== true ? String(args['codex-model']) : null;
    const timeoutMs = positiveInteger(args['timeout-ms'] && args['timeout-ms'] !== true ? args['timeout-ms'] : config.agent_execution.timeout_ms, '--timeout-ms');
    const maxBuffer = positiveInteger(config.agent_execution.max_buffer_bytes, 'agent_execution.max_buffer_bytes');
    for (const model of models) {
        const built = buildEvaluationPrompt(run, caseId, model, probe);
        const paths = evaluationPaths(run, caseId, model, probe);
        (0, lib_js_1.writeGenerated)(paths.promptFile, built.prompt);
        console.log(`[prompt] ${model}/${probe}: ${path.relative(lib_js_1.ROOT, paths.promptFile)}`);
    }
    if (!execute) {
        console.log('\nEvaluation prompts generated. No model was executed.');
        console.log('Run the same command with --execute to create draft scores.');
        return;
    }
    console.log(`\nRunning ${models.length} Codex evaluation(s) for role ${probe}...`);
    const failures = [];
    for (const model of models) {
        try {
            await executeEvaluation({
                run,
                caseId,
                model,
                probe,
                codexBin,
                codexModel,
                timeoutMs,
                maxBuffer,
            });
        }
        catch (error) {
            failures.push({ model, error });
            console.error(`[fail] ${model}/${probe}: ${error.message}`);
        }
    }
    if (failures.length) {
        throw new Error(`${failures.length} evaluation(s) failed; retry the same role after inspection`);
    }
    console.log('\nDraft evaluations completed. Review all four drafts before promotion.');
    console.log('No formal score files were modified.');
}
if ((0, lib_js_1.isMainScript)(__filename)) {
    main().catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    });
}
