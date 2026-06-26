#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fact_check_calibration_lib_js_1 = require("./fact-check-calibration-lib.js");
const lib_js_1 = require("./lib.js");
const summarizeRun = fact_check_calibration_lib_js_1.summarizeRun;
function main() {
    const summary = summarizeRun((0, lib_js_1.requireArg)((0, lib_js_1.parseArgs)(process.argv), 'run'));
    console.log(`Scores read: ${summary.scores.length}`);
    console.log(`Recommendation: ${summary.recommendation || 'TBD'}`);
}
main();
