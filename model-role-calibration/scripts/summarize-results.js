#!/usr/bin/env node

const path = require("path");
const {
  ROOT,
  parseArgs,
  requireArg,
  parseJsonFile,
  sumScore,
  walk,
  writeGenerated
} = require("./lib");

const PROBE_COLUMNS = ["risk", "architecture", "execution", "rebuttal", "synthesis"];
const ROLE_BY_PROBE = {
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

function roleRecommendation(probe, modelStats) {
  const role = ROLE_BY_PROBE[probe];
  if (!role) {
    return null;
  }
  const candidates = modelStats
    .map((item) => ({
      model: item.model,
      avg: average(item.byProbe[probe] || []),
      count: (item.byProbe[probe] || []).length,
      failure_modes: item.failure_modes
    }))
    .filter((item) => item.avg !== null)
    .sort((a, b) => b.avg - a.avg);

  if (!candidates.length) {
    return { role, probe, status: "insufficient_data", recommended: null, backup: null, avoid: [] };
  }

  const recommended = candidates[0];
  const backup = candidates[1] || null;
  const avoid = candidates.filter((item) => item.avg < 5).map((item) => item.model);
  const status = recommended.avg >= 8 && recommended.count >= 1 ? "candidate" : "insufficient_data";

  return {
    role,
    probe,
    status,
    recommended: status === "candidate" ? recommended.model : null,
    recommended_score: recommended.avg,
    backup: backup ? backup.model : null,
    backup_score: backup ? backup.avg : null,
    avoid,
    failure_modes: recommended.failure_modes || []
  };
}

function main() {
  const args = parseArgs(process.argv);
  const run = requireArg(args, "run");
  const runDir = path.join(ROOT, "runs", run);
  const scoreFiles = walk(runDir, (file) => file.endsWith(".score.json"));
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

  const modelStats = models.map((model) => {
    const rows = scores.filter((item) => item.model === model);
    const byProbe = {};
    const suggested_roles = [];
    const unsuitable_roles = [];
    const failure_modes = [];
    for (const row of rows) {
      if (!byProbe[row.probe]) {
        byProbe[row.probe] = [];
      }
      byProbe[row.probe].push(row.total);
      pushUnique(suggested_roles, row.suggested_roles);
      pushUnique(unsuitable_roles, row.unsuitable_roles);
      pushUnique(failure_modes, row.failure_modes);
    }
    return { model, byProbe, suggested_roles, unsuitable_roles, failure_modes };
  });

  const roleRecommendations = ["architecture", "execution", "risk", "synthesis"]
    .map((probe) => roleRecommendation(probe, modelStats))
    .filter(Boolean);

  const results = {
    run,
    generated_at: new Date().toISOString(),
    cases,
    models,
    probes,
    scores,
    model_probe_averages: modelStats.map((item) => ({
      model: item.model,
      averages: Object.fromEntries(PROBE_COLUMNS.map((probe) => [probe, average(item.byProbe[probe] || [])])),
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
  lines.push("## Overall Observations", "");
  lines.push(results.scores.length ? "- Fill this section after reviewing the aggregate scores." : "- No score files were found for this run.");
  lines.push("", "## Model Comparison", "");
  lines.push("| Model | Risk | Architecture | Execution | Rebuttal | Synthesis | Notes |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const item of results.model_probe_averages) {
    lines.push(`| ${item.model} | ${formatScore(item.averages.risk)} | ${formatScore(item.averages.architecture)} | ${formatScore(item.averages.execution)} | ${formatScore(item.averages.rebuttal)} | ${formatScore(item.averages.synthesis)} | ${item.failure_modes.join("; ")} |`);
  }
  if (!results.model_probe_averages.length) {
    lines.push("| - | - | - | - | - | - | No scores yet |");
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
    lines.push("- Current calibration data is not strong enough for a stable assignment.", "");
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
  lines.push(`- Average ${rec.probe} probe score: ${formatScore(rec.recommended_score)} / 10.`, "");
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
  lines.push(...renderRoleSection("A Planner", null));
  lines.push(...renderRoleSection("B Architecture Reviewer", byRole["B Architecture Reviewer"]));
  lines.push(...renderRoleSection("C Execution Reviewer", byRole["C Execution Reviewer"]));
  lines.push(...renderRoleSection("D Risk Reviewer", byRole["D Risk Reviewer"]));
  lines.push(...renderRoleSection("S Synthesizer", byRole["S Synthesizer"]));
  lines.push("## Notes", "");
  lines.push("- This is not a global model ranking.");
  lines.push("- This mapping only applies to the user's current planning/review task domain.");
  lines.push("- Re-run calibration when task domain changes significantly.");
  lines.push("- Planner is not assigned in version 1 because there is no dedicated planner probe.");
  lines.push("");
  return lines.join("\n");
}

main();
