#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveRunDir, verifyRun } = require("./verify-workspace-review-run");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function writeJsonl(file, events) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
}

function roleEvents({ tools = ["Read"], reads = [] } = {}) {
  return [
    {
      type: "system",
      subtype: "init",
      session_id: "00000000-0000-4000-8000-000000000000",
      model: "test-model",
      tools
    },
    ...reads.map((file, index) => ({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: `tool-${index}`,
          name: "Read",
          input: {
            file_path: file
          }
        }]
      }
    }))
  ];
}

function createRole(runDir, role, options = {}) {
  const roleDir = path.join(runDir, "roles", role);
  fs.mkdirSync(roleDir, { recursive: true });
  const exposedRoot = path.join(runDir, "scoped", role, "project");
  const sourceRoot = path.join(runDir, "source");
  const reads = options.reads || [path.join(exposedRoot, "package.json")];
  writeJson(path.join(roleDir, "metadata.json"), {
    role,
    model: options.model || "test-model",
    started_at: "2026-06-16T00:00:00.000Z",
    finished_at: "2026-06-16T00:00:10.000Z",
    status: "completed",
    error: null,
    allowed_tools: options.tools || ["Read"],
    read_boundary: options.read_boundary === false
      ? null
      : {
        mode: "scoped_mirror",
        source_root: sourceRoot,
        exposed_root: exposedRoot,
        file_count: 2,
        read_scope_file: `roles/${role}/read-scope.json`
      }
  });
  writeJson(path.join(roleDir, "read-scope.json"), {
    mode: "scoped_mirror",
    source_root: sourceRoot,
    exposed_root: exposedRoot,
    files: ["package.json", "src/index.ts"]
  });
  writeJson(path.join(roleDir, "output.json"), options.output || {
    probe: role,
    issues: [],
    missing_questions: [],
    false_positive_risks: []
  });
  writeJsonl(path.join(roleDir, "stdout.jsonl"), roleEvents({
    tools: options.tools === undefined ? ["Read"] : options.tools,
    reads
  }));
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-review-verify-test-"));
  try {
    const runDir = path.join(tempDir, "workspace-review-test");
    fs.mkdirSync(runDir, { recursive: true });
    assert.equal(resolveRunDir({ "run-dir": runDir }), path.resolve(runDir));
    assert.equal(
      resolveRunDir({ "run-id": "workspace-review-test" }, { workspaceRunsDir: tempDir }),
      path.join(tempDir, "workspace-review-test")
    );
    assert.throws(() => resolveRunDir({ "run-id": "../bad" }), /Invalid run id/);
    assert.throws(() => resolveRunDir({}), /--run-id or --run-dir/);
    assert.throws(() => resolveRunDir({ "run-id": "x", "run-dir": runDir }), /either --run-id or --run-dir/);

    const runningRunDir = path.join(tempDir, "workspace-review-running");
    fs.mkdirSync(runningRunDir, { recursive: true });
    writeJson(path.join(runningRunDir, "state.json"), {
      run_id: "workspace-review-running",
      status: "running",
      project_root: "/tmp/project",
      started_at: "2026-06-16T00:00:00.000Z",
      roles: ["risk", "architecture", "execution", "rebuttal"]
    });
    writeJson(path.join(runningRunDir, "plan-compaction.json"), {
      original_chars: 1000,
      compacted_chars: 700,
      saved_chars: 300,
      code_blocks: 2,
      compacted_blocks: 1,
      preserved_blocks: 1
    });
    const running = verifyRun(runningRunDir);
    assert.equal(running.ready, false);
    assert.equal(running.valid, null);
    assert.equal(running.counts.fail, 0);
    assert(running.counts.pending >= 1);
    assert(!running.checks.some((item) => item.id === "fact_check.present"));
    assert(!running.checks.some((item) => item.id === "synthesis.present"));

    const failedRunDir = path.join(tempDir, "workspace-review-failed");
    fs.mkdirSync(path.join(failedRunDir, "roles"), { recursive: true });
    writeJson(path.join(failedRunDir, "state.json"), {
      run_id: "workspace-review-failed",
      status: "failed",
      project_root: "/tmp/project",
      started_at: "2026-06-16T00:00:00.000Z",
      finished_at: "2026-06-16T00:01:00.000Z",
      error: "Error: rebuttal/glm returned invalid output: bad JSON",
      roles: ["risk", "architecture", "execution", "rebuttal"]
    });
    writeJson(path.join(failedRunDir, "plan-compaction.json"), {
      original_chars: 1000,
      compacted_chars: 700,
      saved_chars: 300,
      code_blocks: 2,
      compacted_blocks: 1,
      preserved_blocks: 1
    });
    const failedInfra = verifyRun(failedRunDir);
    assert.equal(failedInfra.ready, true);
    assert.equal(failedInfra.valid, false);
    assert.equal(failedInfra.infra_errors[0].role, "rebuttal");
    assert.equal(failedInfra.infra_errors[0].type, "invalid_output");

    writeJson(path.join(runDir, "state.json"), {
      run_id: "workspace-review-test",
      status: "completed",
      project_root: "/tmp/project",
      started_at: "2026-06-16T00:00:00.000Z",
      finished_at: "2026-06-16T00:10:00.000Z",
      roles: ["risk", "architecture", "execution", "rebuttal"]
    });
    writeJson(path.join(runDir, "plan-compaction.json"), {
      original_chars: 1000,
      compacted_chars: 600,
      saved_chars: 400,
      code_blocks: 2,
      compacted_blocks: 1,
      preserved_blocks: 1
    });
    fs.writeFileSync(path.join(runDir, "execution.log"), [
      "[2026-06-16T00:00:00.000Z] read_scope_prepared role=\"risk\" files=2",
      "[2026-06-16T00:05:00.000Z] fact_check_summary total_checked=1",
      ""
    ].join("\n"), "utf8");

    for (const role of ["risk", "architecture", "execution", "rebuttal"]) {
      createRole(runDir, role);
    }
    createRole(runDir, "fact_check", {
      model: "deepseek",
      output: {
        probe: "fact_check",
        checked_issues: [{
          issue_id: "risk-001",
          source: "risk",
          issue_title: "示例",
          status: "verified",
          scope_status: "in_scope",
          evidence_status: "quote_matches",
          claim_support: "direct",
          reason: "测试",
          checked_files: ["package.json"]
        }],
        source_summaries: [],
        limits: []
      }
    });
    writeJson(path.join(runDir, "roles", "fact_check", "fact-check-summary.json"), {
      total_checked: 1,
      status_counts: {
        verified: 1
      },
      evidence_status_counts: {
        quote_matches: 1
      },
      claim_support_counts: {
        direct: 1
      },
      verified_ratio: 1,
      challenged_count: 0,
      strictness_signal: "all_verified",
      limits_count: 0
    });
    createRole(runDir, "synthesis", {
      model: "kimi",
      tools: [],
      reads: [],
      read_boundary: false,
      output: {
        probe: "synthesis",
        process_map: {
          title: "test",
          mermaid: "flowchart TD\n  A[A]",
          nodes: [{
            id: "A",
            label: "A",
            stage: "test",
            status: "normal",
            related_issue_titles: [],
            evidence: "test"
          }]
        },
        consensus_issues: [],
        disagreements: [],
        likely_false_positives: [],
        revision_instructions: []
      }
    });
    writeJson(path.join(runDir, "report.json"), {
      run_id: "workspace-review-test",
      outcome: {
        status: "plan_ready",
        message: "test"
      },
      infra_errors: [],
      fact_check: {
        summary: {
          total_checked: 1
        }
      }
    });

    const result = verifyRun(runDir);
    assert.equal(result.valid, true);
    assert.equal(result.project_root, "/tmp/project");
    assert.equal(result.logs.execution_log, path.join(runDir, "execution.log"));
    assert.equal(result.counts.fail, 0);
    assert(result.counts.warn >= 1);
    assert(result.checks.some((item) => item.id === "fact_check.strictness_signal" && item.status === "warn"));

    writeJson(path.join(runDir, "report.json"), {
      run_id: "workspace-review-test",
      infra_errors: [],
      fact_check: {
        summary: {
          total_checked: 1
        }
      }
    });
    const missingOutcome = verifyRun(runDir);
    assert.equal(missingOutcome.valid, false);
    assert(missingOutcome.checks.some((item) => item.id === "report.outcome" && item.status === "fail"));
    writeJson(path.join(runDir, "report.json"), {
      run_id: "workspace-review-test",
      outcome: {
        status: "plan_ready",
        message: "test"
      },
      infra_errors: [],
      fact_check: {
        summary: {
          total_checked: 1
        }
      }
    });

    writeJsonl(path.join(runDir, "roles", "fact_check", "stdout.jsonl"), roleEvents({
      tools: ["Read", "Grep"],
      reads: [path.join(runDir, "scoped", "fact_check", "project", "package.json")]
    }));
    const badFactCheckTools = verifyRun(runDir);
    assert.equal(badFactCheckTools.valid, false);
    assert(badFactCheckTools.checks.some((item) => item.id === "fact_check.read_only" && item.status === "fail"));
    writeJsonl(path.join(runDir, "roles", "fact_check", "stdout.jsonl"), roleEvents({
      tools: ["Read"],
      reads: [path.join(runDir, "scoped", "fact_check", "project", "package.json")]
    }));

    const riskMetadata = JSON.parse(fs.readFileSync(path.join(runDir, "roles", "risk", "metadata.json"), "utf8"));
    riskMetadata.read_boundary.exposed_root = path.join(runDir, "other");
    writeJson(path.join(runDir, "roles", "risk", "metadata.json"), riskMetadata);
    const failed = verifyRun(runDir);
    assert.equal(failed.valid, false);
    assert(failed.checks.some((item) => item.id === "reviewer.risk.no_out_of_boundary_reads" && item.status === "fail"));

    console.log("Workspace review verification tests passed.");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main();
}
