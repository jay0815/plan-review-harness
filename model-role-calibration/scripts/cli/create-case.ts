#!/usr/bin/env node

import * as path from 'node:path'

import { ROOT, ensureDir, parseArgs, requireArg, writeFileNew } from '../lib/lib.js'

const FILES: Record<string, string> = {
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
}

function main(): void {
  const args = parseArgs(process.argv)
  const group = requireArg(args, 'group')
  const id = requireArg(args, 'id')
  if (!/^[A-Za-z0-9_-]+$/.test(group) || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('--group and --id may only contain letters, numbers, underscore, and dash')
  }

  const caseDir = path.join(ROOT, 'cases', group, id)
  ensureDir(caseDir)
  for (const [file, content] of Object.entries(FILES)) {
    writeFileNew(path.join(caseDir, file), content)
  }

  console.log(`Created case: ${group}/${id}`)
  console.log(caseDir)
}

main()
