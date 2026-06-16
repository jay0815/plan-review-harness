#!/usr/bin/env node

const path = require("path");
const {
  ROOT,
  parseArgs,
  requireArg,
  parseJsonFile,
  loadConfig,
  sumScore,
  walk,
  writeGenerated
} = require("./lib");

const PROBE_COLUMNS = ["planner", "risk", "architecture", "execution", "rebuttal", "synthesis"];
const ROLE_BY_PROBE = {
  planner: "A Planner",
  risk: "D Risk Reviewer",
  architecture: "B Architecture Reviewer",
  execution: "C Execution Reviewer",
  synthesis: "S Synthesizer"
};

function average(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function pushUnique(list, values) {
  for (const value of values || []) {
    if (value && !list.includes(value)) {
      list.push(value);
    }
  }
}

function formatScore(value) {
  return value === null || value === undefined ? "-" : value.toFixed(1);
}

function formatProbeCell(item, probe, requiredCount) {
  const coverage = item.coverage[probe].length;
  return `${formatScore(item.averages[probe])} (${coverage}/${requiredCount})`;
}

function roleRecommendation(probe, modelStats, config) {
  const role = ROLE_BY_PROBE[probe];
  if (!role) {
    return null;
  }
  const requiredCases = config.primary_cases;
  const candidates = modelStats
    .map((item) => {
      const scoresByCase = item.byProbeCase[probe] || {};
      const missingCases = requiredCases.filter((caseId) => scoresByCase[caseId] === undefined);
      const values = requiredCases.map((caseId) => scoresByCase[caseId]).filter((value) => value !== undefined);
      return {
        model: item.model,
        avg: missingCases.length ? null : average(values),
        covered_cases: requiredCases.length - missingCases.length,
        missing_cases: missingCases,
        failure_modes: item.failure_modes
      };
    })
    .filter((item) => item.avg !== null)
    .sort((a, b) => b.avg - a.avg);

  const minimumComparableModels = config.role_recommendation.minimum_comparable_models;
  if (candidates.length < minimumComparableModels) {
    return {
      role,
      probe,
      status: "insufficient_data",
      recommended: null,
      backup: null,
      avoid: [],
      required_cases: requiredCases,
      comparable_models: candidates.length,
      minimum_comparable_models: minimumComparableModels,
      minimum_average_score: config.role_recommendation.minimum_average_score,
      top_score: candidates[0]?.avg ?? null
    };
  }

  const recommended = candidates[0];
  const backup = candidates[1] || null;
  const avoid = candidates.filter((item) => item.avg < 12.5).map((item) => item.model);
  const status = recommended.avg >= config.role_recommendation.minimum_average_score
    ? "candidate"
    : "insufficient_data";

  return {
    role,
    probe,
    status,
    recommended: status === "candidate" ? recommended.model : null,
    recommended_score: recommended.avg,
    backup: backup ? backup.model : null,
    backup_score: backup ? backup.avg : null,
    avoid,
    required_cases: requiredCases,
    comparable_models: candidates.length,
    minimum_comparable_models: minimumComparableModels,
    minimum_average_score: config.role_recommendation.minimum_average_score,
    top_score: recommended.avg,
    failure_modes: recommended.failure_modes || []
  };
}

function main() {
  const args = parseArgs(process.argv);
  const run = requireArg(args, "run");
  const config = loadConfig();
  const runDir = path.join(ROOT, "runs", run);
  const draftSegment = `${path.sep}scores${path.sep}drafts${path.sep}`;
  const scoreFiles = walk(runDir, (file) => (
    file.endsWith(".score.json") && !file.includes(draftSegment)
  ));
  const scores = scoreFiles.map((file) => {
    const data = parseJsonFile(file);
    const computedTotal = sumScore(data.score || {});
    return {
      ...data,
      total: Number(data.total || computedTotal),
      score_file: path.relative(ROOT, file)
    };
  });

  const cases = [...new Set(scores.map((item) => item.case_id))].sort();
  const models = [...new Set(scores.map((item) => item.model))].sort();
  const probes = [...new Set(scores.map((item) => item.probe))].sort();
  const seen = new Set();
  for (const score of scores) {
    const key = `${score.case_id}\u0000${score.model}\u0000${score.probe}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate score for ${score.case_id}/${score.model}/${score.probe}`);
    }
    seen.add(key);
  }

  const modelStats = models.map((model) => {
    const rows = scores.filter((item) => item.model === model);
    const byProbeCase = {};
    const suggested_roles = [];
    const unsuitable_roles = [];
    const failure_modes = [];
    for (const row of rows) {
      if (!byProbeCase[row.probe]) {
        byProbeCase[row.probe] = {};
      }
      byProbeCase[row.probe][row.case_id] = row.total;
      pushUnique(suggested_roles, row.suggested_roles);
      pushUnique(unsuitable_roles, row.unsuitable_roles);
      pushUnique(failure_modes, row.failure_modes);
    }
    return { model, byProbeCase, suggested_roles, unsuitable_roles, failure_modes };
  });

  const roleRecommendations = ["planner", "architecture", "execution", "risk", "synthesis"]
    .map((probe) => roleRecommendation(probe, modelStats, config))
    .filter(Boolean);

  const results = {
    run,
    generated_at: new Date().toISOString(),
    cases,
    models,
    probes,
    primary_cases: config.primary_cases,
    scores,
    model_probe_averages: modelStats.map((item) => ({
      model: item.model,
      averages: Object.fromEntries(PROBE_COLUMNS.map((probe) => [
        probe,
        average(config.primary_cases
          .map((caseId) => item.byProbeCase[probe]?.[caseId])
          .filter((value) => value !== undefined))
      ])),
      coverage: Object.fromEntries(PROBE_COLUMNS.map((probe) => [
        probe,
        config.primary_cases.filter((caseId) => item.byProbeCase[probe]?.[caseId] !== undefined)
      ])),
      suggested_roles: item.suggested_roles,
      unsuitable_roles: item.unsuitable_roles,
      failure_modes: item.failure_modes
    })),
    role_recommendations: roleRecommendations
  };

  writeGenerated(path.join(ROOT, "outputs", "calibration-results.json"), JSON.stringify(results, null, 2) + "\n");
  writeGenerated(path.join(ROOT, "outputs", "calibration-summary.md"), renderSummary(results));
  writeGenerated(path.join(ROOT, "outputs", "model-role-map.md"), renderRoleMap(results));

  console.log(`Scores read: ${scores.length}`);
  console.log("Generated outputs/calibration-results.json");
  console.log("Generated outputs/calibration-summary.md");
  console.log("Generated outputs/model-role-map.md");
}

function renderSummary(results) {
  const lines = [];
  lines.push("# Calibration Summary", "");
  lines.push("## Run Info", "");
  lines.push(`- Run ID: ${results.run}`);
  lines.push(`- Cases: ${results.cases.length ? results.cases.join(", ") : "None"}`);
  lines.push(`- Models: ${results.models.length ? results.models.join(", ") : "None"}`);
  lines.push(`- Probes: ${results.probes.length ? results.probes.join(", ") : "None"}`, "");
  lines.push(`- Required comparable cases: ${results.primary_cases.join(", ")}`, "");
  lines.push("## Overall Observations", "");
  lines.push(results.scores.length ? "- Fill this section after reviewing the aggregate scores." : "- No score files were found for this run.");
  lines.push("", "## Model Comparison", "");
  lines.push("| Model | Planner | Risk | Architecture | Execution | Rebuttal | Synthesis | Notes |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---|");
  for (const item of results.model_probe_averages) {
    const count = results.primary_cases.length;
    lines.push(`| ${item.model} | ${formatProbeCell(item, "planner", count)} | ${formatProbeCell(item, "risk", count)} | ${formatProbeCell(item, "architecture", count)} | ${formatProbeCell(item, "execution", count)} | ${formatProbeCell(item, "rebuttal", count)} | ${formatProbeCell(item, "synthesis", count)} | ${item.failure_modes.join("; ")} |`);
  }
  if (!results.model_probe_averages.length) {
    lines.push("| - | - | - | - | - | - | - | No scores yet |");
  }
  lines.push("", "## Key Findings", "");
  lines.push("- TBD");
  lines.push("", "## Common Failure Modes", "");
  const modes = [...new Set(results.model_probe_averages.flatMap((item) => item.failure_modes))];
  if (modes.length) {
    modes.forEach((mode) => lines.push(`- ${mode}`));
  } else {
    lines.push("- TBD");
  }
  lines.push("", "## Recommended Next Step", "");
  lines.push("- Continue filling score files until each role has enough evidence for a stable assignment.");
  lines.push("");
  return lines.join("\n");
}

function renderRoleSection(title, rec) {
  const lines = [];
  lines.push(`### ${title}`, "");
  if (!rec || rec.status !== "candidate") {
    lines.push("Recommended model:");
    lines.push("- 数据不足，暂不建议固定该角色。", "");
    lines.push("Why:");
    if (rec) {
      lines.push(`- Comparable models with complete ${rec.required_cases.length}-case coverage: ${rec.comparable_models} / required ${rec.minimum_comparable_models}.`);
      if (rec.comparable_models >= rec.minimum_comparable_models && rec.top_score < rec.minimum_average_score) {
        lines.push(`- Highest comparable average is ${formatScore(rec.top_score)} / 25; required ${formatScore(rec.minimum_average_score)}.`);
      }
      lines.push("");
    } else {
      lines.push("- Current calibration data is not strong enough for a stable assignment.", "");
    }
    lines.push("Backup:");
    lines.push("- TBD", "");
    lines.push("Avoid:");
    lines.push("- TBD", "");
    lines.push("Failure modes to watch:");
    lines.push("- TBD", "");
    lines.push("---", "");
    return lines;
  }
  lines.push("Recommended model:");
  lines.push(`- ${rec.recommended}`, "");
  lines.push("Why:");
  lines.push(`- Average ${rec.probe} score across the same ${rec.required_cases.length} required cases: ${formatScore(rec.recommended_score)} / 25.`);
  lines.push(`- Compared against ${rec.comparable_models} models with complete matching coverage.`, "");
  lines.push("Backup:");
  lines.push(`- ${rec.backup || "TBD"}`, "");
  lines.push("Avoid:");
  lines.push(rec.avoid.length ? rec.avoid.map((item) => `- ${item}`).join("\n") : "- TBD");
  lines.push("", "Failure modes to watch:");
  lines.push(rec.failure_modes.length ? rec.failure_modes.map((item) => `- ${item}`).join("\n") : "- TBD");
  lines.push("", "---", "");
  return lines;
}

function renderRoleMap(results) {
  const byRole = Object.fromEntries(results.role_recommendations.map((rec) => [rec.role, rec]));
  const lines = [];
  lines.push("# Model Role Map", "");
  lines.push("## Default Assignment", "");
  lines.push(...renderRoleSection("A Planner", byRole["A Planner"]));
  lines.push(...renderRoleSection("B Architecture Reviewer", byRole["B Architecture Reviewer"]));
  lines.push(...renderRoleSection("C Execution Reviewer", byRole["C Execution Reviewer"]));
  lines.push(...renderRoleSection("D Risk Reviewer", byRole["D Risk Reviewer"]));
  lines.push(...renderRoleSection("S Synthesizer", byRole["S Synthesizer"]));
  lines.push("## Notes", "");
  lines.push("- This is not a global model ranking.");
  lines.push("- This mapping only applies to the user's current planning/review task domain.");
  lines.push("- Re-run calibration when task domain changes significantly.");
  lines.push("- Rebuttal is treated as a cross-role critical-reasoning signal, not a standalone assignment.");
  lines.push("");
  return lines.join("\n");
}

if (require.main === module) {
  main();
}

module.exports = {
  roleRecommendation
};
