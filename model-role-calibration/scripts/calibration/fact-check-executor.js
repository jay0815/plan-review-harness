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
exports.FactCheckExecutor = exports.DEFAULT_CONCURRENCY = exports.CALIBRATION_PROBE = void 0;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const fact_check_calibration_lib_js_1 = require("../fact-check-calibration-lib.js");
const run_model_js_1 = require("../run-model.js");
const workspace_review_lib_js_1 = require("../workspace-review-lib.js");
const core_js_1 = require("./core.js");
const FACT_CHECK_ROOT = fact_check_calibration_lib_js_1.FACT_CHECK_ROOT;
const assertFactCheckCaseId = fact_check_calibration_lib_js_1.assertFactCheckCaseId;
const ingestOutput = fact_check_calibration_lib_js_1.ingestOutput;
const loadCase = fact_check_calibration_lib_js_1.loadCase;
const renderFactCheckPrompt = fact_check_calibration_lib_js_1.renderFactCheckPrompt;
const scoreOutput = fact_check_calibration_lib_js_1.scoreOutput;
const summarizeFactCheckRun = fact_check_calibration_lib_js_1.summarizeRun;
const buildFactCheckReadScope = workspace_review_lib_js_1.buildFactCheckReadScope;
const copyScopedWorkspace = workspace_review_lib_js_1.copyScopedWorkspace;
void buildFactCheckReadScope;
void copyScopedWorkspace;
const buildCliArgs = run_model_js_1.buildCliArgs;
const parseAssistantOutput = run_model_js_1.parseAssistantOutput;
const resolveWrapperCommand = run_model_js_1.resolveWrapperCommand;
const runCommand = run_model_js_1.runCommand;
exports.CALIBRATION_PROBE = 'fact_check';
exports.DEFAULT_CONCURRENCY = 2;
function sha256(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}
function promptPaths(run, caseId) {
    return path.join(FACT_CHECK_ROOT, 'runs', run, caseId, 'prompts');
}
function scopedPaths(run, caseId) {
    return path.join(FACT_CHECK_ROOT, 'runs', run, caseId, 'scoped');
}
function artifactPaths(run, caseId, model) {
    const base = path.join(FACT_CHECK_ROOT, 'runs', run, caseId);
    const modelSlug = (0, core_js_1.slug)(model);
    return {
        base,
        outputDir: path.join(base, 'agent-outputs', modelSlug),
        attemptsDir: path.join(base, 'agent-outputs', modelSlug, 'attempts'),
        resultFile: path.join(base, 'agent-outputs', modelSlug, 'result.json'),
        rawCliFile: path.join(base, 'agent-outputs', modelSlug, 'cli.json'),
        metadataFile: path.join(base, 'agent-outputs', modelSlug, 'meta.json'),
    };
}
function nextAttempt(paths) {
    (0, core_js_1.ensureDir)(paths.attemptsDir);
    const attempts = fs
        .readdirSync(paths.attemptsDir)
        .map((name) => /^attempt-(\d+)\.meta\.json$/.exec(name))
        .filter((match) => Boolean(match))
        .map((match) => Number(match[1]));
    const number = attempts.length ? Math.max(...attempts) + 1 : 1;
    const label = `attempt-${String(number).padStart(3, '0')}`;
    return {
        number,
        label,
        rawCliFile: path.join(paths.attemptsDir, `${label}.cli.json`),
        rawTextFile: path.join(paths.attemptsDir, `${label}.cli.txt`),
        resultFile: path.join(paths.attemptsDir, `${label}.result.json`),
        metadataFile: path.join(paths.attemptsDir, `${label}.meta.json`),
        validatorLogFile: path.join(paths.attemptsDir, `${label}.validator.log`),
    };
}
function completedOutputExists(run, caseId, model) {
    const normalized = path.join(FACT_CHECK_ROOT, 'runs', run, caseId, 'outputs', 'normalized', `${(0, core_js_1.slug)(model)}.json`);
    return fs.existsSync(normalized);
}
function log(message) {
    console.error(`[run-fact-check] ${new Date().toISOString()} ${message}`);
}
function renderScopedPrompt(fixture, projectRoot, readBoundary) {
    const fileList = readBoundary.files?.length
        ? readBoundary.files.map((file) => `- ${file}`).join('\n')
        : '- （无可读取工程文件）';
    const blocked = readBoundary.blocked_refs?.length
        ? ['', '已阻止的外部路径引用：', ...readBoundary.blocked_refs.map((item) => `- ${item}`)].join('\n')
        : '';
    const skipped = readBoundary.skipped_refs?.length
        ? ['', '未暴露或不存在的引用：', ...readBoundary.skipped_refs.slice(0, 30).map((item) => `- ${item}`)].join('\n')
        : '';
    return [
        '# 工程读取能力',
        '',
        `工程原始目录：\`${projectRoot}\``,
        `只读镜像目录：\`${readBoundary.exposed_root}\``,
        '',
        '你可以且只能使用 Read 读取下列相对路径对应的镜像文件。',
        '读取时使用只读镜像目录下的绝对路径；禁止使用 Glob/Grep 搜索新证据，禁止新增 Reviewer 未提出的问题。',
        '',
        '可读取文件：',
        fileList,
        blocked,
        skipped,
        '',
        renderFactCheckPrompt(fixture),
    ]
        .filter(Boolean)
        .join('\n');
}
void scopedPaths;
void renderScopedPrompt;
function extractValidatorCandidate(stdout) {
    const lines = String(stdout || '')
        .trim()
        .split(/\n+/)
        .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        let event;
        try {
            event = JSON.parse(lines[index]);
        }
        catch {
            continue;
        }
        const content = event.message?.content;
        if (!Array.isArray(content)) {
            continue;
        }
        for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
            const block = content[contentIndex];
            if (block?.type === 'tool_use' &&
                block.name === 'mcp__json_validator__validate_json_output' &&
                typeof block.input?.candidate_text === 'string') {
                try {
                    return parseAssistantOutput(block.input.candidate_text, exports.CALIBRATION_PROBE);
                }
                catch {
                    return null;
                }
            }
        }
    }
    return null;
}
function writeCompletedArtifacts(paths, attempt, metadata, parsed) {
    metadata.status = 'completed';
    metadata.error = null;
    (0, core_js_1.writeFileNew)(attempt.rawCliFile, JSON.stringify(parsed.envelope, null, 2) + '\n');
    (0, core_js_1.writeFileNew)(attempt.resultFile, JSON.stringify(parsed.output, null, 2) + '\n');
    (0, core_js_1.writeFileNew)(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n');
    (0, core_js_1.writeGenerated)(paths.rawCliFile, JSON.stringify(parsed.envelope, null, 2) + '\n');
    (0, core_js_1.writeGenerated)(paths.resultFile, JSON.stringify(parsed.output, null, 2) + '\n');
    (0, core_js_1.writeGenerated)(paths.metadataFile, JSON.stringify(metadata, null, 2) + '\n');
}
class FactCheckExecutor {
    get type() {
        return 'fact_check';
    }
    get root() {
        return FACT_CHECK_ROOT;
    }
    validateOptions({ caseId, models, config }) {
        assertFactCheckCaseId(caseId);
        if (!models.length) {
            throw new Error('At least one model is required');
        }
        for (const model of models) {
            if (!config.models.includes(model)) {
                throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`);
            }
        }
    }
    uniqueRunId(caseId) {
        const base = `${(0, core_js_1.slug)(caseId)}-${new Date()
            .toISOString()
            .replace(/[-:.]/g, '')
            .replace(/\d{3}Z$/, 'Z')}`;
        let run = base;
        let suffix = 2;
        while (fs.existsSync(path.join(FACT_CHECK_ROOT, 'runs', run))) {
            run = `${base}-${suffix}`;
            suffix += 1;
        }
        return run;
    }
    generatePrompts({ run, caseId, models }) {
        const fixture = loadCase(caseId);
        const prompt = renderFactCheckPrompt(fixture);
        const promptDir = promptPaths(run, caseId);
        (0, core_js_1.ensureDir)(promptDir);
        (0, core_js_1.writeGenerated)(path.join(promptDir, 'fact_check.md'), prompt);
        for (const model of models) {
            (0, core_js_1.writeGenerated)(path.join(promptDir, `${(0, core_js_1.slug)(model)}-fact_check.md`), prompt);
        }
        return {
            promptDir,
            promptHash: sha256(prompt),
            prompts: models.map((model) => ({
                model,
                probe: exports.CALIBRATION_PROBE,
                file: path.join(promptDir, `${(0, core_js_1.slug)(model)}-fact_check.md`),
            })),
        };
    }
    buildJobs({ run, caseId, models }) {
        return models.map((model) => ({
            run,
            caseId,
            model,
            probe: exports.CALIBRATION_PROBE,
        }));
    }
    async runJob(job) {
        const { run, caseId, model } = job;
        if (completedOutputExists(run, caseId, model)) {
            log(`[skip] ${model}: normalized output already exists`);
            return { model, status: 'skipped' };
        }
        const paths = artifactPaths(run, caseId, model);
        (0, core_js_1.ensureDir)(paths.outputDir);
        const attempt = nextAttempt(paths);
        const startedAt = new Date().toISOString();
        const metadataBase = {
            run,
            case_id: caseId,
            model,
            probe: exports.CALIBRATION_PROBE,
            attempt: attempt.number,
            started_at: startedAt,
            status: 'failed',
        };
        log(`[start] ${model} ${attempt.label}`);
        const config = (0, core_js_1.parseJsonFile)(path.join(path.dirname(FACT_CHECK_ROOT), 'calibration.config.json'));
        const executionConfig = config.agent_execution;
        const timeoutMs = (0, core_js_1.positiveInteger)(executionConfig.timeout_ms, 'agent_execution.timeout_ms');
        const maxBuffer = (0, core_js_1.positiveInteger)(executionConfig.max_buffer_bytes, 'agent_execution.max_buffer_bytes');
        const shell = process.env.MODEL_ROLE_CALIBRATION_SHELL || '/bin/zsh';
        const jsonValidator = true;
        const schemaFile = path.join(path.dirname(FACT_CHECK_ROOT), 'schemas', 'fact-check-output.schema.json');
        const schema = (0, core_js_1.parseJsonFile)(schemaFile);
        const promptDir = promptPaths(run, caseId);
        const promptFile = path.join(promptDir, `${(0, core_js_1.slug)(model)}-fact_check.md`);
        const prompt = (0, core_js_1.readText)(promptFile);
        const wrapper = resolveWrapperCommand(shell, model, 10000, maxBuffer);
        const cliArgs = buildCliArgs(wrapper.args, schema, {
            persistSession: false,
            jsonValidator,
            run,
            model,
            probe: exports.CALIBRATION_PROBE,
            schemaFile,
            validatorLogFile: attempt.validatorLogFile,
            attemptLabel: attempt.label,
            tools: '',
            permissionMode: 'default',
            addDir: null,
        });
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-check-calibration-'));
        let child;
        try {
            child = await runCommand(wrapper.command, cliArgs, {
                cwd: workDir,
                input: prompt,
                timeoutMs,
                killSignal: 'SIGKILL',
                maxBuffer,
                validatorLogFile: jsonValidator ? attempt.validatorLogFile : null,
                env: {
                    ...process.env,
                    CLAUDE_CODE_SIMPLE: '1',
                    MODEL_ROLE_CALIBRATION_MODEL: model,
                    MODEL_ROLE_CALIBRATION_PROBE: exports.CALIBRATION_PROBE,
                    MODEL_ROLE_CALIBRATION_ATTEMPT: attempt.label,
                },
            });
        }
        finally {
            fs.rmSync(workDir, { recursive: true, force: true });
        }
        const metadata = {
            ...metadataBase,
            finished_at: new Date().toISOString(),
            exit_code: child.status,
            signal: child.signal,
            timed_out: child.error?.code === 'ETIMEDOUT',
            command: wrapper.command,
            command_args: cliArgs,
            json_validator_enabled: jsonValidator,
            validator_log_file: jsonValidator ? attempt.validatorLogFile : null,
            stderr: child.stderr || '',
            error: child.error ? child.error.message : null,
        };
        if (child.error || child.status !== 0) {
            const recovered = extractValidatorCandidate(child.stdout);
            if (recovered) {
                metadata.recovered_from_validator = true;
                writeCompletedArtifacts(paths, attempt, metadata, recovered);
                ingestOutput({ run, caseId, model, file: paths.resultFile });
                const score = scoreOutput({ run, caseId, model });
                log(`[recovered] ${model}: status_accuracy=${score.metrics.status_accuracy} challenge_recall=${score.metrics.challenge_recall}`);
                return {
                    model,
                    status: 'completed',
                    recovered_from_validator: true,
                };
            }
            if (child.stdout) {
                (0, core_js_1.writeFileNew)(attempt.rawTextFile, child.stdout);
            }
            (0, core_js_1.writeFileNew)(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n');
            log(`[fail] ${model}: command failed`);
            return { model, status: 'failed', error: metadata.error || `exit ${child.status}` };
        }
        let parsed;
        try {
            parsed = parseAssistantOutput(child.stdout, exports.CALIBRATION_PROBE);
        }
        catch (error) {
            metadata.error = error.message;
            (0, core_js_1.writeFileNew)(attempt.rawTextFile, child.stdout);
            (0, core_js_1.writeFileNew)(attempt.metadataFile, JSON.stringify(metadata, null, 2) + '\n');
            log(`[fail] ${model}: invalid JSON output`);
            return { model, status: 'failed', error: error.message };
        }
        metadata.status = 'completed';
        writeCompletedArtifacts(paths, attempt, metadata, parsed);
        ingestOutput({ run, caseId, model, file: paths.resultFile });
        const score = scoreOutput({ run, caseId, model });
        log(`[done] ${model}: status_accuracy=${score.metrics.status_accuracy} challenge_recall=${score.metrics.challenge_recall}`);
        return { model, status: 'completed' };
    }
    summarizeRun(run) {
        return summarizeFactCheckRun(run);
    }
}
exports.FactCheckExecutor = FactCheckExecutor;
