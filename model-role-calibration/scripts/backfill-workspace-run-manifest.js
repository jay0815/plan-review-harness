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
exports.resolveRunDir = resolveRunDir;
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const lib_js_1 = require("./lib.js");
const workspace_review_manifest_js_1 = require("./workspace-review-manifest.js");
const backfillRunManifest = workspace_review_manifest_js_1.backfillRunManifest;
const DEFAULT_WORKSPACE_RUNS_DIR = path.join(os.homedir(), '.claude', 'plan-review-harness', 'mcp', 'workspace-runs');
function resolveRunDir(args, options = {}) {
    const hasRunDir = args['run-dir'] && args['run-dir'] !== true;
    const hasRunId = args['run-id'] && args['run-id'] !== true;
    if (hasRunDir && hasRunId) {
        throw new Error('Use either --run-id or --run-dir, not both.');
    }
    if (hasRunDir) {
        return path.resolve(String(args['run-dir']));
    }
    if (hasRunId) {
        const runId = String(args['run-id']);
        if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
            throw new Error(`Invalid run id: ${runId}`);
        }
        return path.join(options.workspaceRunsDir || DEFAULT_WORKSPACE_RUNS_DIR, runId);
    }
    throw new Error('Missing required argument: --run-id or --run-dir.');
}
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const runDir = resolveRunDir(args);
    const manifest = backfillRunManifest(runDir, {
        force: Boolean(args.force),
    });
    console.log(JSON.stringify({
        run_id: manifest.run_id,
        status: manifest.status,
        run_dir: path.resolve(runDir),
        run_manifest: path.join(path.resolve(runDir), 'run-manifest.json'),
        resolved_roles: Object.keys(manifest.resolved_execution || {}),
    }, null, 2));
}
if ((0, lib_js_1.isMainScript)(__filename)) {
    try {
        main();
    }
    catch (error) {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    }
}
