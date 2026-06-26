#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("node:path"));
const lib_js_1 = require("./lib.js");
const run_workspace_review_js_1 = require("./run-workspace-review.js");
const workspace_review_lib_js_1 = require("./workspace-review-lib.js");
const loadWorkspaceReviewFromArgs = workspace_review_lib_js_1.loadWorkspaceReviewFromArgs;
const retryWorkspaceReviewStage = run_workspace_review_js_1.retryWorkspaceReviewStage;
async function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const runDir = path.resolve((0, lib_js_1.requireArg)(args, 'run-dir'));
    const stage = (0, lib_js_1.requireArg)(args, 'stage');
    const config = loadWorkspaceReviewFromArgs(args);
    const result = await retryWorkspaceReviewStage(config, runDir, stage, {
        force: Boolean(args.force),
    });
    console.log(JSON.stringify(result, null, 2));
}
if ((0, lib_js_1.isMainScript)(__filename)) {
    main().catch((error) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    });
}
