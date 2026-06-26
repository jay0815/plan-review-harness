#!/usr/bin/env node

const {
  parseArgs,
  requireArg
} = require("./lib");
const {
  createCaseFromWorkspaceRun
} = require("./fact-check-calibration-lib");

function main() {
  const args = parseArgs(process.argv);
  const caseId = requireArg(args, "case");
  const result = createCaseFromWorkspaceRun({
    caseId,
    runId: args["run-id"] && args["run-id"] !== true ? String(args["run-id"]) : null,
    runDir: args["run-dir"] && args["run-dir"] !== true ? String(args["run-dir"]) : null
  });
  console.log(`Created fact-check calibration case: ${result.case_file}`);
  console.log(`Issues: ${result.issue_count}`);
  console.log("Fill expected_status labels before scoring candidate outputs.");
}

main();
