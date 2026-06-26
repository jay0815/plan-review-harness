#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { parseArgs, requireArg } = require('./lib');
const { generatePrompts } = require('./fact-check-calibration-lib');
function parseModels(value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
function main() {
    const args = parseArgs(process.argv);
    const run = requireArg(args, 'run');
    const caseId = requireArg(args, 'case');
    const models = parseModels(requireArg(args, 'models'));
    if (!models.length) {
        throw new Error('At least one model is required');
    }
    const result = generatePrompts({
        run,
        caseId,
        models,
    });
    console.log(`Generated fact-check prompts: ${result.prompt_dir}`);
    console.log(`Models: ${result.models.join(', ')}`);
}
main();
