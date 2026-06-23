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
  writeGenerated,
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

function generatePrompts({ run, caseId, probes, force = false }) {
  assertSafeCaseId(caseId);
  probes.forEach(assertProbe);

  const promptDir = path.join(ROOT, "runs", run, caseId, "prompts");
  ensureDir(promptDir);

  for (const probe of probes) {
    const input = loadCaseInput(caseId, probe);
    const templateFile = path.join(ROOT, "prompts", `probe-${probe}.md`);
    if (!fs.existsSync(templateFile)) {
      throw new Error(`Missing probe template: ${templateFile}`);
    }
    const template = readText(templateFile);
    const output = template.replace("{{INPUT}}", input);
    const promptFile = path.join(promptDir, `${probe}.md`);
    if (force) {
      writeGenerated(promptFile, output);
    } else {
      writeFileNew(promptFile, output);
    }
  }

  return {
    promptDir,
    prompts: probes.map((probe) => ({
      probe,
      file: path.join(promptDir, `${probe}.md`)
    }))
  };
}

function main() {
  const args = parseArgs(process.argv);
  const caseId = requireArg(args, "case");
  const probes = requireArg(args, "probes").split(",").map((item) => item.trim()).filter(Boolean);
  const run = args.run && args.run !== true ? String(args.run) : uniqueRunId(timestamp());
  const generated = generatePrompts({ run, caseId, probes });

  console.log(`Run ID: ${run}`);
  console.log(`Generated prompts: ${path.relative(path.resolve(ROOT, ".."), generated.promptDir)}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  generatePrompts,
  uniqueRunId
};
