#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fact_check_calibration_lib_js_1 = require("./fact-check-calibration-lib.js");
const lib_js_1 = require("./lib.js");
const generatePrompts = fact_check_calibration_lib_js_1.generatePrompts;
function parseModels(value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const run = (0, lib_js_1.requireArg)(args, 'run');
    const caseId = (0, lib_js_1.requireArg)(args, 'case');
    const models = parseModels((0, lib_js_1.requireArg)(args, 'models'));
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
