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
const FILES = {
    'inputs/planner.md': `# 需求背景

待填写。

## 需求

待填写。

## 约束

待填写。
`,
    'inputs/review.md': `# 需求背景

待填写。

## 待审查方案

待填写。
`,
    'inputs/synthesis.md': `# 需求背景

待填写。

## Architecture Reviewer

待填写。

## Execution Reviewer

待填写。

## Risk Reviewer

待填写。

## 合成任务

合并重复问题，识别真正分歧，降权误报，并给出修订指令。
`,
    'rubric.md': `# 评分口径

## 确定问题

- 待填写。

## 高质量输出

- 待填写。

## 典型误报

- 出现了待填写。

## 五项评分锚点

- \`hit_rate\`：
- \`contract_closure\`：
- \`actionability\`：
- \`evidence_discipline\`：
- \`false_positive_cost\`：

每项 0 到 5 分，总分 25 分。
`,
};
function main() {
    const args = (0, lib_js_1.parseArgs)(process.argv);
    const group = (0, lib_js_1.requireArg)(args, 'group');
    const id = (0, lib_js_1.requireArg)(args, 'id');
    if (!/^[A-Za-z0-9_-]+$/.test(group) || !/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new Error('--group and --id may only contain letters, numbers, underscore, and dash');
    }
    const caseDir = path.join(lib_js_1.ROOT, 'cases', group, id);
    (0, lib_js_1.ensureDir)(caseDir);
    for (const [file, content] of Object.entries(FILES)) {
        (0, lib_js_1.writeFileNew)(path.join(caseDir, file), content);
    }
    console.log(`Created case: ${group}/${id}`);
    console.log(caseDir);
}
main();
