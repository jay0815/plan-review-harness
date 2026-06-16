#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  parseArgs,
  requireArg,
  assertSafeCaseId,
  assertProbe,
  loadConfig,
  parseJsonFile,
  timestamp,
  writeFileNew
} = require("./lib");
const {
  parseList,
  hashText,
  evaluationPaths,
  validateEvaluationScore
} = require("./evaluation-lib");

function main() {
  const args = parseArgs(process.argv);
  const run = requireArg(args, "run");
  const caseId = requireArg(args, "case");
  const probe = requireArg(args, "probe");
  assertSafeCaseId(caseId);
  assertProbe(probe);
  if (!args.confirmed) {
    throw new Error("Refusing promotion without explicit --confirmed");
  }

  const config = loadConfig();
  const models = parseList(args.models, config.models).map((item) => item.toLowerCase());
  const pending = models.map((model) => {
    if (!config.models.includes(model)) {
      throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(", ")}`);
    }
    const paths = evaluationPaths(run, caseId, model, probe);
    if (!fs.existsSync(paths.draftFile)) {
      throw new Error(`Missing draft score: ${paths.draftFile}`);
    }
    if (fs.existsSync(paths.formalFile)) {
      throw new Error(`Refusing to overwrite formal score: ${paths.formalFile}`);
    }
    const score = parseJsonFile(paths.draftFile);
    validateEvaluationScore(score, { case_id: caseId, model, probe });
    return { model, paths, score };
  });

  const promotedAt = new Date().toISOString();
  for (const item of pending) {
    writeFileNew(item.paths.formalFile, JSON.stringify(item.score, null, 2) + "\n");
    console.log(`[promoted] ${item.model}/${probe}: ${item.score.total}/25`);
  }

  const decision = {
    run,
    case_id: caseId,
    probe,
    promoted_at: promotedAt,
    decision: "human_confirmed",
    models: pending.map((item) => ({
      model: item.model,
      total: item.score.total,
      draft_file: path.relative(ROOT, item.paths.draftFile),
      formal_file: path.relative(ROOT, item.paths.formalFile),
      draft_sha256: hashText(JSON.stringify(item.score))
    }))
  };
  const decisionFile = path.join(
    pending[0].paths.decisionsDir,
    `${timestamp()}-${probe}.json`
  );
  writeFileNew(decisionFile, JSON.stringify(decision, null, 2) + "\n");
  console.log(`Promotion decision saved: ${path.relative(ROOT, decisionFile)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
