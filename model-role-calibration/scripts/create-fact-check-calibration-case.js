#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fact_check_calibration_lib_js_1 = require("./fact-check-calibration-lib.js");
const lib_js_1 = require("./lib.js");
const createCaseFromWorkspaceRun = fact_check_calibration_lib_js_1.createCaseFromWorkspaceRun;
function optionalString(value) {
    return value && value !== true ? String(value) : null;
}
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const caseId = (0, lib_js_1.requireArg)(args, 'case');
    const result = createCaseFromWorkspaceRun({
        caseId,
        runId: optionalString(args['run-id']),
        runDir: optionalString(args['run-dir']),
    });
    console.log(`Created fact-check calibration case: ${result.case_file}`);
    console.log(`Issues: ${result.issue_count}`);
    console.log('Fill expected_status labels before scoring candidate outputs.');
}
main();
