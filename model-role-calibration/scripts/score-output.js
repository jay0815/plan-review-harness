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
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const run = (0, lib_js_1.requireArg)(args, 'run');
    const caseId = (0, lib_js_1.requireArg)(args, 'case');
    const model = (0, lib_js_1.requireArg)(args, 'model');
    const probe = (0, lib_js_1.requireArg)(args, 'probe');
    const scoreVersion = (0, lib_js_1.optionalSlugArg)(args, 'score-version');
    (0, lib_js_1.assertSafeCaseId)(caseId);
    (0, lib_js_1.assertProbe)(probe);
    const score = {
        case_id: caseId,
        model,
        probe,
        ...(scoreVersion ? { score_version: scoreVersion } : {}),
        score: {
            hit_rate: 0,
            contract_closure: 0,
            actionability: 0,
            evidence_discipline: 0,
            false_positive_cost: 0,
        },
        total: 0,
        matched_known_issues: [],
        missed_known_issues: [],
        valuable_new_findings: [],
        false_positives: [],
        failure_modes: [],
        notes: '',
        suggested_roles: [],
        unsuitable_roles: [],
    };
    const target = path.join(lib_js_1.ROOT, 'runs', run, caseId, 'scores', ...(scoreVersion ? ['versions', scoreVersion] : []), `${(0, lib_js_1.slug)(model)}-${probe}.score.json`);
    (0, lib_js_1.writeFileNew)(target, JSON.stringify(score, null, 2) + '\n');
    console.log(`Created score file: ${target}`);
}
main();
