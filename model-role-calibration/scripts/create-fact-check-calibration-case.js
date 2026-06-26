#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { parseArgs, requireArg } = require('./lib');
const { createCaseFromWorkspaceRun } = require('./fact-check-calibration-lib');
function optionalString(value) {
    return value && value !== true ? String(value) : null;
}
function main() {
    const args = parseArgs(process.argv);
    const caseId = requireArg(args, 'case');
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
