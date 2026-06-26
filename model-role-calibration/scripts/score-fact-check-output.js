#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fact_check_calibration_lib_js_1 = require("./fact-check-calibration-lib.js");
const lib_js_1 = require("./lib.js");
const scoreOutput = fact_check_calibration_lib_js_1.scoreOutput;
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const score = scoreOutput({
        run: (0, lib_js_1.requireArg)(args, 'run'),
        caseId: (0, lib_js_1.requireArg)(args, 'case'),
        model: (0, lib_js_1.requireArg)(args, 'model'),
    });
    console.log(`Scored ${score.model}/${score.case_id}`);
    console.log(`Status accuracy: ${score.metrics.status_accuracy}`);
    console.log(`Challenge recall: ${score.metrics.challenge_recall}`);
}
main();
