#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("node:path");
const { parseArgs, requireArg } = require('./lib');
const { loadWorkspaceReviewFromArgs } = require('./workspace-review-lib');
const { retryWorkspaceReviewStage } = require('./run-workspace-review');
async function main() {
    const args = parseArgs(process.argv);
    const runDir = path.resolve(requireArg(args, 'run-dir'));
    const stage = requireArg(args, 'stage');
    const config = loadWorkspaceReviewFromArgs(args);
    const result = await retryWorkspaceReviewStage(config, runDir, stage, {
        force: Boolean(args.force),
    });
    console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) {
    main().catch((error) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    });
}
