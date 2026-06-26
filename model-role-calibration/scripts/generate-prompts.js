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
exports.uniqueRunId = uniqueRunId;
exports.generatePrompts = generatePrompts;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const lib_js_1 = require("./lib.js");
function uniqueRunId(base) {
    let run = base;
    let index = 2;
    while (fs.existsSync(path.join(lib_js_1.ROOT, 'runs', run))) {
        run = `${base}-${index}`;
        index += 1;
    }
    return run;
}
function generatePrompts({ run, caseId, probes, force = false }) {
    (0, lib_js_1.assertSafeCaseId)(caseId);
    probes.forEach(lib_js_1.assertProbe);
    const promptDir = path.join(lib_js_1.ROOT, 'runs', run, caseId, 'prompts');
    (0, lib_js_1.ensureDir)(promptDir);
    for (const probe of probes) {
        const input = (0, lib_js_1.loadCaseInput)(caseId, probe);
        const templateFile = path.join(lib_js_1.ROOT, 'prompts', `probe-${probe}.md`);
        if (!fs.existsSync(templateFile)) {
            throw new Error(`Missing probe template: ${templateFile}`);
        }
        const template = (0, lib_js_1.readText)(templateFile);
        const output = template.replace('{{INPUT}}', input);
        const promptFile = path.join(promptDir, `${probe}.md`);
        if (force) {
            (0, lib_js_1.writeGenerated)(promptFile, output);
        }
        else {
            (0, lib_js_1.writeFileNew)(promptFile, output);
        }
    }
    return {
        promptDir,
        prompts: probes.map((probe) => ({
            probe,
            file: path.join(promptDir, `${probe}.md`),
        })),
    };
}
function parseProbes(value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const caseId = (0, lib_js_1.requireArg)(args, 'case');
    const probes = parseProbes((0, lib_js_1.requireArg)(args, 'probes'));
    const run = args.run && args.run !== true ? String(args.run) : uniqueRunId((0, lib_js_1.timestamp)());
    const generated = generatePrompts({ run, caseId, probes });
    console.log(`Run ID: ${run}`);
    console.log(`Generated prompts: ${path.relative(path.resolve(lib_js_1.ROOT, '..'), generated.promptDir)}`);
}
if (require.main === module) {
    main();
}
