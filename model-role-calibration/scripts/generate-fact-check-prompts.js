#!/usr/bin/env node

const {
  parseArgs,
  requireArg
} = require("./lib");
const {
  generatePrompts
} = require("./fact-check-calibration-lib");

function main() {
  const args = parseArgs(process.argv);
  const run = requireArg(args, "run");
  const caseId = requireArg(args, "case");
  const models = requireArg(args, "models").split(",").map((item) => item.trim()).filter(Boolean);
  if (!models.length) {
    throw new Error("At least one model is required");
  }
  const result = generatePrompts({
    run,
    caseId,
    models
  });
  console.log(`Generated fact-check prompts: ${result.prompt_dir}`);
  console.log(`Models: ${result.models.join(", ")}`);
}

main();
