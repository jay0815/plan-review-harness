#!/usr/bin/env node

const {
  parseArgs,
  requireArg
} = require("./lib");
const {
  scoreOutput
} = require("./fact-check-calibration-lib");

function main() {
  const args = parseArgs(process.argv);
  const score = scoreOutput({
    run: requireArg(args, "run"),
    caseId: requireArg(args, "case"),
    model: requireArg(args, "model")
  });
  console.log(`Scored ${score.model}/${score.case_id}`);
  console.log(`Status accuracy: ${score.metrics.status_accuracy}`);
  console.log(`Challenge recall: ${score.metrics.challenge_recall}`);
}

main();
