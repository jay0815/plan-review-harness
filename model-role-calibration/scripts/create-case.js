#!/usr/bin/env node

const path = require("path");
const {
  ROOT,
  parseArgs,
  requireArg,
  writeFileNew,
  ensureDir
} = require("./lib");

const FILES = {
  "input.md": `# Input

## Task Background

TBD

## Original Requirement

TBD

## Original Plan

TBD

## Constraints

TBD

## Existing Context

TBD
`,
  "context.md": `# Context

Optional. Add only the extra background that should be visible to the tested model.
`,
  "known-issues.md": `# Known Issues

Only for human scoring. Do not include this file in probe prompts.

- TBD
`,
  "expected-findings.md": `# Expected Findings

Only for human scoring.

- TBD
`,
  "expected-bad-findings.md": `# Expected Bad Findings

Findings that should be treated as false positives or low-value noise.

- TBD
`,
  "scoring-notes.md": `# Scoring Notes

- TBD
`
};

function main() {
  const args = parseArgs(process.argv);
  const group = requireArg(args, "group");
  const id = requireArg(args, "id");
  if (!/^[A-Za-z0-9_-]+$/.test(group) || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("--group and --id may only contain letters, numbers, underscore, and dash");
  }

  const caseDir = path.join(ROOT, "cases", group, id);
  ensureDir(caseDir);
  for (const [file, content] of Object.entries(FILES)) {
    writeFileNew(path.join(caseDir, file), content);
  }

  console.log(`Created case: ${group}/${id}`);
  console.log(caseDir);
}

main();
