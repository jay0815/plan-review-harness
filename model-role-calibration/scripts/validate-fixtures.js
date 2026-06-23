#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  PROBES,
  loadCaseInput,
  parseJsonFile,
  loadConfig,
  schemaForProbe,
  slug
} = require("./lib");
const { validateJsonText } = require("./json-validator-mcp");

const SYNTHESIS_SOURCE_BY_PROBE = {
  risk: "Risk Reviewer",
  architecture: "Architecture Reviewer",
  execution: "Execution Reviewer",
  rebuttal: "Rebuttal Reviewer"
};

function listDirectories(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function jsonCodeBlocks(markdown, caseId) {
  const blocks = [];
  const pattern = /```json\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch (error) {
      throw new Error(`Invalid JSON block in ${caseId} synthesis input: ${error.message}`);
    }
  }
  return blocks;
}

function assertSchema(value, schemaFile, label) {
  const validation = validateJsonText(JSON.stringify(value), parseJsonFile(schemaFile));
  if (!validation.valid) {
    const details = (validation.errors || [])
      .slice(0, 5)
      .map((item) => `${item.path}: ${item.message}`)
      .join("; ");
    throw new Error(`${label} does not match schema: ${details || validation.stage}`);
  }
}

function validateSynthesisFixture(caseId, input) {
  const blocks = jsonCodeBlocks(input, caseId);
  const reviewerOutputs = blocks.filter((item) => SYNTHESIS_SOURCE_BY_PROBE[item?.probe]);
  const factCheck = blocks.find((item) => item?.probe === "fact_check");
  if (!reviewerOutputs.length) {
    throw new Error(`Missing Reviewer JSON blocks in ${caseId} synthesis input`);
  }
  if (!factCheck) {
    throw new Error(`Missing Fact Check JSON block in ${caseId} synthesis input`);
  }

  for (const output of reviewerOutputs) {
    assertSchema(output, schemaForProbe(output.probe), `${caseId}/${output.probe}`);
  }
  assertSchema(
    factCheck,
    path.join(ROOT, "schemas", "fact-check-output.schema.json"),
    `${caseId}/fact_check`
  );

  const expectedIssues = reviewerOutputs.flatMap((output) => {
    const source = SYNTHESIS_SOURCE_BY_PROBE[output.probe];
    return (output.issues || []).map((issue, index) => ({
      issue_id: `${slug(source)}-${String(index + 1).padStart(3, "0")}`,
      source,
      issue_title: issue.title
    }));
  });
  const checkedIssues = factCheck.checked_issues || [];
  if (checkedIssues.length !== expectedIssues.length) {
    throw new Error(
      `${caseId} Fact Check covers ${checkedIssues.length} issue(s), expected ${expectedIssues.length}`
    );
  }
  const checkedById = new Map(checkedIssues.map((item) => [item.issue_id, item]));
  for (const expected of expectedIssues) {
    const checked = checkedById.get(expected.issue_id);
    if (!checked) {
      throw new Error(`${caseId} Fact Check missing issue_id ${expected.issue_id}`);
    }
    if (checked.source !== expected.source || checked.issue_title !== expected.issue_title) {
      throw new Error(
        `${caseId} Fact Check identity mismatch for ${expected.issue_id}`
      );
    }
  }

  for (const source of new Set(expectedIssues.map((item) => item.source))) {
    const sourceIssues = checkedIssues.filter((item) => item.source === source);
    const summary = (factCheck.source_summaries || []).find((item) => item.source === source);
    if (!summary) {
      throw new Error(`${caseId} Fact Check missing source summary for ${source}`);
    }
    const statusCounts = Object.fromEntries([
      "verified",
      "partially_verified",
      "unsupported",
      "contradicted",
      "unverifiable"
    ].map((status) => [
      status,
      sourceIssues.filter((item) => item.status === status).length
    ]));
    if (
      summary.total_issues !== sourceIssues.length ||
      Object.entries(statusCounts).some(([status, count]) => summary[status] !== count)
    ) {
      throw new Error(`${caseId} Fact Check source summary mismatch for ${source}`);
    }
  }
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
      if (probe === "synthesis") {
        validateSynthesisFixture(caseId, input);
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
