#!/usr/bin/env node

const {
  parseArgs,
  requireArg
} = require("./lib");
const {
  summarizeRun
} = require("./fact-check-calibration-lib");

function main() {
  const summary = summarizeRun(requireArg(parseArgs(process.argv), "run"));
  console.log(`Scores read: ${summary.scores.length}`);
  console.log(`Recommendation: ${summary.recommendation || "TBD"}`);
}

main();
