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
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const evaluation_lib_js_1 = require("./evaluation-lib.js");
const lib_js_1 = require("./lib.js");
const parseList = evaluation_lib_js_1.parseList;
const evaluationPaths = evaluation_lib_js_1.evaluationPaths;
const validateEvaluationScore = evaluation_lib_js_1.validateEvaluationScore;
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const run = (0, lib_js_1.requireArg)(args, 'run');
    const caseId = (0, lib_js_1.requireArg)(args, 'case');
    const probe = (0, lib_js_1.requireArg)(args, 'probe');
    (0, lib_js_1.assertSafeCaseId)(caseId);
    (0, lib_js_1.assertProbe)(probe);
    if (!args.confirmed) {
        throw new Error('Refusing promotion without explicit --confirmed');
    }
    const config = (0, lib_js_1.loadConfig)();
    const models = parseList(args.models, config.models).map((item) => item.toLowerCase());
    const pending = models.map((model) => {
        if (!config.models.includes(model)) {
            throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(', ')}`);
        }
        const paths = evaluationPaths(run, caseId, model, probe);
        if (!fs.existsSync(paths.draftFile)) {
            throw new Error(`Missing draft score: ${paths.draftFile}`);
        }
        if (fs.existsSync(paths.formalFile)) {
            throw new Error(`Refusing to overwrite formal score: ${paths.formalFile}`);
        }
        const score = (0, lib_js_1.parseJsonFile)(paths.draftFile);
        validateEvaluationScore(score, { case_id: caseId, model, probe });
        return { model, paths, score };
    });
    const promotedAt = new Date().toISOString();
    for (const item of pending) {
        (0, lib_js_1.writeFileNew)(item.paths.formalFile, JSON.stringify(item.score, null, 2) + '\n');
        console.log(`[promoted] ${item.model}/${probe}: ${item.score.total}/25`);
    }
    const decision = {
        run,
        case_id: caseId,
        probe,
        promoted_at: promotedAt,
        decision: 'human_confirmed',
        models: pending.map((item) => ({
            model: item.model,
            total: item.score.total,
            draft_file: path.relative(lib_js_1.ROOT, item.paths.draftFile),
            formal_file: path.relative(lib_js_1.ROOT, item.paths.formalFile),
            draft_sha256: (0, evaluation_lib_js_1.hashText)(JSON.stringify(item.score)),
        })),
    };
    const decisionFile = path.join(pending[0].paths.decisionsDir, `${(0, lib_js_1.timestamp)()}-${probe}.json`);
    (0, lib_js_1.writeFileNew)(decisionFile, JSON.stringify(decision, null, 2) + '\n');
    console.log(`Promotion decision saved: ${path.relative(lib_js_1.ROOT, decisionFile)}`);
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
