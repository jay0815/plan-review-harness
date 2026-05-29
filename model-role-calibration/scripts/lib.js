#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PROBES = ["risk", "architecture", "execution", "rebuttal", "synthesis"];

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
  fs.writeFileSync(file, content);
}

function writeGenerated(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content);
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

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function loadCaseInput(caseId) {
  assertSafeCaseId(caseId);
  const caseDir = path.join(ROOT, "cases", caseId);
  const inputFile = path.join(caseDir, "input.md");
  const contextFile = path.join(caseDir, "context.md");
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Missing case input: ${inputFile}`);
  }
  const input = readText(inputFile).trim();
  const context = fs.existsSync(contextFile) ? readText(contextFile).trim() : "";
  return context ? `${context}\n\n---\n\n${input}\n` : `${input}\n`;
}

function parseJsonFile(file) {
  return JSON.parse(readText(file));
}

function sumScore(score) {
  const values = [
    score.hit_rate,
    score.novel_value,
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
  timestamp,
  loadCaseInput,
  parseJsonFile,
  sumScore,
  walk
};
