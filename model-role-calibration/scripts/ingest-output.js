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
const lib_js_1 = require("./lib.js");
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const run = (0, lib_js_1.requireArg)(args, 'run');
    const caseId = (0, lib_js_1.requireArg)(args, 'case');
    const model = (0, lib_js_1.requireArg)(args, 'model');
    const probe = (0, lib_js_1.requireArg)(args, 'probe');
    const file = path.resolve((0, lib_js_1.requireArg)(args, 'file'));
    (0, lib_js_1.assertSafeCaseId)(caseId);
    (0, lib_js_1.assertProbe)(probe);
    if (!fs.existsSync(file)) {
        throw new Error(`Input file does not exist: ${file}`);
    }
    const baseDir = path.join(lib_js_1.ROOT, 'runs', run, caseId, 'outputs');
    const rawDir = path.join(baseDir, 'raw');
    const normalizedDir = path.join(baseDir, 'normalized');
    (0, lib_js_1.ensureDir)(rawDir);
    (0, lib_js_1.ensureDir)(normalizedDir);
    const modelSlug = (0, lib_js_1.slug)(model);
    const rawExt = path.extname(file) || '.txt';
    const rawTarget = path.join(rawDir, `${modelSlug}-${probe}${rawExt}`);
    if (fs.existsSync(rawTarget)) {
        throw new Error(`Refusing to overwrite existing raw output: ${rawTarget}`);
    }
    fs.copyFileSync(file, rawTarget);
    const content = (0, lib_js_1.readText)(file);
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch (error) {
        const message = errorMessage(error);
        const metadataFile = path.join(rawDir, `${modelSlug}-${probe}.invalid.json`);
        if (fs.existsSync(metadataFile)) {
            throw new Error(`Refusing to overwrite existing invalid-output metadata: ${metadataFile}`);
        }
        (0, lib_js_1.writeGenerated)(metadataFile, JSON.stringify({
            case_id: caseId,
            model,
            probe,
            raw_file: rawTarget,
            valid_json: false,
            error: message,
        }, null, 2) + '\n');
        console.error(`Raw output saved: ${rawTarget}`);
        console.error(`Invalid JSON. Fix the file manually, then run ingest again. ${message}`);
        process.exitCode = 1;
        return;
    }
    if (hasProbe(parsed) && parsed.probe !== probe) {
        throw new Error(`Probe mismatch: file has "${parsed.probe}", command has "${probe}"`);
    }
    const normalizedTarget = path.join(normalizedDir, `${modelSlug}-${probe}.json`);
    if (fs.existsSync(normalizedTarget)) {
        throw new Error(`Refusing to overwrite existing normalized output: ${normalizedTarget}`);
    }
    (0, lib_js_1.writeGenerated)(normalizedTarget, JSON.stringify({
        case_id: caseId,
        model,
        probe,
        ingested_at: new Date().toISOString(),
        output: parsed,
    }, null, 2) + '\n');
    console.log(`Raw output saved: ${rawTarget}`);
    console.log(`Normalized output saved: ${normalizedTarget}`);
}
function hasProbe(value) {
    return typeof value === 'object' && value !== null && 'probe' in value;
}
main();
