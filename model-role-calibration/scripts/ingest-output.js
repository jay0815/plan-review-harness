#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, parseArgs, requireArg, assertSafeCaseId, assertProbe, ensureDir, writeGenerated, slug, readText } = require('./lib');
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function main() {
    const args = parseArgs(process.argv);
    const run = requireArg(args, 'run');
    const caseId = requireArg(args, 'case');
    const model = requireArg(args, 'model');
    const probe = requireArg(args, 'probe');
    const file = path.resolve(requireArg(args, 'file'));
    assertSafeCaseId(caseId);
    assertProbe(probe);
    if (!fs.existsSync(file)) {
        throw new Error(`Input file does not exist: ${file}`);
    }
    const baseDir = path.join(ROOT, 'runs', run, caseId, 'outputs');
    const rawDir = path.join(baseDir, 'raw');
    const normalizedDir = path.join(baseDir, 'normalized');
    ensureDir(rawDir);
    ensureDir(normalizedDir);
    const modelSlug = slug(model);
    const rawExt = path.extname(file) || '.txt';
    const rawTarget = path.join(rawDir, `${modelSlug}-${probe}${rawExt}`);
    if (fs.existsSync(rawTarget)) {
        throw new Error(`Refusing to overwrite existing raw output: ${rawTarget}`);
    }
    fs.copyFileSync(file, rawTarget);
    const content = readText(file);
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
        writeGenerated(metadataFile, JSON.stringify({
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
    writeGenerated(normalizedTarget, JSON.stringify({
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
