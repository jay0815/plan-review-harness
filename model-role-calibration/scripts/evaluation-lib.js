#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCORE_DIMENSIONS = void 0;
exports.parseList = parseList;
exports.hashText = hashText;
exports.buildEvaluationPrompt = buildEvaluationPrompt;
exports.evaluationPaths = evaluationPaths;
exports.nextEvaluationAttempt = nextEvaluationAttempt;
exports.evaluationSchemaFile = evaluationSchemaFile;
exports.validateEvaluationScore = validateEvaluationScore;
exports.buildCodexArgs = buildCodexArgs;
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, assertSafeCaseId, assertProbe, loadCaseInput, parseJsonFile, readText, slug, sumScore } = require('./lib');
const { validateJsonText } = require('./json-validator-mcp');
exports.SCORE_DIMENSIONS = [
    'hit_rate',
    'contract_closure',
    'actionability',
    'evidence_discipline',
    'false_positive_cost',
];
const INPUT_PLACEHOLDER_BY_PROBE = {
    planner: 'PLANNER_INPUT',
    risk: 'REVIEW_INPUT',
    architecture: 'REVIEW_INPUT',
    execution: 'REVIEW_INPUT',
    rebuttal: 'REVIEW_INPUT',
    synthesis: 'SYNTHESIS_INPUT',
};
const OUTPUT_PLACEHOLDER_BY_PROBE = {
    planner: 'PLANNER_OUTPUT',
    risk: 'RISK_OUTPUT',
    architecture: 'ARCHITECTURE_OUTPUT',
    execution: 'EXECUTION_OUTPUT',
    rebuttal: 'REBUTTAL_OUTPUT',
    synthesis: 'SYNTHESIS_OUTPUT',
};
function parseList(value, fallback) {
    const items = !value || value === true
        ? fallback
        : String(value)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    return [...new Set(items)];
}
function hashText(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
function replaceAllLiteral(text, placeholder, value) {
    return text.split(`{{${placeholder}}}`).join(value);
}
function evaluationSourceFiles(run, caseId, model, probe) {
    assertSafeCaseId(caseId);
    assertProbe(probe);
    const evaluatorFile = path.join(ROOT, 'prompts', `evaluate-${probe}.md`);
    const rubricFile = path.join(ROOT, 'cases', caseId, 'rubric.md');
    const outputFile = path.join(ROOT, 'runs', run, caseId, 'agent-outputs', `${slug(model)}-${probe}.json`);
    return { evaluatorFile, rubricFile, outputFile };
}
function buildEvaluationPrompt(run, caseId, model, probe) {
    const files = evaluationSourceFiles(run, caseId, model, probe);
    for (const [label, file] of Object.entries(files)) {
        if (!fs.existsSync(file)) {
            throw new Error(`Missing evaluation ${label}: ${file}`);
        }
    }
    const evaluator = readText(files.evaluatorFile);
    const rubric = readText(files.rubricFile).trim();
    const input = loadCaseInput(caseId, probe).trim();
    const output = JSON.stringify(parseJsonFile(files.outputFile), null, 2);
    let prompt = evaluator;
    prompt = replaceAllLiteral(prompt, 'CASE_ID', caseId);
    prompt = replaceAllLiteral(prompt, 'MODEL', model);
    prompt = replaceAllLiteral(prompt, 'RUBRIC', rubric);
    prompt = replaceAllLiteral(prompt, INPUT_PLACEHOLDER_BY_PROBE[probe], input);
    prompt = replaceAllLiteral(prompt, OUTPUT_PLACEHOLDER_BY_PROBE[probe], output);
    const unresolved = [...prompt.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((match) => match[1]);
    if (unresolved.length) {
        throw new Error(`Unresolved evaluator placeholders: ${[...new Set(unresolved)].join(', ')}`);
    }
    return {
        prompt,
        files,
        hashes: {
            prompt_sha256: hashText(prompt),
            evaluator_sha256: hashText(evaluator),
            rubric_sha256: hashText(rubric),
            input_sha256: hashText(input),
            candidate_output_sha256: hashText(output),
        },
    };
}
function evaluationPaths(run, caseId, model, probe) {
    assertSafeCaseId(caseId);
    assertProbe(probe);
    const baseName = `${slug(model)}-${probe}`;
    const caseDir = path.join(ROOT, 'runs', run, caseId);
    const draftDir = path.join(caseDir, 'scores', 'drafts');
    return {
        caseDir,
        baseName,
        promptFile: path.join(caseDir, 'evaluation-prompts', `${baseName}.md`),
        draftDir,
        draftFile: path.join(draftDir, `${baseName}.score.json`),
        attemptsDir: path.join(draftDir, 'attempts', baseName),
        formalFile: path.join(caseDir, 'scores', `${baseName}.score.json`),
        decisionsDir: path.join(caseDir, 'scores', 'decisions'),
    };
}
function nextEvaluationAttempt(paths) {
    fs.mkdirSync(paths.attemptsDir, { recursive: true });
    const numbers = fs
        .readdirSync(paths.attemptsDir)
        .map((name) => /^attempt-(\d+)\.meta\.json$/.exec(name))
        .filter((match) => Boolean(match))
        .map((match) => Number(match[1]));
    const number = numbers.length ? Math.max(...numbers) + 1 : 1;
    const label = `attempt-${String(number).padStart(3, '0')}`;
    return {
        number,
        label,
        promptFile: path.join(paths.attemptsDir, `${label}.prompt.md`),
        stdoutFile: path.join(paths.attemptsDir, `${label}.stdout.jsonl`),
        stderrFile: path.join(paths.attemptsDir, `${label}.stderr.log`),
        resultFile: path.join(paths.attemptsDir, `${label}.result.json`),
        metadataFile: path.join(paths.attemptsDir, `${label}.meta.json`),
    };
}
function evaluationSchemaFile() {
    return path.join(ROOT, 'schemas', 'evaluation-score.schema.json');
}
function validateEvaluationScore(score, expected) {
    const schemaFile = evaluationSchemaFile();
    const schema = parseJsonFile(schemaFile);
    const validation = validateJsonText(JSON.stringify(score), schema);
    if (!validation.valid) {
        const details = validation.errors?.map((item) => item.message || String(item)).join('; ');
        throw new Error(`Evaluation score schema validation failed: ${details || validation.stage}`);
    }
    for (const field of ['case_id', 'model', 'probe']) {
        if (score[field] !== expected[field]) {
            throw new Error(`Evaluation ${field} mismatch: output has "${score[field]}", expected "${expected[field]}"`);
        }
    }
    const computedTotal = sumScore(score.score);
    if (computedTotal !== score.total) {
        throw new Error(`Evaluation total mismatch: output has ${score.total}, computed ${computedTotal}`);
    }
    for (const dimension of exports.SCORE_DIMENSIONS) {
        if (score.dimension_assessments[dimension].score !== score.score[dimension]) {
            throw new Error(`Evaluation dimension mismatch for ${dimension}: ` +
                `${score.dimension_assessments[dimension].score} != ${score.score[dimension]}`);
        }
    }
    if (!score.notes.includes('角色判断')) {
        throw new Error('Evaluation notes must include an explicit 角色判断');
    }
    return score;
}
function buildCodexArgs(options) {
    const args = [
        'exec',
        '--ignore-user-config',
        '--ignore-rules',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '--ask-for-approval',
        'never',
        '--cd',
        options.workDir,
        '--skip-git-repo-check',
        '--output-schema',
        options.schemaFile,
        '--output-last-message',
        options.resultFile,
        '--color',
        'never',
        '--json',
    ];
    if (options.codexModel) {
        args.push('--model', options.codexModel);
    }
    args.push('-');
    return args;
}
