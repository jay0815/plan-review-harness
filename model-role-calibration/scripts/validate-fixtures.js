#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  PROBES,
  loadCaseInput,
  parseJsonFile,
  loadConfig
} = require("./lib");

function listDirectories(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function main() {
  const schemaDir = path.join(ROOT, "schemas");
  const schemaFiles = fs.readdirSync(schemaDir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  for (const file of schemaFiles) {
    parseJsonFile(path.join(schemaDir, file));
  }

  const syntheticDir = path.join(ROOT, "cases", "synthetic");
  const cases = listDirectories(syntheticDir);
  if (!cases.length) {
    throw new Error("No synthetic calibration cases found");
  }

  for (const caseName of cases) {
    const caseId = `synthetic/${caseName}`;
    const rubric = path.join(syntheticDir, caseName, "rubric.md");
    if (!fs.existsSync(rubric)) {
      throw new Error(`Missing case rubric: ${rubric}`);
    }
    for (const probe of PROBES) {
      const input = loadCaseInput(caseId, probe);
      if (!input.trim()) {
        throw new Error(`Empty ${probe} input for ${caseId}`);
      }
    }
  }

  const config = loadConfig();
  for (const caseId of config.primary_cases) {
    if (!fs.existsSync(path.join(ROOT, "cases", caseId))) {
      throw new Error(`Missing configured primary case: ${caseId}`);
    }
  }
  if (new Set(config.models).size !== config.models.length || !config.models.length) {
    throw new Error("Configured models must be a non-empty unique list");
  }
  if (config.role_recommendation.minimum_comparable_models < 2) {
    throw new Error("minimum_comparable_models must be at least 2");
  }
  for (const key of ["timeout_ms", "alias_resolution_timeout_ms", "max_buffer_bytes"]) {
    if (!Number.isInteger(config.agent_execution?.[key]) || config.agent_execution[key] <= 0) {
      throw new Error(`agent_execution.${key} must be a positive integer`);
    }
  }

  console.log(`Validated ${schemaFiles.length} schemas, ${cases.length} synthetic cases, and calibration config`);
}

main();
