#!/usr/bin/env node

const path = require("path");
const {
  parseArgs,
  requireArg
} = require("./lib");
const {
  loadWorkspaceReviewFromArgs
} = require("./workspace-review-lib");
const {
  retryWorkspaceReviewStage
} = require("./run-workspace-review");

async function main() {
  const args = parseArgs(process.argv);
  const runDir = path.resolve(requireArg(args, "run-dir"));
  const stage = requireArg(args, "stage");
  const config = loadWorkspaceReviewFromArgs(args);
  const result = await retryWorkspaceReviewStage(config, runDir, stage, {
    force: Boolean(args.force)
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
