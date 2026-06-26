#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_FILE = path.join(ROOT, "calibration.config.json");
const PROBES = ["planner", "risk", "architecture", "execution", "rebuttal", "synthesis"];
const REVIEW_PROBES = new Set(["risk", "architecture", "execution", "rebuttal"]);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function requireArg(args, name) {
  if (!args[name] || args[name] === true) {
    throw new Error(`Missing required argument: --${name}`);
  }
  return String(args[name]);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function writeFileNew(file, content) {
  if (fs.existsSync(file)) {
    throw new Error(`Refusing to overwrite existing file: ${file}`);
  }
  ensureDir(path.dirname(file));
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  );
  fs.writeFileSync(tempFile, content, { flag: "wx" });
  try {
    fs.linkSync(tempFile, file);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing file: ${file}`);
    }
    throw error;
  } finally {
    fs.unlinkSync(tempFile);
  }
}

function writeGenerated(file, content) {
  ensureDir(path.dirname(file));
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  );
  fs.writeFileSync(tempFile, content, { flag: "wx" });
  try {
    fs.renameSync(tempFile, file);
  } catch (error) {
    fs.unlinkSync(tempFile);
    throw error;
  }
}

function assertSafeCaseId(caseId) {
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(caseId)) {
    throw new Error(`Invalid case id "${caseId}". Expected group/case-id.`);
  }
}

function assertProbe(probe) {
  if (!PROBES.includes(probe)) {
    throw new Error(`Invalid probe "${probe}". Expected one of: ${PROBES.join(", ")}`);
  }
}

function slug(value) {
  return String(value).trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

function optionalSlugArg(args, name) {
  const value = args[name];
  if (!value || value === true) {
    return null;
  }
  const normalized = slug(value).toLowerCase();
  if (!normalized) {
    throw new Error(`Invalid --${name}: must contain at least one alphanumeric, underscore, or hyphen`);
  }
  return normalized;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function loadLegacyCaseInput(caseDir) {
  const inputFile = path.join(caseDir, "input.md");
  const contextFile = path.join(caseDir, "context.md");
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Missing case input: ${inputFile}`);
  }
  const input = readText(inputFile).trim();
  const context = fs.existsSync(contextFile) ? readText(contextFile).trim() : "";
  return context ? `${context}\n\n---\n\n${input}\n` : `${input}\n`;
}

function loadCaseInput(caseId, probe) {
  assertSafeCaseId(caseId);
  assertProbe(probe);
  const caseDir = path.join(ROOT, "cases", caseId);
  const inputsDir = path.join(caseDir, "inputs");
  let inputName;
  if (probe === "planner") {
    inputName = "planner.md";
  } else if (probe === "synthesis") {
    inputName = "synthesis.md";
  } else if (REVIEW_PROBES.has(probe)) {
    inputName = "review.md";
  }

  const probeInput = inputName ? path.join(inputsDir, inputName) : null;
  if (probeInput && fs.existsSync(probeInput)) {
    return `${readText(probeInput).trim()}\n`;
  }
  if (fs.existsSync(inputsDir)) {
    throw new Error(`Missing ${probe} input: ${probeInput}`);
  }

  return loadLegacyCaseInput(caseDir);
}

function parseJsonFile(file) {
  return JSON.parse(readText(file));
}

function loadConfig() {
  return parseJsonFile(CONFIG_FILE);
}

function schemaForProbe(probe) {
  assertProbe(probe);
  if (probe === "planner") {
    return path.join(ROOT, "schemas", "planner-output.schema.json");
  }
  if (probe === "risk") {
    return path.join(ROOT, "schemas", "risk-output.schema.json");
  }
  if (probe === "architecture") {
    return path.join(ROOT, "schemas", "architecture-output.schema.json");
  }
  if (probe === "execution") {
    return path.join(ROOT, "schemas", "execution-output.schema.json");
  }
  if (probe === "rebuttal") {
    return path.join(ROOT, "schemas", "rebuttal-output.schema.json");
  }
  if (probe === "synthesis") {
    return path.join(ROOT, "schemas", "synthesis-output.schema.json");
  }
  return path.join(ROOT, "schemas", "model-output.schema.json");
}

function agentOutputPaths(run, caseId, model, probe) {
  assertSafeCaseId(caseId);
  assertProbe(probe);
  const baseName = `${slug(model)}-${probe}`;
  const outputDir = path.join(ROOT, "runs", run, caseId, "agent-outputs");
  return {
    outputDir,
    baseName,
    resultFile: path.join(outputDir, `${baseName}.json`),
    rawFile: path.join(outputDir, `${baseName}.cli.json`),
    metadataFile: path.join(outputDir, `${baseName}.meta.json`),
    attemptsDir: path.join(outputDir, "attempts", baseName)
  };
}

function sumScore(score) {
  const values = [
    score.hit_rate,
    score.contract_closure,
    score.actionability,
    score.evidence_discipline,
    score.false_positive_cost
  ];
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function walk(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) {
    return results;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, predicate, results);
    } else if (!predicate || predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

module.exports = {
  ROOT,
  PROBES,
  parseArgs,
  requireArg,
  ensureDir,
  readText,
  writeFileNew,
  writeGenerated,
  assertSafeCaseId,
  assertProbe,
  slug,
  optionalSlugArg,
  timestamp,
  loadCaseInput,
  parseJsonFile,
  loadConfig,
  schemaForProbe,
  agentOutputPaths,
  sumScore,
  walk
};
