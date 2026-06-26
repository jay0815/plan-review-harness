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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const core_js_1 = require("./calibration/core.js");
const role_executor_js_1 = require("./calibration/role-executor.js");
const evaluation_lib_js_1 = require("./evaluation-lib.js");
const lib_js_1 = require("./lib.js");
const run_calibration_js_1 = require("./run-calibration.js");
const run_agent_pool_js_1 = require("./run-agent-pool.js");
const run_model_js_1 = require("./run-model.js");
const summarize_results_js_1 = require("./summarize-results.js");
const json_validator_mcp_js_1 = require("./json-validator-mcp.js");
const validateEvaluationScore = evaluation_lib_js_1.validateEvaluationScore;
const roleRecommendation = summarize_results_js_1.roleRecommendation;
const EXECUTION_BOUNDARIES = [
    'main_path',
    'step_order',
    'dependencies',
    'inputs',
    'outputs',
    'acceptance',
    'tests',
    'failure_semantics',
    'rollback_or_recovery',
    'compatibility_or_release',
    'implementation_discretion',
    'plan_bloat',
];
function executionCoverage() {
    return EXECUTION_BOUNDARIES.map((boundary) => ({
        boundary,
        status: 'covered',
        evidence_basis: 'plan_text',
        notes: `测试候选输出覆盖 ${boundary} 边界。`,
    }));
}
function modelStats(model, plannerCases) {
    return {
        model,
        byProbeCase: {
            planner: plannerCases,
        },
        failure_modes: [],
        failure_modes_by_probe: {
            planner: [],
        },
    };
}
function main() {
    const config = (0, lib_js_1.loadConfig)();
    const [caseA, caseB, caseC] = config.primary_cases;
    node_assert_1.default.equal(run_agent_pool_js_1.MAX_CONCURRENCY, 3);
    node_assert_1.default.equal(role_executor_js_1.DEFAULT_CONCURRENCY, 3);
    node_assert_1.default.equal((0, lib_js_1.schemaForProbe)('risk'), path.join(lib_js_1.ROOT, 'schemas', 'risk-output.schema.json'));
    node_assert_1.default.equal((0, evaluation_lib_js_1.evaluationSchemaFile)(), path.join(lib_js_1.ROOT, 'schemas', 'evaluation-score.schema.json'));
    const riskSchema = JSON.parse(fs.readFileSync((0, lib_js_1.schemaForProbe)('risk'), 'utf8'));
    const validRiskOutput = {
        probe: 'risk',
        issues: [
            {
                title: '阻塞风险',
                type: 'risk',
                severity: 'blocker',
                evidence: 'await reportEvent',
                why_it_matters: '支付成功页等待遥测请求',
                confidence: 0.9,
            },
        ],
        missing_questions: [],
        false_positive_risks: [],
    };
    node_assert_1.default.equal((0, json_validator_mcp_js_1.validateJsonText)(JSON.stringify(validRiskOutput), riskSchema).valid, true);
    node_assert_1.default.equal((0, json_validator_mcp_js_1.validateJsonText)(JSON.stringify({
        ...validRiskOutput,
        issues: [
            {
                ...validRiskOutput.issues[0],
                suggested_fix: '改为异步',
            },
        ],
    }), riskSchema).stage, 'schema');
    const evaluationScore = {
        case_id: 'synthetic/event-reporting',
        model: 'kimi',
        probe: 'risk',
        score: {
            hit_rate: 4,
            contract_closure: 4,
            actionability: 4,
            evidence_discipline: 4,
            false_positive_cost: 4,
        },
        total: 20,
        dimension_assessments: Object.fromEntries(['hit_rate', 'contract_closure', 'actionability', 'evidence_discipline', 'false_positive_cost'].map((dimension) => [
            dimension,
            {
                score: 4,
                rationale: '测试',
                evidence: [],
            },
        ])),
        matched_known_issues: [],
        missed_known_issues: [],
        valuable_new_findings: [],
        false_positives: [],
        failure_modes: [],
        notes: '角色判断：测试。',
        suggested_roles: ['risk'],
        unsuitable_roles: [],
    };
    node_assert_1.default.equal(validateEvaluationScore(evaluationScore, {
        case_id: 'synthetic/event-reporting',
        model: 'kimi',
        probe: 'risk',
    }), evaluationScore);
    node_assert_1.default.equal(run_calibration_js_1.DEFAULT_CASE, 'synthetic/event-reporting');
    const discretionCase = 'synthetic/test-file-discretion';
    const discretionPlanner = (0, lib_js_1.loadCaseInput)(discretionCase, 'planner');
    const discretionReview = (0, lib_js_1.loadCaseInput)(discretionCase, 'execution');
    const discretionSynthesis = (0, lib_js_1.loadCaseInput)(discretionCase, 'synthesis');
    (0, node_assert_1.default)(discretionPlanner.includes('测试文件位置、命名、测试 helper'));
    (0, node_assert_1.default)(discretionReview.includes('## Implementation Discretion'));
    (0, node_assert_1.default)(discretionReview.includes('不要求计划预先指定唯一文件名'));
    (0, node_assert_1.default)(!discretionReview.includes('# Fact Check'));
    (0, node_assert_1.default)(discretionSynthesis.includes('"issue_id": "Execution-Reviewer-001"'));
    (0, node_assert_1.default)(discretionSynthesis.includes('"blocks_execution": false'));
    (0, node_assert_1.default)(discretionSynthesis.includes('"coverage_declaration"'));
    (0, node_assert_1.default)(discretionSynthesis.includes('"boundary": "implementation_discretion"'));
    const stateMigrationCase = 'synthetic/execution-state-migration';
    const stateMigrationReview = (0, lib_js_1.loadCaseInput)(stateMigrationCase, 'execution');
    const stateMigrationSynthesis = (0, lib_js_1.loadCaseInput)(stateMigrationCase, 'synthesis');
    const executionProbePrompt = fs.readFileSync(path.join(lib_js_1.ROOT, 'prompts', 'probe-execution.md'), 'utf8');
    const executionEvaluatorPrompt = fs.readFileSync(path.join(lib_js_1.ROOT, 'prompts', 'evaluate-execution.md'), 'utf8');
    (0, node_assert_1.default)(!config.primary_cases.includes(stateMigrationCase));
    (0, node_assert_1.default)(stateMigrationReview.includes('is_synced: boolean'));
    (0, node_assert_1.default)(stateMigrationReview.includes('v1 到 v2 迁移'));
    (0, node_assert_1.default)(stateMigrationSynthesis.includes('is_synced 布尔状态无法表达迁移未知态'));
    (0, node_assert_1.default)(stateMigrationSynthesis.includes('"boundary": "rollback_or_recovery"'));
    (0, node_assert_1.default)(stateMigrationSynthesis.includes('"issue_id": "Execution-Reviewer-005"'));
    (0, node_assert_1.default)(executionProbePrompt.includes('计划显式写出某个选择，并不自动表示该选择已经可执行或已关闭'));
    (0, node_assert_1.default)(executionProbePrompt.includes('把缺少来源证明、服务端 revision、归属记录或同步状态的旧数据默认标记'));
    (0, node_assert_1.default)(executionProbePrompt.includes('同一逻辑操作的失败重试、批量回落或部分成功重新生成幂等键'));
    (0, node_assert_1.default)(executionEvaluatorPrompt.includes('写清楚错误做法不等于关闭执行契约'));
    (0, node_assert_1.default)(discretionSynthesis.includes('缺少唯一路径会阻塞执行或需要修订计划的后果没有证据支持'));
    node_assert_1.default.deepEqual((0, core_js_1.parseList)('kimi,kimi,qwen', config.models), ['kimi', 'qwen']);
    node_assert_1.default.deepEqual((0, core_js_1.parseList)(undefined, ['kimi', 'qwen']), ['kimi', 'qwen']);
    node_assert_1.default.equal((0, core_js_1.compactUtcTimestamp)(new Date('2026-06-11T09:45:09.123Z')), '20260611T094509Z');
    node_assert_1.default.equal((0, core_js_1.uniqueRunId)('synthetic-new-case', lib_js_1.ROOT, new Date('2026-06-11T09:45:09.123Z')), 'synthetic-new-case-20260611T094509Z');
    const roleExecutor = new role_executor_js_1.RoleCalibrationExecutor();
    node_assert_1.default.equal(roleExecutor.type, 'role');
    const forceRun = `test-force-prompts-${process.pid}-${Date.now()}`;
    const forcePromptFile = path.join(lib_js_1.ROOT, 'runs', forceRun, 'synthetic', 'event-reporting', 'prompts', 'risk.md');
    try {
        roleExecutor.generatePrompts({
            run: forceRun,
            caseId: 'synthetic/event-reporting',
            probes: ['risk'],
        });
        fs.writeFileSync(forcePromptFile, 'stale prompt', 'utf8');
        const refreshed = roleExecutor.generatePrompts({
            run: forceRun,
            caseId: 'synthetic/event-reporting',
            probes: ['risk'],
            force: true,
        });
        node_assert_1.default.equal(refreshed.generated, 1);
        (0, node_assert_1.default)(fs.readFileSync(forcePromptFile, 'utf8').includes('Risk Reviewer'));
    }
    finally {
        fs.rmSync(path.join(lib_js_1.ROOT, 'runs', forceRun), { recursive: true, force: true });
    }
    node_assert_1.default.deepEqual(roleExecutor.buildJobs({
        run: 'run-001',
        caseId: 'synthetic/event-reporting',
        models: ['kimi', 'qwen'],
        probes: ['planner', 'risk'],
    }), [
        {
            run: 'run-001',
            caseId: 'synthetic/event-reporting',
            model: 'kimi',
            probe: 'planner',
        },
        {
            run: 'run-001',
            caseId: 'synthetic/event-reporting',
            model: 'qwen',
            probe: 'planner',
        },
        {
            run: 'run-001',
            caseId: 'synthetic/event-reporting',
            model: 'kimi',
            probe: 'risk',
        },
        {
            run: 'run-001',
            caseId: 'synthetic/event-reporting',
            model: 'qwen',
            probe: 'risk',
        },
    ]);
    const singleCase = roleRecommendation('planner', [modelStats('kimi', { [caseA]: 25 })], config);
    node_assert_1.default.equal(singleCase.status, 'insufficient_coverage');
    node_assert_1.default.equal(singleCase.recommended, null);
    node_assert_1.default.equal(singleCase.comparable_models, 0);
    const oneCompleteModel = roleRecommendation('planner', [
        modelStats('kimi', { [caseA]: 25, [caseB]: 25, [caseC]: 25 }),
        modelStats('deepseek', { [caseA]: 20, [caseB]: 20 }),
    ], config);
    node_assert_1.default.equal(oneCompleteModel.status, 'insufficient_coverage');
    node_assert_1.default.equal(oneCompleteModel.comparable_models, 1);
    const comparableModels = roleRecommendation('planner', [
        modelStats('kimi', { [caseA]: 24, [caseB]: 23, [caseC]: 24 }),
        modelStats('deepseek', { [caseA]: 20, [caseB]: 20, [caseC]: 20 }),
    ], config);
    node_assert_1.default.equal(comparableModels.status, 'candidate');
    node_assert_1.default.equal(comparableModels.recommended, 'kimi');
    node_assert_1.default.equal(comparableModels.comparable_models, 2);
    node_assert_1.default.equal(comparableModels.recommended_stability.minimum, 23);
    node_assert_1.default.equal(comparableModels.recommended_stability.maximum, 24);
    (0, node_assert_1.default)(comparableModels.recommended_stability.standard_deviation > 0);
    const stableFallback = roleRecommendation('planner', [
        modelStats('kimi', { [caseA]: 18, [caseB]: 25, [caseC]: 25 }),
        modelStats('deepseek', { [caseA]: 20, [caseB]: 20, [caseC]: 20 }),
    ], config);
    node_assert_1.default.equal(stableFallback.status, 'candidate');
    node_assert_1.default.equal(stableFallback.top_model, 'kimi');
    node_assert_1.default.equal(stableFallback.recommended, 'deepseek');
    node_assert_1.default.equal(stableFallback.top_stability.minimum, 18);
    node_assert_1.default.equal(stableFallback.top_stability.maximum, 25);
    (0, node_assert_1.default)(stableFallback.top_stability.standard_deviation > config.role_recommendation.maximum_standard_deviation);
    node_assert_1.default.equal(stableFallback.backup, null);
    const unstable = roleRecommendation('planner', [
        modelStats('kimi', { [caseA]: 15, [caseB]: 24, [caseC]: 24 }),
        modelStats('qwen', { [caseA]: 17, [caseB]: 22, [caseC]: 22 }),
    ], config);
    node_assert_1.default.equal(unstable.status, 'unstable');
    node_assert_1.default.equal(unstable.recommended, null);
    node_assert_1.default.equal(unstable.top_model, 'kimi');
    node_assert_1.default.deepEqual(unstable.stability_failures, ['minimum_case_score', 'maximum_standard_deviation']);
    const belowThreshold = roleRecommendation('planner', [
        modelStats('kimi', { [caseA]: 19, [caseB]: 19, [caseC]: 19 }),
        modelStats('deepseek', { [caseA]: 18, [caseB]: 18, [caseC]: 18 }),
    ], config);
    node_assert_1.default.equal(belowThreshold.status, 'below_quality_threshold');
    node_assert_1.default.equal(belowThreshold.recommended, null);
    node_assert_1.default.equal(belowThreshold.top_model, 'kimi');
    const parsed = (0, run_model_js_1.parseAssistantOutput)(JSON.stringify({
        result: 'ok',
        structured_output: {
            probe: 'planner',
        },
    }), 'planner');
    node_assert_1.default.equal(parsed.output.probe, 'planner');
    const noisy = (0, run_model_js_1.parseJsonEnvelope)(`\u001b]1337;startup\u0007\nwarning\n${JSON.stringify({
        structured_output: {
            probe: 'planner',
        },
    })}\n`);
    node_assert_1.default.equal(noisy.structured_output.probe, 'planner');
    const arrayEnvelope = (0, run_model_js_1.parseAssistantOutput)(JSON.stringify([
        { type: 'system', subtype: 'init' },
        {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: JSON.stringify({ probe: 'planner' }),
        },
    ]), 'planner');
    node_assert_1.default.equal(arrayEnvelope.output.probe, 'planner');
    const streamEnvelope = (0, run_model_js_1.parseAssistantOutput)([
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({
            type: 'assistant',
            message: {
                content: [{ type: 'text', text: 'working' }],
            },
        }),
        JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            structured_output: { probe: 'planner' },
        }),
    ].join('\n'), 'planner');
    node_assert_1.default.equal(streamEnvelope.output.probe, 'planner');
    node_assert_1.default.equal(streamEnvelope.envelope.length, 3);
    const validatedToolCandidate = {
        probe: 'execution',
        coverage_declaration: {
            reviewed_boundaries: executionCoverage(),
            unverified_assumptions: [],
            not_reviewed: [],
        },
        issues: [],
        missing_questions: ['who owns event_id?'],
        false_positive_risks: [],
    };
    const validatedToolEnvelope = (0, run_model_js_1.parseAssistantOutput)([
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({
            type: 'assistant',
            message: {
                content: [
                    {
                        type: 'tool_use',
                        id: 'toolu_validated',
                        name: 'mcp__json_validator__validate_json_output',
                        input: { candidate_text: JSON.stringify(validatedToolCandidate) },
                    },
                ],
            },
        }),
        JSON.stringify({
            type: 'user',
            message: {
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'toolu_validated',
                        content: [{ type: 'text', text: JSON.stringify({ valid: true, stage: 'schema' }) }],
                    },
                ],
            },
        }),
        JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: '{"probe":"execution","issues":[{"title":"truncated',
        }),
    ].join('\n'), 'execution');
    node_assert_1.default.deepEqual(validatedToolEnvelope.output, validatedToolCandidate);
    node_assert_1.default.throws(() => (0, run_model_js_1.parseAssistantOutput)([
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({
            type: 'assistant',
            message: {
                content: [
                    {
                        type: 'tool_use',
                        id: 'toolu_invalid',
                        name: 'mcp__json_validator__validate_json_output',
                        input: { candidate_text: JSON.stringify(validatedToolCandidate) },
                    },
                ],
            },
        }),
        JSON.stringify({
            type: 'user',
            message: {
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'toolu_invalid',
                        content: [{ type: 'text', text: JSON.stringify({ valid: false, stage: 'schema' }) }],
                    },
                ],
            },
        }),
        JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: '{"probe":"execution","issues":[{"title":"truncated',
        }),
    ].join('\n'), 'execution'), /valid JSON object|Unterminated string/);
    const wrappedFactCheckEnvelope = (0, run_model_js_1.parseAssistantOutput)([
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: [
                '<function_results>',
                JSON.stringify({ name: 'Read', output: 'verification notes' }),
                '</function_results>',
                '<function_calls>',
                JSON.stringify({
                    probe: 'fact_check',
                    checked_issues: [],
                    source_summaries: [],
                    limits: [],
                }),
                '</function_calls>',
            ].join(''),
        }),
    ].join('\n'), 'fact_check');
    node_assert_1.default.equal(wrappedFactCheckEnvelope.output.probe, 'fact_check');
    node_assert_1.default.deepEqual(wrappedFactCheckEnvelope.output.checked_issues, []);
    const largeStream = [
        ...Array.from({ length: 140 }, (_, index) => JSON.stringify({
            type: 'assistant',
            sequence: index,
            message: {
                content: [{ type: 'text', text: 'x'.repeat(1000) }],
            },
        })),
        JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            structured_output: { probe: 'planner' },
        }),
    ].join('\n');
    (0, node_assert_1.default)(Buffer.byteLength(largeStream) > 128 * 1024);
    const largeStreamEnvelope = (0, run_model_js_1.parseAssistantOutput)(largeStream, 'planner');
    node_assert_1.default.equal(largeStreamEnvelope.output.probe, 'planner');
    node_assert_1.default.equal(largeStreamEnvelope.envelope.length, 141);
    const defaultCliArgs = (0, run_model_js_1.buildCliArgs)(['--settings', 'deepseek.json'], { type: 'object' }, {
        persistSession: false,
        run: 'run-001',
        model: 'deepseek',
        probe: 'planner',
    });
    (0, node_assert_1.default)(defaultCliArgs.includes('--bare'));
    (0, node_assert_1.default)(defaultCliArgs.includes('--no-session-persistence'));
    (0, node_assert_1.default)(defaultCliArgs.includes('--strict-mcp-config'));
    (0, node_assert_1.default)(defaultCliArgs.includes('--disable-slash-commands'));
    (0, node_assert_1.default)(defaultCliArgs.includes('--tools'));
    (0, node_assert_1.default)(defaultCliArgs.includes('--disallowed-tools'));
    (0, node_assert_1.default)(defaultCliArgs.includes('mcp__*'));
    (0, node_assert_1.default)(defaultCliArgs.includes('--permission-mode'));
    (0, node_assert_1.default)(defaultCliArgs.includes('default'));
    (0, node_assert_1.default)(defaultCliArgs.includes('--system-prompt'));
    node_assert_1.default.equal(defaultCliArgs[defaultCliArgs.indexOf('--output-format') + 1], 'stream-json');
    (0, node_assert_1.default)(defaultCliArgs.includes('--max-turns'));
    (0, node_assert_1.default)(defaultCliArgs.includes('1'));
    (0, node_assert_1.default)(defaultCliArgs.includes('-p'));
    const validatorCliArgs = (0, run_model_js_1.buildCliArgs)(['--settings', 'qwen.json'], { type: 'object' }, {
        persistSession: false,
        jsonValidator: true,
        run: 'run-001',
        model: 'qwen',
        probe: 'planner',
        schemaFile: '/tmp/planner-output.schema.json',
        validatorLogFile: '/tmp/attempt-001.validator.log',
        attemptLabel: 'attempt-001',
    });
    (0, node_assert_1.default)(validatorCliArgs.includes('--mcp-config'));
    (0, node_assert_1.default)(validatorCliArgs.includes('--allowed-tools'));
    (0, node_assert_1.default)(validatorCliArgs.includes('mcp__json_validator__validate_json_output'));
    (0, node_assert_1.default)(!validatorCliArgs.includes('mcp__*'));
    (0, node_assert_1.default)(validatorCliArgs.includes('--max-turns'));
    node_assert_1.default.equal(validatorCliArgs[validatorCliArgs.indexOf('--max-turns') + 1], '4');
    node_assert_1.default.equal(validatorCliArgs[validatorCliArgs.indexOf('--output-format') + 1], 'stream-json');
    const readValidatorCliArgs = (0, run_model_js_1.buildCliArgs)(['--settings', 'glm.json'], { type: 'object' }, {
        persistSession: false,
        jsonValidator: true,
        run: 'run-001',
        model: 'glm',
        probe: 'fact_check',
        schemaFile: '/tmp/fact-check-output.schema.json',
        validatorLogFile: '/tmp/attempt-001.validator.log',
        attemptLabel: 'attempt-001',
        tools: 'Read',
        permissionMode: 'dontAsk',
        addDir: '/tmp/scoped-project',
    });
    node_assert_1.default.equal(readValidatorCliArgs[readValidatorCliArgs.indexOf('--tools') + 1], 'Read');
    node_assert_1.default.equal(readValidatorCliArgs[readValidatorCliArgs.indexOf('--allowed-tools') + 1], 'Read,mcp__json_validator__validate_json_output');
    node_assert_1.default.equal(readValidatorCliArgs[readValidatorCliArgs.indexOf('--permission-mode') + 1], 'dontAsk');
    node_assert_1.default.equal(readValidatorCliArgs[readValidatorCliArgs.indexOf('--add-dir') + 1], '/tmp/scoped-project');
    const validatorMcpConfig = JSON.parse(validatorCliArgs[validatorCliArgs.indexOf('--mcp-config') + 1]);
    node_assert_1.default.equal(validatorMcpConfig.mcpServers.json_validator.env.MODEL_ROLE_CALIBRATION_VALIDATOR_LOG, '/tmp/attempt-001.validator.log');
    node_assert_1.default.equal(validatorMcpConfig.mcpServers.json_validator.env.MODEL_ROLE_CALIBRATION_ATTEMPT, 'attempt-001');
    const persistentCliArgs = (0, run_model_js_1.buildCliArgs)(['--settings', 'deepseek.json'], { type: 'object' }, {
        persistSession: true,
        run: 'run-001',
        model: 'deepseek',
        probe: 'planner',
    });
    (0, node_assert_1.default)(!persistentCliArgs.includes('--no-session-persistence'));
    (0, node_assert_1.default)(persistentCliArgs.includes('--name'));
    (0, node_assert_1.default)(persistentCliArgs.includes('mrc-run-001-deepseek-planner'));
    const plannerSchema = {
        type: 'object',
        required: ['probe', 'summary'],
        properties: {
            probe: { const: 'planner' },
            summary: { type: 'string' },
        },
        additionalProperties: false,
    };
    node_assert_1.default.equal((0, json_validator_mcp_js_1.validateJsonText)(JSON.stringify({ probe: 'planner', summary: 'ok' }), plannerSchema).valid, true);
    node_assert_1.default.equal((0, json_validator_mcp_js_1.validateJsonText)('```json\n{}\n```', plannerSchema).stage, 'json_parse');
    node_assert_1.default.equal((0, json_validator_mcp_js_1.validateJsonText)('{"probe":"planner","summary":"符合"不新增平行 API"的约束"}', plannerSchema).valid, false);
    node_assert_1.default.equal((0, json_validator_mcp_js_1.validateJsonText)(JSON.stringify({ probe: 'planner', extra: true }), plannerSchema).stage, 'schema');
    node_assert_1.default.equal((0, json_validator_mcp_js_1.validateJsonText)(JSON.stringify({
        name: '',
        nodes: [],
    }), {
        type: 'object',
        required: ['name', 'nodes'],
        properties: {
            name: {
                type: 'string',
                minLength: 1,
                pattern: '^[A-Za-z]+$',
            },
            nodes: {
                type: 'array',
                minItems: 1,
            },
        },
        additionalProperties: false,
    }).valid, false);
    const mergedJobs = (0, run_agent_pool_js_1.mergeRequestedJobs)([{ caseId: caseA, model: 'kimi', probe: 'planner' }], [
        { caseId: caseA, model: 'kimi', probe: 'planner' },
        { caseId: caseA, model: 'kimi', probe: 'risk' },
    ]);
    node_assert_1.default.equal(mergedJobs.length, 2);
    console.log('Calibration runtime tests passed');
}
main();
