#!/usr/bin/env node

const path = require("path");
const {
  ROOT,
  parseArgs,
  requireArg,
  assertSafeCaseId,
  assertProbe,
  writeFileNew,
  slug,
  optionalSlugArg
} = require("./lib");

function main() {
  const args = parseArgs(process.argv);
  const run = requireArg(args, "run");
  const caseId = requireArg(args, "case");
  const model = requireArg(args, "model");
  const probe = requireArg(args, "probe");
  const scoreVersion = optionalSlugArg(args, "score-version");
  assertSafeCaseId(caseId);
  assertProbe(probe);

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
      false_positive_cost: 0
    },
    total: 0,
    matched_known_issues: [],
    missed_known_issues: [],
    valuable_new_findings: [],
    false_positives: [],
    failure_modes: [],
    notes: "",
    suggested_roles: [],
    unsuitable_roles: []
  };

  const target = path.join(
    ROOT,
    "runs",
    run,
    caseId,
    "scores",
    ...(scoreVersion ? ["versions", scoreVersion] : []),
    `${slug(model)}-${probe}.score.json`
  );
  writeFileNew(target, JSON.stringify(score, null, 2) + "\n");
  console.log(`Created score file: ${target}`);
}

main();
