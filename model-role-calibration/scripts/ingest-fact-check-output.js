#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fact_check_calibration_lib_js_1 = require("./fact-check-calibration-lib.js");
const lib_js_1 = require("./lib.js");
const ingestOutput = fact_check_calibration_lib_js_1.ingestOutput;
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const result = ingestOutput({
        run: (0, lib_js_1.requireArg)(args, 'run'),
        caseId: (0, lib_js_1.requireArg)(args, 'case'),
        model: (0, lib_js_1.requireArg)(args, 'model'),
        file: (0, lib_js_1.requireArg)(args, 'file'),
    });
    console.log(`Raw output saved: ${result.raw_file}`);
    console.log(`Normalized output saved: ${result.normalized_file}`);
}
main();
