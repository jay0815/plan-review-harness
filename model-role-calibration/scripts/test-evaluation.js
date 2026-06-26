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
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const lib_js_1 = require("./lib.js");
const evaluation_lib_js_1 = require("./evaluation-lib.js");
const validateEvaluationScore = evaluation_lib_js_1.validateEvaluationScore;
function runNode(script, args, env = {}) {
    return (0, node_child_process_1.spawnSync)(process.execPath, [script, ...args], {
        cwd: path.resolve(lib_js_1.ROOT, '..'),
        encoding: 'utf8',
        timeout: 10000,
        env: {
            ...process.env,
            ...env,
        },
    });
}
function requireSuccess(result, label) {
    if (result.status !== 0) {
        throw new Error(`${label} failed:\n${result.stdout}\n${result.stderr}`);
    }
}
function scoreFixture(model = 'kimi', probe = 'planner') {
    const dimensions = {
        hit_rate: 4,
        contract_closure: 4,
        actionability: 4,
        evidence_discipline: 4,
        false_positive_cost: 4,
    };
    return {
        case_id: 'synthetic/event-reporting',
        model,
        probe,
        score: dimensions,
        total: 20,
        dimension_assessments: Object.fromEntries(Object.entries(dimensions).map(([name, score]) => [
            name,
            {
                score,
                rationale: `${name} 评分依据`,
                evidence: ['测试证据'],
            },
        ])),
        matched_known_issues: ['命中问题'],
        missed_known_issues: [],
        valuable_new_findings: [],
        false_positives: [],
        failure_modes: [],
        notes: '角色判断：适合作为测试主模型。',
        suggested_roles: [probe],
        unsuitable_roles: [],
    };
}
function main() {
    const run = `evaluation-test-${process.pid}-${Date.now()}`;
    const caseId = 'synthetic/event-reporting';
    const probe = 'planner';
    const model = 'kimi';
    const runDir = path.join(lib_js_1.ROOT, 'runs', run);
    const outputDir = path.join(runDir, caseId, 'agent-outputs');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluation-test-'));
    const fakeCodex = path.join(tempDir, 'fake-codex.mjs');
    const invocationFile = path.join(tempDir, 'invocation.json');
    const runEvaluation = path.join(lib_js_1.ROOT, 'scripts', 'run-evaluation.js');
    const promoteEvaluation = path.join(lib_js_1.ROOT, 'scripts', 'promote-evaluation.js');
    const scoreOutput = path.join(lib_js_1.ROOT, 'scripts', 'score-output.js');
    const summarizeResults = path.join(lib_js_1.ROOT, 'scripts', 'summarize-results.js');
    const generatedOutputs = [
        path.join(lib_js_1.ROOT, 'outputs', 'calibration-results.json'),
        path.join(lib_js_1.ROOT, 'outputs', 'calibration-summary.md'),
        path.join(lib_js_1.ROOT, 'outputs', 'model-role-map.md'),
    ];
    const outputBackups = new Map(generatedOutputs.map((file) => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]));
    try {
        fs.mkdirSync(outputDir, { recursive: true });
        (0, lib_js_1.writeGenerated)(path.join(outputDir, `${model}-${probe}.json`), JSON.stringify({ probe, summary: 'candidate' }, null, 2) + '\n');
        const built = (0, evaluation_lib_js_1.buildEvaluationPrompt)(run, caseId, model, probe);
        (0, node_assert_1.default)(!built.prompt.includes('{{CASE_ID}}'));
        (0, node_assert_1.default)(built.prompt.includes('synthetic/event-reporting'));
        (0, node_assert_1.default)(built.prompt.includes('"summary": "candidate"'));
        const validScore = scoreFixture();
        node_assert_1.default.equal(validateEvaluationScore(validScore, {
            case_id: caseId,
            model,
            probe,
        }), validScore);
        node_assert_1.default.throws(() => validateEvaluationScore({
            ...validScore,
            total: 19,
        }, {
            case_id: caseId,
            model,
            probe,
        }), /total mismatch/);
        const cliArgs = (0, evaluation_lib_js_1.buildCodexArgs)({
            workDir: '/tmp/evaluation-work',
            schemaFile: (0, evaluation_lib_js_1.evaluationSchemaFile)(),
            resultFile: '/tmp/evaluation-result.json',
            codexModel: 'test-evaluator',
        });
        (0, node_assert_1.default)(cliArgs.includes('--ignore-user-config'));
        (0, node_assert_1.default)(cliArgs.includes('--ignore-rules'));
        (0, node_assert_1.default)(cliArgs.includes('--ephemeral'));
        node_assert_1.default.equal(cliArgs[cliArgs.indexOf('--sandbox') + 1], 'read-only');
        node_assert_1.default.equal(cliArgs[cliArgs.indexOf('--ask-for-approval') + 1], 'never');
        (0, node_assert_1.default)(cliArgs.includes('--skip-git-repo-check'));
        (0, node_assert_1.default)(cliArgs.includes('--output-schema'));
        (0, node_assert_1.default)(cliArgs.includes('--output-last-message'));
        (0, node_assert_1.default)(cliArgs.includes('--json'));
        node_assert_1.default.equal(cliArgs[cliArgs.indexOf('--model') + 1], 'test-evaluator');
        let result = runNode(runEvaluation, ['--run', run, '--case', caseId, '--probe', probe, '--models', model]);
        requireSuccess(result, 'generate evaluation prompt');
        (0, node_assert_1.default)(result.stdout.includes('No model was executed.'));
        const paths = (0, evaluation_lib_js_1.evaluationPaths)(run, caseId, model, probe);
        (0, node_assert_1.default)(fs.existsSync(paths.promptFile));
        (0, node_assert_1.default)(!fs.existsSync(paths.draftFile));
        fs.writeFileSync(fakeCodex, `#!/usr/bin/env node
import * as fs from "node:fs";

const args = process.argv.slice(2);
const outputFile = args[args.indexOf("--output-last-message") + 1];
const prompt = fs.readFileSync(0, "utf8");
fs.writeFileSync(process.env.FAKE_CODEX_INVOCATION, JSON.stringify({
  args,
  cwd: process.cwd(),
  prompt_has_candidate: prompt.includes('"summary": "candidate"')
}, null, 2));
fs.writeFileSync(outputFile, JSON.stringify(${JSON.stringify(validScore)}, null, 2) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", status: "completed" }) + "\\n");
`);
        fs.chmodSync(fakeCodex, 0o755);
        result = runNode(runEvaluation, [
            '--run',
            run,
            '--case',
            caseId,
            '--probe',
            probe,
            '--models',
            model,
            '--execute',
            '--codex-model',
            'test-evaluator',
        ], {
            MODEL_ROLE_CALIBRATION_CODEX_BIN: fakeCodex,
            FAKE_CODEX_INVOCATION: invocationFile,
        });
        requireSuccess(result, 'execute draft evaluation');
        (0, node_assert_1.default)(fs.existsSync(paths.draftFile));
        node_assert_1.default.equal((0, lib_js_1.parseJsonFile)(paths.draftFile).total, 20);
        const invocation = (0, lib_js_1.parseJsonFile)(invocationFile);
        (0, node_assert_1.default)(invocation.args.includes('--ignore-user-config'));
        (0, node_assert_1.default)(invocation.args.includes('--ignore-rules'));
        node_assert_1.default.equal(invocation.args[invocation.args.indexOf('--sandbox') + 1], 'read-only');
        node_assert_1.default.equal(invocation.prompt_has_candidate, true);
        (0, node_assert_1.default)(path.basename(invocation.cwd).startsWith('model-role-evaluation-'));
        result = runNode(summarizeResults, ['--run', run]);
        requireSuccess(result, 'summarize with draft only');
        (0, node_assert_1.default)(result.stdout.includes('Scores read: 0'));
        result = runNode(promoteEvaluation, ['--run', run, '--case', caseId, '--probe', probe, '--models', model]);
        node_assert_1.default.notEqual(result.status, 0);
        (0, node_assert_1.default)(result.stderr.includes('--confirmed'));
        (0, node_assert_1.default)(!fs.existsSync(paths.formalFile));
        result = runNode(promoteEvaluation, [
            '--run',
            run,
            '--case',
            caseId,
            '--probe',
            probe,
            '--models',
            model,
            '--confirmed',
        ]);
        requireSuccess(result, 'promote confirmed evaluation');
        (0, node_assert_1.default)(fs.existsSync(paths.formalFile));
        node_assert_1.default.equal((0, lib_js_1.parseJsonFile)(paths.formalFile).total, 20);
        const decisions = fs.readdirSync(paths.decisionsDir).filter((file) => file.endsWith('.json'));
        node_assert_1.default.equal(decisions.length, 1);
        node_assert_1.default.equal((0, lib_js_1.parseJsonFile)(path.join(paths.decisionsDir, decisions[0])).decision, 'human_confirmed');
        result = runNode(summarizeResults, ['--run', run]);
        requireSuccess(result, 'summarize promoted score');
        (0, node_assert_1.default)(result.stdout.includes('Scores read: 1'));
        const versionedRun = `${run}-versioned`;
        const versionedCaseDir = path.join(lib_js_1.ROOT, 'runs', versionedRun, caseId);
        (0, lib_js_1.ensureDir)(versionedCaseDir);
        result = runNode(scoreOutput, [
            '--run',
            versionedRun,
            '--case',
            caseId,
            '--model',
            'GLM',
            '--probe',
            'planner',
            '--score-version',
            'Manual V1',
        ]);
        requireSuccess(result, 'create versioned score');
        const versionedScoreFile = path.join(versionedCaseDir, 'scores', 'versions', 'manual-v1', 'GLM-planner.score.json');
        (0, node_assert_1.default)(fs.existsSync(versionedScoreFile));
        result = runNode(summarizeResults, ['--run', versionedRun]);
        node_assert_1.default.notEqual(result.status, 0);
        (0, node_assert_1.default)(result.stderr.includes('Pass --score-version'));
        result = runNode(summarizeResults, ['--run', versionedRun, '--score-version', 'Manual V1']);
        requireSuccess(result, 'summarize versioned score');
        (0, node_assert_1.default)(result.stdout.includes('Scores read: 1'));
        (0, node_assert_1.default)(result.stdout.includes('Score version: manual-v1'));
        node_assert_1.default.equal((0, lib_js_1.parseJsonFile)(path.join(lib_js_1.ROOT, 'outputs', 'calibration-results.json')).score_version, 'manual-v1');
        console.log('Evaluation workflow tests passed');
    }
    finally {
        for (const [file, content] of outputBackups) {
            if (content === null) {
                fs.rmSync(file, { force: true });
            }
            else {
                fs.writeFileSync(file, content);
            }
        }
        fs.rmSync(runDir, { recursive: true, force: true });
        fs.rmSync(path.join(lib_js_1.ROOT, 'runs', `${run}-versioned`), { recursive: true, force: true });
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
main();
