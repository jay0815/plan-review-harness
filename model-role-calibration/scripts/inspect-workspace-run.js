#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs, requireArg } = require("./lib");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseJsonLines(file) {
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return {
          type: "parse_error",
          line: index + 1,
          error: error.message
        };
      }
    });
}

function usageSummary(events) {
  const usages = events
    .map((event) => event.message?.usage)
    .filter(Boolean);
  if (!usages.length) {
    return null;
  }
  const last = usages[usages.length - 1];
  return {
    first_input_tokens: usages[0].input_tokens ?? usages[0].prompt_tokens ?? null,
    max_input_tokens: Math.max(...usages.map((item) => item.input_tokens ?? item.prompt_tokens ?? 0)),
    last_input_tokens: last.input_tokens ?? last.prompt_tokens ?? null,
    last_output_tokens: last.output_tokens ?? null,
    cache_read_input_tokens: last.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: last.cache_creation_input_tokens ?? null
  };
}

function extractToolUses(events) {
  const calls = [];
  for (const event of events) {
    const content = event.message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (block?.type === "tool_use") {
        calls.push({
          id: block.id || null,
          name: block.name,
          input: block.input || {}
        });
      }
    }
  }
  return calls;
}

function extractToolResults(events) {
  const results = new Map();
  for (const event of events) {
    const content = event.message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (block?.type !== "tool_result" || !block.tool_use_id) {
        continue;
      }
      results.set(block.tool_use_id, {
        is_error: Boolean(block.is_error),
        content: block.content || null
      });
    }
  }
  return results;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isOutOfBoundary(file, exposedRoot) {
  if (!exposedRoot) {
    return false;
  }
  const relative = path.relative(exposedRoot, path.resolve(file));
  return relative.startsWith("..") || path.isAbsolute(relative);
}

function mapReadFile(file, exposedRoot, sourceRoot) {
  if (!exposedRoot || !sourceRoot) {
    return file;
  }
  if (isOutOfBoundary(file, exposedRoot)) {
    return file;
  }
  const relative = path.relative(exposedRoot, path.resolve(file));
  return path.join(sourceRoot, relative);
}

function summarizeRole(roleDir) {
  const role = path.basename(roleDir);
  const metadataFile = path.join(roleDir, "metadata.json");
  const stdoutFile = path.join(roleDir, "stdout.jsonl");
  const outputFile = path.join(roleDir, "output.json");
  const promptFile = path.join(roleDir, "prompt.md");
  const metadata = fs.existsSync(metadataFile) ? readJson(metadataFile) : {};
  const factCheckSummaryFile = path.join(roleDir, "fact-check-summary.json");
  const factCheckSummary = fs.existsSync(factCheckSummaryFile)
    ? readJson(factCheckSummaryFile)
    : null;
  const events = parseJsonLines(stdoutFile);
  const init = events.find((event) => event.type === "system" && event.subtype === "init") || {};
  const toolUses = extractToolUses(events);
  const toolResults = extractToolResults(events);
  const toolCounts = {};
  for (const call of toolUses) {
    toolCounts[call.name] = (toolCounts[call.name] || 0) + 1;
  }
  const readAttempts = toolUses
    .filter((call) => call.name === "Read" && call.input.file_path)
    .map((call) => ({
      id: call.id,
      file: call.input.file_path,
      result: call.id ? toolResults.get(call.id) : null
    }));
  const readAttemptFiles = unique(readAttempts.map((attempt) => attempt.file));
  const successfulReadFiles = unique(readAttempts
    .filter((attempt) => attempt.result?.is_error !== true)
    .map((attempt) => attempt.file));
  const failedReadFiles = unique(readAttempts
    .filter((attempt) => attempt.result?.is_error === true)
    .map((attempt) => attempt.file));
  const readBoundary = metadata.read_boundary || null;
  const exposedRoot = readBoundary?.exposed_root ? path.resolve(readBoundary.exposed_root) : null;
  const sourceRoot = readBoundary?.source_root ? path.resolve(readBoundary.source_root) : null;
  const outOfBoundaryReadFiles = successfulReadFiles.filter((file) => (
    isOutOfBoundary(file, exposedRoot)
  ));
  const failedOutOfBoundaryReadFiles = failedReadFiles.filter((file) => (
    isOutOfBoundary(file, exposedRoot)
  ));
  const mappedReadFiles = successfulReadFiles.map((file) => (
    mapReadFile(file, exposedRoot, sourceRoot)
  ));
  return {
    role,
    model: metadata.model || init.model || null,
    session_id: init.session_id || events.find((event) => event.session_id)?.session_id || null,
    status: metadata.status || null,
    elapsed_ms: metadata.started_at && metadata.finished_at
      ? new Date(metadata.finished_at).getTime() - new Date(metadata.started_at).getTime()
      : null,
    prompt_bytes: fs.existsSync(promptFile) ? fs.statSync(promptFile).size : 0,
    output_bytes: fs.existsSync(outputFile) ? fs.statSync(outputFile).size : 0,
    stdout_bytes: fs.existsSync(stdoutFile) ? fs.statSync(stdoutFile).size : 0,
    event_count: events.length,
    tools: init.tools || [],
    tool_counts: toolCounts,
    read_files: successfulReadFiles,
    read_attempt_files: readAttemptFiles,
    failed_read_files: failedReadFiles,
    mapped_read_files: unique(mappedReadFiles),
    out_of_boundary_read_files: outOfBoundaryReadFiles,
    failed_out_of_boundary_read_files: failedOutOfBoundaryReadFiles,
    read_boundary: readBoundary,
    fact_check_summary: factCheckSummary,
    usage: usageSummary(events)
  };
}

function printText(summary) {
  console.log(`# Workspace Run Inspect: ${summary.run_id}`);
  console.log("");
  console.log(`Run dir: ${summary.run_dir}`);
  console.log(`Roles: ${summary.roles.map((item) => item.role).join(", ")}`);
  console.log("");
  console.log("| Role | Model | Elapsed | Prompt | Output | Stdout | Tool calls | Boundary | Max input tokens |");
  console.log("|---|---|---:|---:|---:|---:|---|---|---:|");
  for (const role of summary.roles) {
    const toolCalls = Object.entries(role.tool_counts)
      .map(([name, count]) => `${name}:${count}`)
      .join(", ") || "-";
    console.log([
      `| ${role.role}`,
      role.model || "-",
      role.elapsed_ms == null ? "-" : `${Math.round(role.elapsed_ms / 1000)}s`,
      role.prompt_bytes,
      role.output_bytes,
      role.stdout_bytes,
      toolCalls,
      role.read_boundary
        ? [
          `${role.read_boundary.mode}:${role.read_boundary.file_count ?? "-"} files`,
          `proposed:${(role.read_boundary.proposed_artifacts || []).length}`,
          `out:${role.out_of_boundary_read_files.length}`
        ].join(", ")
        : "-",
      role.usage?.max_input_tokens ?? "-"
    ].join(" | ") + " |");
  }
  console.log("");
  for (const role of summary.roles) {
    console.log(`## ${role.role} (${role.model || "unknown"})`);
    console.log(`session_id: ${role.session_id || "-"}`);
    console.log(`tools: ${role.tools.join(", ") || "-"}`);
    if (role.read_boundary) {
      console.log(`read_boundary: ${role.read_boundary.mode} (${role.read_boundary.file_count ?? "-"} file(s))`);
      if ((role.read_boundary.proposed_artifacts || []).length) {
        console.log("proposed_artifacts:");
        for (const artifact of role.read_boundary.proposed_artifacts) {
          console.log(`- ${artifact.relative_path}:1-${artifact.line_count || "?"}`);
        }
      }
      if (role.out_of_boundary_read_files.length) {
        console.log("out_of_boundary_read_files:");
        for (const file of role.out_of_boundary_read_files) {
          console.log(`- ${file}`);
        }
      }
      if ((role.failed_out_of_boundary_read_files || []).length) {
        console.log("failed_out_of_boundary_read_files:");
        for (const file of role.failed_out_of_boundary_read_files) {
          console.log(`- ${file}`);
        }
      }
    }
    if (role.fact_check_summary) {
      console.log(`fact_check_strictness: ${role.fact_check_summary.strictness_signal}`);
      console.log(`fact_check_status_counts: ${JSON.stringify(role.fact_check_summary.status_counts)}`);
      console.log(`fact_check_evidence_status_counts: ${JSON.stringify(role.fact_check_summary.evidence_status_counts)}`);
    }
    if (!role.read_files.length) {
      console.log("read_files: none");
    } else {
      console.log("read_files:");
      for (const file of role.read_files) {
        console.log(`- ${file}`);
      }
    }
    console.log("");
  }
}

function inspect(runDir) {
  const absoluteRunDir = path.resolve(runDir);
  const rolesDir = path.join(absoluteRunDir, "roles");
  if (!fs.existsSync(rolesDir)) {
    throw new Error(`Missing roles directory: ${rolesDir}`);
  }
  const roles = fs.readdirSync(rolesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => summarizeRole(path.join(rolesDir, entry.name)))
    .sort((a, b) => a.role.localeCompare(b.role));
  return {
    run_id: path.basename(absoluteRunDir),
    run_dir: absoluteRunDir,
    roles
  };
}

function main() {
  const args = parseArgs(process.argv);
  const summary = inspect(requireArg(args, "run-dir"));
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printText(summary);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  inspect
};
