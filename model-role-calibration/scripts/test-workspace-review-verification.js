#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveRunDir, verifyRun } = require("./verify-workspace-review-run");
const { doctorWorkspaceReviewRun } = require("./doctor-workspace-review-run");
const {
  createRunManifest,
  markManifestRunning,
  markManifestFinished,
  recordResolvedExecution,
  hashFileIfExists
} = require("./workspace-review-manifest");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function writeJsonl(file, events) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
}

function writeRunManifest(runDir, runId, status, roles = []) {
  writeJson(path.join(runDir, "run-manifest.json"), {
    version: 1,
    run_id: runId,
    status,
    created_at: "2026-06-16T00:00:00.000Z",
    updated_at: "2026-06-16T00:00:00.000Z",
    workspace: {
      project_root: "/tmp/project",
      git_available: false,
      git_head: null,
      dirty: null,
      dirty_files: [],
      dirty_patch_hash: null
    },
    inputs: {
      plan: {
        path: null,
        hash: "sha256:test-plan"
      },
      context_hash: null,
      review_plan: {
        path: "review-plan.md",
        hash: "sha256:test-review-plan"
      },
      review_plan_refs_hash: "sha256:test-review-plan-refs"
    },
    declared_runtime: {
      route_profile: {
        path: "model-role-calibration/default-role-routes.json",
        hash: "sha256:test-routes",
        effective_roles: {}
      },
      prompt_set_hash: "sha256:test-prompts",
      schema_set_hash: "sha256:test-schemas"
    },
    resolved_execution: Object.fromEntries(roles.map((role) => [
      role,
      {
        adapter: "claude-code",
        provider: "claude-code-wrapper",
        model: "test-model",
        attempts: 1,
        latest_status: "completed",
        attempt_history: [{
          attempt_index: 1,
          status: "completed",
          metadata_file: `roles/${role}/metadata.json`
        }]
      }
    ])),
    artifacts: {
      request: "request.json",
      state: "state.json"
    }
  });
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

const EXECUTION_BOUNDARIES = [
  "main_path",
  "step_order",
  "dependencies",
  "inputs",
  "outputs",
  "acceptance",
  "tests",
  "failure_semantics",
  "rollback_or_recovery",
  "compatibility_or_release",
  "implementation_discretion",
  "plan_bloat"
];

function executionCoverage() {
  return EXECUTION_BOUNDARIES.map((boundary) => ({
    boundary,
    status: "covered",
    evidence_basis: "plan_text",
    notes: `测试 fixture 覆盖 ${boundary} 边界。`
  }));
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
  const defaultOutput = {
    probe: role,
    issues: [],
    missing_questions: [],
    false_positive_risks: []
  };
  if (role === "execution") {
    defaultOutput.coverage_declaration = {
      reviewed_boundaries: executionCoverage(),
      unverified_assumptions: [],
      not_reviewed: []
    };
  }
  writeJson(path.join(roleDir, "output.json"), options.output || defaultOutput);
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

    const manifestRunDir = path.join(tempDir, "workspace-review-manifest");
    fs.mkdirSync(manifestRunDir, { recursive: true });
    const manifestConfig = {
      config_file: null,
      roles: {
        risk: "kimi",
        architecture: "kimi",
        execution: "kimi",
        rebuttal: "glm",
        fact_check: "glm",
        synthesis: "glm",
        planner: "kimi"
      },
      execution: {
        max_concurrency: 4,
        timeout_ms: 900000,
        max_buffer_bytes: 1024,
        max_turns: 24,
        compact_plan: true,
        isolate_reviewers: true,
        read_scope_max_files: 80
      },
      claude_bin: "claude",
      claude_version: "Claude Code test"
    };
    const manifestRequest = {
      run_id: "workspace-review-manifest",
      created_at: "2026-06-16T00:00:00.000Z",
      project_root: tempDir,
      plan: "# Manifest Plan\n",
      plan_file: null,
      context: "",
      roles: ["risk"]
    };
    const createdManifest = createRunManifest(manifestConfig, manifestRequest, manifestRunDir);
    assert.equal(createdManifest.status, "created");
    assert.equal(createdManifest.inputs.plan.hash.startsWith("sha256:"), true);
    assert.equal(createdManifest.declared_runtime.route_profile.effective_roles.risk, "kimi");
    manifestRequest.review_plan = "# Manifest Review Plan\n";
    manifestRequest.review_plan_refs = {
      existing_code_refs: [{ path: "src/index.ts" }],
      existing_code_ref_dirs: [],
      skipped_refs: []
    };
    fs.writeFileSync(path.join(manifestRunDir, "review-plan.md"), manifestRequest.review_plan, "utf8");
    markManifestRunning(manifestRunDir, manifestRequest);
    const manifestRoleDir = path.join(manifestRunDir, "roles", "risk");
    fs.mkdirSync(manifestRoleDir, { recursive: true });
    fs.writeFileSync(path.join(manifestRoleDir, "prompt.md"), "prompt\n", "utf8");
    writeJson(path.join(manifestRoleDir, "read-scope.json"), {
      files: ["src/index.ts"]
    });
    writeJson(path.join(manifestRoleDir, "output.json"), {
      probe: "risk",
      issues: [],
      missing_questions: [],
      false_positive_risks: []
    });
    recordResolvedExecution(manifestRunDir, {
      role: "risk",
      model: "kimi",
      status: "completed",
      started_at: "2026-06-16T00:00:01.000Z",
      finished_at: "2026-06-16T00:00:02.000Z",
      timed_out: false,
      exit_code: 0,
      signal: null,
      error: null,
      prompt_file: "roles/risk/prompt.md",
      settings_file: "/tmp/kimi.json",
      allowed_tools: ["Read", "Glob", "Grep"],
      schema_file: "schemas/risk-output.schema.json",
      read_boundary: {
        read_scope_file: "roles/risk/read-scope.json"
      }
    });
    markManifestFinished(manifestRunDir, "completed");
    const completedManifest = JSON.parse(fs.readFileSync(
      path.join(manifestRunDir, "run-manifest.json"),
      "utf8"
    ));
    assert.equal(completedManifest.status, "completed");
    assert.equal(
      completedManifest.inputs.review_plan.hash,
      hashFileIfExists(path.join(manifestRunDir, "review-plan.md"))
    );
    assert.equal(completedManifest.inputs.review_plan_refs_hash.startsWith("sha256:"), true);
    assert.equal(completedManifest.resolved_execution.risk.attempts, 1);
    assert.equal(completedManifest.resolved_execution.risk.latest_status, "completed");
    assert.equal(completedManifest.resolved_execution.risk.prompt_hash.startsWith("sha256:"), true);
    assert.equal(completedManifest.resolved_execution.risk.schema_hash.startsWith("sha256:"), true);
    assert.equal(completedManifest.resolved_execution.risk.output_hash.startsWith("sha256:"), true);

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
    writeRunManifest(runningRunDir, "workspace-review-running", "running");
    const running = verifyRun(runningRunDir);
    assert.equal(running.ready, false);
    assert.equal(running.valid, null);
    assert.equal(running.counts.fail, 0);
    assert(running.counts.pending >= 1);
    assert(!running.checks.some((item) => item.id === "fact_check.present"));
    assert(!running.checks.some((item) => item.id === "synthesis.present"));
    const runningDoctor = doctorWorkspaceReviewRun(runningRunDir);
    assert.equal(runningDoctor.health, "pending");
    assert(runningDoctor.next_actions.some((item) => item.kind === "wait_for_completion"));

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
    writeRunManifest(failedRunDir, "workspace-review-failed", "failed");
    const failedInfra = verifyRun(failedRunDir);
    assert.equal(failedInfra.ready, true);
    assert.equal(failedInfra.valid, false);
    assert.equal(failedInfra.infra_errors[0].role, "rebuttal");
    assert.equal(failedInfra.infra_errors[0].type, "invalid_output");
    const failedDoctor = doctorWorkspaceReviewRun(failedRunDir);
    assert.equal(failedDoctor.health, "fail");
    assert(failedDoctor.next_actions.some((item) => (
      item.kind === "retry_stage" &&
      item.stage === "reviewers" &&
      item.command.includes("retry-workspace-review-stage.js")
    )));

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
    writeRunManifest(runDir, "workspace-review-test", "completed", [
      "risk",
      "architecture",
      "execution",
      "rebuttal",
      "fact_check",
      "synthesis"
    ]);
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
    writeJson(path.join(runDir, "plan-authoring-lint.json"), {
      valid: true,
      errors: [],
      warnings: ["fixture warning"],
      metrics: {
        existing_code_ref_count: 2,
        structured_existing_code_ref_count: 1,
        inline_existing_code_ref_count: 1
      }
    });
    writeJson(path.join(runDir, "review-plan-refs.json"), {
      version: 1,
      format_status: {
        refs_scoped_to_existing_code_refs_section: true
      },
      existing_code_refs: [{
        path: "src/index.ts",
        line_ref: null,
        original_ref: "src/index.ts"
      }],
      existing_code_ref_dirs: [{
        path: "src",
        line_ref: null,
        original_ref: "src"
      }],
      proposed_code_artifacts: [],
      blocked_refs: [],
      skipped_refs: ["missing.ts"]
    });

    const result = verifyRun(runDir);
    assert.equal(result.valid, true);
    assert.equal(result.project_root, "/tmp/project");
    assert.equal(result.logs.execution_log, path.join(runDir, "execution.log"));
    assert.equal(result.counts.fail, 0);
    assert(result.counts.warn >= 1);
    assert(result.checks.some((item) => item.id === "fact_check.strictness_signal" && item.status === "warn"));
    const doctor = doctorWorkspaceReviewRun(runDir);
    assert.equal(doctor.health, "warn");
    assert.equal(doctor.action_level, "P2");
    assert.equal(doctor.plan_outcome.status, "plan_ready");
    assert.equal(doctor.plan_authoring_lint.existing_code_ref_count, 2);
    assert.equal(doctor.review_plan_refs.existing_file_ref_count, 1);
    assert.equal(doctor.review_plan_refs.existing_dir_ref_count, 1);
    assert.equal(doctor.review_plan_refs.skipped_ref_count, 1);
    assert.equal(doctor.fact_check.strictness_signal, "all_verified");
    assert.equal(doctor.synthesis.revision_instruction_count, 0);
    assert(doctor.next_actions.some((item) => item.kind === "record_regression_sample"));

    writeJson(path.join(runDir, "report.json"), {
      run_id: "workspace-review-test",
      outcome: {
        status: "needs_revision",
        message: "Plan 结构检查存在错误；必须先修订计划再执行。"
      },
      infra_errors: [],
      fact_check: {
        summary: {
          total_checked: 1
        }
      }
    });
    writeJson(path.join(runDir, "plan-authoring-lint.json"), {
      valid: false,
      errors: ["missing section"],
      warnings: [],
      metrics: {
        existing_code_ref_count: 2,
        structured_existing_code_ref_count: 1,
        inline_existing_code_ref_count: 1
      }
    });
    const needsRevisionDoctor = doctorWorkspaceReviewRun(runDir);
    assert.equal(needsRevisionDoctor.health, "warn");
    assert.equal(needsRevisionDoctor.action_level, "P0");
    assert.equal(needsRevisionDoctor.plan_outcome.status, "needs_revision");
    assert(needsRevisionDoctor.next_actions.some((item) => item.kind === "revise_plan_authoring_errors"));
    writeJson(path.join(runDir, "plan-authoring-lint.json"), {
      valid: true,
      errors: [],
      warnings: ["fixture warning"],
      metrics: {
        existing_code_ref_count: 2,
        structured_existing_code_ref_count: 1,
        inline_existing_code_ref_count: 1
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
