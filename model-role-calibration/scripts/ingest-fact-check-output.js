#!/usr/bin/env node

const {
  parseArgs,
  requireArg
} = require("./lib");
const {
  ingestOutput
} = require("./fact-check-calibration-lib");

function main() {
  const args = parseArgs(process.argv);
  const result = ingestOutput({
    run: requireArg(args, "run"),
    caseId: requireArg(args, "case"),
    model: requireArg(args, "model"),
    file: requireArg(args, "file")
  });
  console.log(`Raw output saved: ${result.raw_file}`);
  console.log(`Normalized output saved: ${result.normalized_file}`);
}

main();
