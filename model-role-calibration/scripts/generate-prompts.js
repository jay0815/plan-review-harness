#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  parseArgs,
  requireArg,
  assertSafeCaseId,
  assertProbe,
  ensureDir,
  readText,
  writeFileNew,
  loadCaseInput,
  timestamp
} = require("./lib");

function uniqueRunId(base) {
  let run = base;
  let index = 2;
  while (fs.existsSync(path.join(ROOT, "runs", run))) {
    run = `${base}-${index}`;
    index += 1;
  }
  return run;
}

function main() {
  const args = parseArgs(process.argv);
  const caseId = requireArg(args, "case");
  assertSafeCaseId(caseId);
  const probes = requireArg(args, "probes").split(",").map((item) => item.trim()).filter(Boolean);
  probes.forEach(assertProbe);

  const runId = args.run && args.run !== true ? String(args.run) : uniqueRunId(timestamp());
  const input = loadCaseInput(caseId);
  const promptDir = path.join(ROOT, "runs", runId, caseId, "prompts");
  ensureDir(promptDir);

  for (const probe of probes) {
    const templateFile = path.join(ROOT, "prompts", `probe-${probe}.md`);
    if (!fs.existsSync(templateFile)) {
      throw new Error(`Missing probe template: ${templateFile}`);
    }
    const template = readText(templateFile);
    const output = template.replace("{{INPUT}}", input);
    writeFileNew(path.join(promptDir, `${probe}.md`), output);
  }

  console.log(`Run ID: ${runId}`);
  console.log(`Generated prompts: ${path.join("model-role-calibration", "runs", runId, caseId, "prompts")}`);
}

main();
