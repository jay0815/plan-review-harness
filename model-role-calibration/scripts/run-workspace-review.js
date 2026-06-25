#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ROOT,
  parseArgs,
  requireArg,
  parseJsonFile,
  writeGenerated,
  slug
} = require("./lib");
const {
  parseAssistantOutput,
  runCommand
} = require("./run-model");
const { validateJsonText } = require("./json-validator-mcp");
const { lintPlan } = require("./plan-authoring-lint");
const {
  REVIEW_ROLES,
  FACT_CHECK_ROLE,
  JSON_VALIDATOR_TOOL,
  MAX_EXECUTOR_RETRIES,
  loadWorkspaceReviewFromArgs,
  validateProjectRoot,
  buildRoleReadScope,
  buildFactCheckReadScope,
  copyScopedWorkspace,
  compactPlanForReview,
  createPlanReferenceManifest,
  buildWorkspacePrompt,
  workspaceSchemaForRole,
  buildClaudeWorkspaceArgs,
  appendExecutionLog,
  updateState,
  withoutAnthropicApiKey
} = require("./workspace-review-lib");

const SOURCE_NAME_BY_ROLE = {
  risk: "Risk Reviewer",
  architecture: "Architecture Reviewer",
  execution: "Execution Reviewer",
  rebuttal: "Rebuttal Reviewer"
};

const SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  blocker: 4
};

const EXECUTION_BOUNDARIES_BY_ISSUE_TYPE = {
  step: ["main_path", "step_order", "rollback_or_recovery"],
  dependency: ["dependencies", "compatibility_or_release"],
  input: ["inputs", "implementation_discretion"],
  output: ["outputs"],
  acceptance: ["acceptance"],
  test: ["tests", "acceptance"],
  ambiguity: ["inputs", "outputs", "failure_semantics"],
  plan_bloat: ["plan_bloat"],
  preference: ["implementation_discretion"]
};

const EXECUTION_REQUIRED_BOUNDARIES = Object.freeze([
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
]);

function writeJson(file, value) {
  writeGenerated(file, JSON.stringify(value, null, 2) + "\n");
}

function reviewerSeverityByIssueId(reviewerOutputs = {}) {
  const severities = new Map();
  for (const [source, reviewerOutput] of Object.entries(reviewerOutputs || {})) {
    const issues = Array.isArray(reviewerOutput?.issues) ? reviewerOutput.issues : [];
    issues.forEach((issue, index) => {
      const issueId = `${slug(source)}-${String(index + 1).padStart(3, "0")}`;
      if (issue?.severity) {
        severities.set(issueId, issue.severity);
      }
    });
  }
  return severities;
}

function validateSynthesisSemantics(output, factCheckOutput, reviewerOutputs = {}) {
  const findings = Array.isArray(output?.source_findings) ? output.source_findings : [];
  const byId = new Map();
  const byIssueId = new Map();
  for (const finding of findings) {
    if (byId.has(finding.id)) {
      throw new Error(`Synthesis semantic validation failed: duplicate source finding id ${finding.id}`);
    }
    byId.set(finding.id, finding);
    if (finding.source_issue_id) {
      if (byIssueId.has(finding.source_issue_id)) {
        throw new Error(
          `Synthesis semantic validation failed: duplicate source_issue_id ${finding.source_issue_id} on findings ${byIssueId.get(finding.source_issue_id).id} and ${finding.id}`
        );
      }
      byIssueId.set(finding.source_issue_id, finding);
    }
  }

  const checkedIssues = Array.isArray(factCheckOutput?.checked_issues)
    ? factCheckOutput.checked_issues
    : [];
  const checkedIds = new Set();
  for (const checked of checkedIssues) {
    if (checkedIds.has(checked.issue_id)) {
      throw new Error(
        `Synthesis semantic validation failed: duplicate fact_check issue_id ${checked.issue_id}`
      );
    }
    checkedIds.add(checked.issue_id);
    const finding = byIssueId.get(checked.issue_id);
    if (!finding) {
      throw new Error(
        `Synthesis semantic validation failed: missing source finding for issue_id ${checked.issue_id}`
      );
    }
    if (finding.source !== checked.source) {
      throw new Error(
        `Synthesis semantic validation failed: ${finding.id} source ${finding.source} != ${checked.source} for issue_id ${checked.issue_id}`
      );
    }
    if (finding.source_title !== checked.issue_title) {
      throw new Error(
        `Synthesis semantic validation failed: ${finding.id} source_title ${finding.source_title} != ${checked.issue_title} for issue_id ${checked.issue_id}`
      );
    }
    if (finding.fact_check_status !== checked.status) {
      throw new Error(
        `Synthesis semantic validation failed: ${finding.id} fact_check_status ` +
        `${finding.fact_check_status} != ${checked.status}`
      );
    }
    if (finding.scope_status !== checked.scope_status) {
      throw new Error(
        `Synthesis semantic validation failed: ${finding.id} scope_status ` +
        `${finding.scope_status} != ${checked.scope_status}`
      );
    }
    const requiredDisposition = checked.scope_status === "out_of_scope"
      ? "out_of_scope"
      : ["unsupported", "contradicted", "unverifiable"].includes(checked.status)
        ? checked.status
        : null;
    if (requiredDisposition && finding.disposition !== requiredDisposition) {
      throw new Error(
        `Synthesis semantic validation failed: ${finding.id} must use disposition ${requiredDisposition}`
      );
    }
    if (
      !requiredDisposition &&
      ["verified", "partially_verified"].includes(checked.status) &&
      !["retained", "merged", "duplicate"].includes(finding.disposition)
    ) {
      throw new Error(
        `Synthesis semantic validation failed: ${finding.id} verified finding cannot use disposition ${finding.disposition}`
      );
    }
  }

  for (const finding of findings) {
    if (finding.source_issue_id && !checkedIds.has(finding.source_issue_id)) {
      throw new Error(
        `Synthesis semantic validation failed: source finding ${finding.id} has no matching fact_check entry for issue_id ${finding.source_issue_id}`
      );
    }
  }

  const referencedIds = (items, field = "source_finding_ids") => (
    (Array.isArray(items) ? items : []).flatMap((item) => item?.[field] || [])
  );
  const activeIds = [
    ...referencedIds(output.consensus_issues),
    ...referencedIds(output.disagreements),
    ...referencedIds(output.revision_instructions)
  ];
  const excludedDispositions = new Set([
    "duplicate",
    "unsupported",
    "contradicted",
    "unverifiable",
    "out_of_scope"
  ]);
  for (const id of [
    ...activeIds,
    ...referencedIds(output.likely_false_positives)
  ]) {
    if (!byId.has(id)) {
      throw new Error(`Synthesis semantic validation failed: unknown source finding id ${id}`);
    }
  }
  for (const id of activeIds) {
    const finding = byId.get(id);
    if (excludedDispositions.has(finding.disposition)) {
      throw new Error(
        `Synthesis semantic validation failed: excluded finding ${id} re-entered active conclusions`
      );
    }
  }
  for (const id of referencedIds(output.likely_false_positives)) {
    const finding = byId.get(id);
    if (!excludedDispositions.has(finding.disposition)) {
      throw new Error(
        `Synthesis semantic validation failed: likely_false_positives cannot reference retained finding ${id}`
      );
    }
  }

  const processNodes = Array.isArray(output?.process_map?.nodes) ? output.process_map.nodes : [];
  const nodeIds = new Set();
  for (const node of processNodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Synthesis semantic validation failed: duplicate process_map node id ${node.id}`);
    }
    nodeIds.add(node.id);
  }
  if (!/^flowchart\s+(TD|LR)\b/.test(String(output?.process_map?.mermaid || "").trim())) {
    throw new Error("Synthesis semantic validation failed: process_map.mermaid must start with flowchart TD or flowchart LR");
  }
  const issueTitles = new Set([
    ...(output.consensus_issues || []).map((item) => item.title),
    ...(output.disagreements || []).map((item) => item.title)
  ]);
  for (const node of processNodes) {
    for (const title of node.related_issue_titles || []) {
      if (!issueTitles.has(title)) {
        throw new Error(
          `Synthesis semantic validation failed: process_map node ${node.id} references unknown issue title ${title}`
        );
      }
    }
  }
  for (const item of [...(output.consensus_issues || []), ...(output.disagreements || [])]) {
    for (const nodeId of item.affected_nodes || []) {
      if (!nodeIds.has(nodeId)) {
        throw new Error(
          `Synthesis semantic validation failed: ${item.title} references unknown process_map node ${nodeId}`
        );
      }
    }
  }

  for (const item of output.consensus_issues || []) {
    const sources = new Set(item.source_finding_ids.map((id) => byId.get(id)?.source).filter(Boolean));
    const mergedFrom = new Set(item.merged_from || []);
    for (const source of sources) {
      if (!mergedFrom.has(source)) {
        throw new Error(
          `Synthesis semantic validation failed: ${item.title} merged_from missing source ${source}`
        );
      }
    }
    for (const source of mergedFrom) {
      if (!sources.has(source)) {
        throw new Error(
          `Synthesis semantic validation failed: ${item.title} merged_from includes source without finding ${source}`
        );
      }
    }
  }

  const reviewerSeverities = reviewerSeverityByIssueId(reviewerOutputs);
  for (const instruction of output.revision_instructions || []) {
    for (const id of instruction.source_finding_ids || []) {
      const finding = byId.get(id);
      if (!["verified", "partially_verified"].includes(finding.fact_check_status)) {
        throw new Error(
          `Synthesis semantic validation failed: revision instruction references non-verified finding ${id}`
        );
      }
      if (finding.fact_check_status !== "partially_verified") {
        continue;
      }
      const reviewerSeverity = reviewerSeverities.get(finding.source_issue_id);
      if (!reviewerSeverity) {
        continue;
      }
      const reviewerRank = SEVERITY_RANK[reviewerSeverity] || 0;
      const linkedConsensus = (output.consensus_issues || [])
        .filter((item) => (item.source_finding_ids || []).includes(id));
      for (const consensus of linkedConsensus) {
        const consensusRank = SEVERITY_RANK[consensus.severity] || 0;
        if (consensusRank > reviewerRank) {
          throw new Error(
            `Synthesis semantic validation failed: partially_verified finding ${id} severity ${consensus.severity} exceeds reviewer severity ${reviewerSeverity}`
          );
        }
      }
    }
  }
  for (const disagreement of output.disagreements || []) {
    const shouldNeedHuman = disagreement.level === "L3_direction_decision";
    if (disagreement.needs_human_decision !== shouldNeedHuman) {
      throw new Error(
        `Synthesis semantic validation failed: ${disagreement.title} needs_human_decision ` +
        `must be ${shouldNeedHuman} for ${disagreement.level}`
      );
    }
  }
}

function validateExecutionSemantics(output) {
  const reviewed = output?.coverage_declaration?.reviewed_boundaries || [];
  const coveredBoundaries = new Set();
  const declaredBoundaries = new Set();
  for (const item of reviewed) {
    if (declaredBoundaries.has(item.boundary)) {
      throw new Error(
        `Execution semantic validation failed: duplicate coverage boundary ${item.boundary}`
      );
    }
    declaredBoundaries.add(item.boundary);
    if (["covered", "partially_covered"].includes(item.status)) {
      coveredBoundaries.add(item.boundary);
    }
  }
  for (const boundary of EXECUTION_REQUIRED_BOUNDARIES) {
    if (!declaredBoundaries.has(boundary)) {
      throw new Error(
        `Execution semantic validation failed: coverage_declaration missing boundary ${boundary}`
      );
    }
  }
  for (const issue of output?.issues || []) {
    if (issue.type === "preference" && issue.blocks_execution) {
      throw new Error(
        `Execution semantic validation failed: preference issue "${issue.title}" cannot block execution`
      );
    }
    const expected = EXECUTION_BOUNDARIES_BY_ISSUE_TYPE[issue.type] || [];
    if (!expected.some((boundary) => coveredBoundaries.has(boundary))) {
      throw new Error(
        `Execution semantic validation failed: issue "${issue.title}" type ${issue.type} ` +
        `is not covered by coverage_declaration`
      );
    }
  }
}

function validateWorkspaceOutput(role, output, context = {}) {
  const validation = validateJsonText(
    JSON.stringify(output),
    parseJsonFile(workspaceSchemaForRole(role))
  );
  if (!validation.valid) {
    const details = (validation.errors || [])
      .slice(0, 5)
      .map((item) => `${item.path}: ${item.message}`)
      .join("; ");
    throw new Error(`Schema validation failed for ${role}: ${details || validation.stage}`);
  }
  if (role === "execution") {
    validateExecutionSemantics(output);
  }
  if (role === "synthesis") {
    validateSynthesisSemantics(output, context.factCheckOutput, context.reviewerOutputs);
  }
}

function materializeProposedArtifacts(runDir, artifacts = []) {
  return artifacts.map((artifact) => {
    const relativePath = artifact.relative_path;
    if (
      typeof relativePath !== "string" ||
      !relativePath.startsWith("proposed-code/") ||
      relativePath.includes("\0") ||
      relativePath.split("/").includes("..")
    ) {
      throw new Error(`Invalid proposed artifact path: ${relativePath}`);
    }
    const sourceFile = path.join(runDir, relativePath);
    writeGenerated(sourceFile, artifact.content || "");
    return {
      block_index: artifact.block_index,
      language: artifact.language,
      relative_path: relativePath,
      source_file: sourceFile,
      line_count: artifact.line_count,
      char_count: artifact.char_count
    };
  });
}

function countBy(items, key) {
  const counts = {};
  for (const item of items || []) {
    const value = item?.[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function summarizeFactCheckOutput(output) {
  const checkedIssues = Array.isArray(output?.checked_issues) ? output.checked_issues : [];
  const statusCounts = countBy(checkedIssues, "status");
  const scopeStatusCounts = countBy(checkedIssues, "scope_status");
  const evidenceStatusCounts = countBy(checkedIssues, "evidence_status");
  const claimSupportCounts = countBy(checkedIssues, "claim_support");
  const total = checkedIssues.length;
  const challenged = [
    "partially_verified",
    "unsupported",
    "contradicted",
    "unverifiable"
  ].reduce((sum, key) => sum + (statusCounts[key] || 0), 0);
  const verified = statusCounts.verified || 0;
  return {
    total_checked: total,
    status_counts: statusCounts,
    scope_status_counts: scopeStatusCounts,
    evidence_status_counts: evidenceStatusCounts,
    claim_support_counts: claimSupportCounts,
    verified_ratio: total ? Number((verified / total).toFixed(4)) : null,
    challenged_count: challenged,
    strictness_signal: total === 0
      ? "no_issues_checked"
      : challenged === 0
        ? "all_verified"
        : "challenged_some_claims",
    limits_count: Array.isArray(output?.limits) ? output.limits.length : 0
  };
}

function summarizeReviewOutcome(
  reviewerResults,
  factCheck,
  synthesis,
  infraErrors,
  authoringLint = null
) {
  const reviewerIssueCount = reviewerResults.reduce((sum, item) => (
    sum + (Array.isArray(item.output?.issues) ? item.output.issues.length : 0)
  ), 0);
  const consensusCount = Array.isArray(synthesis.output?.consensus_issues)
    ? synthesis.output.consensus_issues.length
    : 0;
  const disagreementCount = Array.isArray(synthesis.output?.disagreements)
    ? synthesis.output.disagreements.length
    : 0;
  const revisionCount = Array.isArray(synthesis.output?.revision_instructions)
    ? synthesis.output.revision_instructions.length
    : 0;
  const factChecked = factCheck.summary?.total_checked || 0;
  const challenged = factCheck.summary?.challenged_count || 0;
  const authoringErrorCount = Array.isArray(authoringLint?.errors)
    ? authoringLint.errors.length
    : 0;
  const authoringWarningCount = Array.isArray(authoringLint?.warnings)
    ? authoringLint.warnings.length
    : 0;
  if (authoringErrorCount > 0) {
    return {
      status: "needs_revision",
      message: infraErrors.length
        ? "Plan 结构检查存在错误，且审查存在基础设施错误；必须先修订计划，当前结果也不是全角色完整审查。"
        : "Plan 结构检查存在错误；必须先修订计划再执行。",
      reviewer_issue_count: reviewerIssueCount,
      consensus_issue_count: consensusCount,
      disagreement_count: disagreementCount,
      revision_instruction_count: revisionCount,
      fact_checked_issue_count: factChecked,
      fact_check_challenged_count: challenged,
      authoring_lint_error_count: authoringErrorCount,
      authoring_lint_warning_count: authoringWarningCount,
      infra_error_count: infraErrors.length
    };
  }
  if (infraErrors.length) {
    return {
      status: "review_completed_with_infra_errors",
      message: "审查已完成，但存在 Reviewer/模型输出基础设施错误；不能视为全角色完整审查。",
      reviewer_issue_count: reviewerIssueCount,
      consensus_issue_count: consensusCount,
      disagreement_count: disagreementCount,
      revision_instruction_count: revisionCount,
      fact_checked_issue_count: factChecked,
      fact_check_challenged_count: challenged,
      authoring_lint_error_count: authoringErrorCount,
      authoring_lint_warning_count: authoringWarningCount,
      infra_error_count: infraErrors.length
    };
  }
  if (consensusCount === 0 && disagreementCount === 0 && revisionCount === 0) {
    return {
      status: "plan_ready",
      message: "未发现需要修订的共识问题、分歧或修订指令；当前计划可以进入执行或保持原计划。",
      reviewer_issue_count: reviewerIssueCount,
      consensus_issue_count: consensusCount,
      disagreement_count: disagreementCount,
      revision_instruction_count: revisionCount,
      fact_checked_issue_count: factChecked,
      fact_check_challenged_count: challenged,
      authoring_lint_error_count: authoringErrorCount,
      authoring_lint_warning_count: authoringWarningCount,
      infra_error_count: 0
    };
  }
  return {
    status: "needs_revision",
    message: "审查发现需要处理的问题、分歧或修订指令；应先修订计划再执行。",
    reviewer_issue_count: reviewerIssueCount,
    consensus_issue_count: consensusCount,
    disagreement_count: disagreementCount,
    revision_instruction_count: revisionCount,
    fact_checked_issue_count: factChecked,
    fact_check_challenged_count: challenged,
    authoring_lint_error_count: authoringErrorCount,
    authoring_lint_warning_count: authoringWarningCount,
    infra_error_count: 0
  };
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  return parseJsonFile(file);
}

function completedReviewerResult(runDir, role) {
  const roleDir = path.join(runDir, "roles", role);
  const outputFile = path.join(roleDir, "output.json");
  const metadataFile = path.join(roleDir, "metadata.json");
  if (!fs.existsSync(outputFile) || !fs.existsSync(metadataFile)) {
    return null;
  }
  const metadata = parseJsonFile(metadataFile);
  if (metadata.status !== "completed") {
    return null;
  }
  return {
    role,
    model: metadata.model,
    output: parseJsonFile(outputFile),
    output_file: path.relative(runDir, outputFile)
  };
}

function loadCompletedReviewerResults(runDir, roles, retryStage = "synthesis") {
  return roles.map((role) => {
    const result = completedReviewerResult(runDir, role);
    if (!result) {
      throw new Error(`Cannot retry ${retryStage}: reviewer ${role} is not completed`);
    }
    return result;
  });
}

function loadCompletedFactCheckResult(runDir, retryStage = "synthesis") {
  const roleDir = path.join(runDir, "roles", FACT_CHECK_ROLE);
  const outputFile = path.join(roleDir, "output.json");
  const summaryFile = path.join(roleDir, "fact-check-summary.json");
  const metadataFile = path.join(roleDir, "metadata.json");
  if (!fs.existsSync(outputFile)) {
    throw new Error(`Cannot retry ${retryStage}: missing fact_check output: ${outputFile}`);
  }
  if (!fs.existsSync(summaryFile)) {
    throw new Error(`Cannot retry ${retryStage}: missing fact_check summary: ${summaryFile}`);
  }
  if (!fs.existsSync(metadataFile)) {
    throw new Error(`Cannot retry ${retryStage}: missing fact_check metadata: ${metadataFile}`);
  }
  const metadata = parseJsonFile(metadataFile);
  if (metadata.status !== "completed") {
    throw new Error(`Cannot retry ${retryStage}: fact_check status is ${metadata.status || "unknown"}`);
  }
  return {
    role: FACT_CHECK_ROLE,
    model: metadata.model,
    output: parseJsonFile(outputFile),
    output_file: path.relative(runDir, outputFile),
    summary: parseJsonFile(summaryFile),
    summary_file: path.relative(runDir, summaryFile)
  };
}

function loadRequestForRun(config, runDir) {
  const requestFile = path.join(runDir, "request.json");
  if (!fs.existsSync(requestFile)) {
    throw new Error(`Missing workspace review request: ${requestFile}`);
  }
  const request = parseJsonFile(requestFile);
  request.project_root = validateProjectRoot(request.project_root);
  request.review_plan = fs.existsSync(path.join(runDir, "review-plan.md"))
    ? fs.readFileSync(path.join(runDir, "review-plan.md"), "utf8")
    : request.plan;
  request.plan_compaction = readJsonIfExists(path.join(runDir, "plan-compaction.json"));
  const proposedManifest = readJsonIfExists(path.join(runDir, "proposed-code-manifest.json"));
  request.proposed_artifacts = Array.isArray(proposedManifest?.artifacts)
    ? proposedManifest.artifacts
    : [];
  request.review_plan_refs = readJsonIfExists(path.join(runDir, "review-plan-refs.json")) || null;
  request.authoring_lint = readJsonIfExists(path.join(runDir, "plan-authoring-lint.json"));
  if (!request.authoring_lint) {
    request.authoring_lint = lintPlan({
      plan: request.plan,
      projectRoot: request.project_root
    });
    writeJson(path.join(runDir, "plan-authoring-lint.json"), request.authoring_lint);
  }
  const roles = Array.isArray(request.roles) && request.roles.length
    ? request.roles
    : REVIEW_ROLES;
  for (const role of roles) {
    if (!REVIEW_ROLES.includes(role)) {
      throw new Error(`Invalid workspace review role: ${role}`);
    }
  }
  if (!request.plan_compaction) {
    request.plan_compaction = {
      original_chars: String(request.plan || "").length,
      compacted_chars: String(request.review_plan || request.plan || "").length,
      saved_chars: String(request.plan || "").length - String(request.review_plan || request.plan || "").length,
      code_blocks: 0,
      compacted_blocks: 0,
      preserved_blocks: 0,
      proposed_artifact_count: request.proposed_artifacts.length,
      proposed_artifact_chars: 0
    };
  }
  return { request, roles };
}

function writeWorkspaceReport(runDir, request, reviewerResults, factCheck, synthesis, infraErrors = []) {
  const outcome = summarizeReviewOutcome(
    reviewerResults,
    factCheck,
    synthesis,
    infraErrors,
    request.authoring_lint
  );
  const report = {
    run_id: request.run_id,
    project_root: request.project_root,
    created_at: new Date().toISOString(),
    plan_compaction: request.plan_compaction,
    authoring_lint: request.authoring_lint,
    outcome,
    reviewers: Object.fromEntries(reviewerResults.map((item) => [
      item.role,
      {
        model: item.model,
        output_file: item.output_file,
        output: item.output
      }
    ])),
    infra_errors: infraErrors,
    fact_check: {
      model: factCheck.model,
      output_file: factCheck.output_file,
      summary_file: factCheck.summary_file,
      summary: factCheck.summary,
      output: factCheck.output
    },
    synthesis: {
      model: synthesis.model,
      output_file: synthesis.output_file,
      output: synthesis.output
    }
  };
  writeJson(path.join(runDir, "report.json"), report);
  return report;
}

function extractFinalOutputText(stdout) {
  const lines = String(stdout || "").trim().split(/\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    if (event?.type === "result" && typeof event.result === "string") {
      return event.result;
    }
    const content = event?.message?.content;
    if (Array.isArray(content)) {
      for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
        const block = content[contentIndex];
        if (block?.type === "text" && typeof block.text === "string") {
          return block.text;
        }
      }
    }
  }
  return "";
}

function reviewerInfraError(role, model, error, runDir) {
  return {
    role,
    model,
    type: /invalid output|valid JSON|Probe mismatch/i.test(error.message)
      ? "invalid_output"
      : "agent_failed",
    message: error.message,
    metadata_file: path.relative(runDir, path.join(runDir, "roles", role, "metadata.json")),
    stdout_file: path.relative(runDir, path.join(runDir, "roles", role, "stdout.jsonl")),
    stderr_file: path.relative(runDir, path.join(runDir, "roles", role, "stderr.log"))
  };
}

function prepareReadBoundary(config, request, runDir, role, readScope) {
  if (config.execution.isolate_reviewers === false) {
    return {
      promptRoot: request.project_root,
      claudeRoot: request.project_root,
      boundary: {
        ...readScope,
        mode: "prompt_only",
        source_root: request.project_root,
        exposed_root: request.project_root
      },
      cleanup: () => {}
    };
  }
  const workspaceParent = fs.mkdtempSync(path.join(os.tmpdir(), `plan-review-${role}-scope-`));
  const boundary = {
    ...readScope,
    ...copyScopedWorkspace(request.project_root, readScope, workspaceParent)
  };
  appendExecutionLog(runDir, "read_scope_prepared", {
    role,
    mode: boundary.mode,
    files: boundary.files.length,
    proposed_artifacts: (boundary.proposed_artifacts || []).length,
    blocked_refs: boundary.blocked_refs.length,
    skipped_refs: boundary.skipped_refs.length
  });
  return {
    promptRoot: boundary.exposed_root,
    claudeRoot: boundary.exposed_root,
    boundary,
    cleanup: () => fs.rmSync(workspaceParent, { recursive: true, force: true })
  };
}

async function runRole(config, request, role, runDir) {
  const model = config.roles[role];
  const startedMs = Date.now();
  const roleDir = path.join(runDir, "roles", role);
  fs.mkdirSync(roleDir, { recursive: true });
  const readScope = buildRoleReadScope(
    role,
    request.project_root,
    request.review_plan || request.plan,
    {
      maxFiles: config.execution.read_scope_max_files,
      proposedArtifacts: request.proposed_artifacts || []
    }
  );
  const readBoundary = prepareReadBoundary(config, request, runDir, role, readScope);
  writeJson(path.join(roleDir, "read-scope.json"), readBoundary.boundary);
  const prompt = buildWorkspacePrompt(
    role,
    readBoundary.promptRoot,
    request.review_plan || request.plan,
    request.context || "",
    null,
    null,
    readBoundary.boundary
  );
  const promptFile = path.join(roleDir, "prompt.md");
  const validatorLogFile = path.join(roleDir, "validator.log");
  writeGenerated(promptFile, prompt);
  const args = buildClaudeWorkspaceArgs(config, model, role, readBoundary.claudeRoot, {
    validatorLogFile
  });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-review-role-"));
  const startedAt = new Date().toISOString();
  appendExecutionLog(runDir, "agent_started", {
    role,
    model
  });
  let child;
  try {
    child = await runCommand(config.claude_bin, args, {
      cwd: workDir,
      env: withoutAnthropicApiKey(process.env),
      input: prompt,
      timeoutMs: config.execution.timeout_ms,
      killSignal: "SIGKILL",
      maxBuffer: config.execution.max_buffer_bytes,
      validatorLogFile
    });
  } catch (error) {
    appendExecutionLog(runDir, "agent_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    throw error;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    readBoundary.cleanup();
  }

  writeGenerated(path.join(roleDir, "stdout.jsonl"), child.stdout || "");
  writeGenerated(path.join(roleDir, "stderr.log"), child.stderr || "");
  const metadata = {
    role,
    model,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timed_out: child.error?.code === "ETIMEDOUT",
    exit_code: child.status,
    signal: child.signal,
    error: child.error ? child.error.message : null,
    prompt_file: path.relative(runDir, promptFile),
    settings_file: config.models[model].settings_file,
    allowed_tools: ["Read", "Glob", "Grep"],
    json_validator_enabled: true,
    validator_tool: JSON_VALIDATOR_TOOL,
    validator_log_file: path.relative(runDir, validatorLogFile),
    schema_file: path.relative(ROOT, workspaceSchemaForRole(role)),
    project_root: request.project_root,
    read_boundary: {
      mode: readBoundary.boundary.mode,
      source_root: readBoundary.boundary.source_root,
      exposed_root: readBoundary.boundary.exposed_root,
      file_count: readBoundary.boundary.files.length,
      proposed_artifacts: readBoundary.boundary.proposed_artifacts || [],
      read_scope_file: path.relative(runDir, path.join(roleDir, "read-scope.json"))
    }
  };
  if (child.error || child.status !== 0) {
    appendExecutionLog(runDir, "agent_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed"
    });
    throw new Error(
      `${role}/${model} failed: ${child.error?.message || `exit ${child.status}`}`
    );
  }

  let parsed;
  try {
    parsed = parseAssistantOutput(child.stdout, role);
    validateWorkspaceOutput(role, parsed.output);
  } catch (error) {
    writeGenerated(path.join(roleDir, "output.invalid.txt"), extractFinalOutputText(child.stdout));
    appendExecutionLog(runDir, "agent_invalid_output", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed",
      error: error.message,
      failure_kind: "invalid_output",
      invalid_output_file: path.relative(runDir, path.join(roleDir, "output.invalid.txt"))
    });
    throw new Error(`${role}/${model} returned invalid output: ${error.message}`);
  }
  writeJson(path.join(roleDir, "output.json"), parsed.output);
  writeJson(path.join(roleDir, "metadata.json"), {
    ...metadata,
    status: "completed",
    error: null
  });
  appendExecutionLog(runDir, "agent_completed", {
    role,
    model,
    elapsed_ms: Date.now() - startedMs
  });
  return {
    role,
    model,
    output: parsed.output,
    output_file: path.relative(runDir, path.join(roleDir, "output.json"))
  };
}

async function runFactCheck(config, request, reviewerResults, runDir) {
  const role = FACT_CHECK_ROLE;
  const model = config.roles[role];
  const startedMs = Date.now();
  const roleDir = path.join(runDir, "roles", role);
  fs.mkdirSync(roleDir, { recursive: true });
  const reviewerOutputs = Object.fromEntries(reviewerResults.map((item) => [
    SOURCE_NAME_BY_ROLE[item.role],
    item.output
  ]));
  const readScope = buildFactCheckReadScope(
    request.project_root,
    reviewerOutputs,
    {
      maxFiles: config.execution.read_scope_max_files,
      proposedArtifacts: request.proposed_artifacts || [],
      plan: request.review_plan || request.plan
    }
  );
  const readBoundary = prepareReadBoundary(config, request, runDir, role, readScope);
  writeJson(path.join(roleDir, "read-scope.json"), readBoundary.boundary);
  const prompt = buildWorkspacePrompt(
    role,
    readBoundary.promptRoot,
    request.review_plan || request.plan,
    request.context || "",
    reviewerOutputs,
    null,
    readBoundary.boundary
  );
  const promptFile = path.join(roleDir, "prompt.md");
  const validatorLogFile = path.join(roleDir, "validator.log");
  writeGenerated(promptFile, prompt);
  const args = buildClaudeWorkspaceArgs(config, model, role, readBoundary.claudeRoot, {
    tools: "Read",
    allowProjectRead: true,
    validatorLogFile,
    systemPrompt: [
      "You are a non-interactive evidence verification agent.",
      "Read only files explicitly cited by reviewer evidence.",
      "Never search for new issues, modify files, or execute shell commands.",
      "Return only one raw JSON object that conforms to the provided schema."
    ].join(" ")
  });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-review-fact-check-"));
  const startedAt = new Date().toISOString();
  appendExecutionLog(runDir, "fact_check_started", {
    role,
    model,
    reviewer_count: reviewerResults.length
  });
  let child;
  try {
    child = await runCommand(config.claude_bin, args, {
      cwd: workDir,
      env: withoutAnthropicApiKey(process.env),
      input: prompt,
      timeoutMs: config.execution.timeout_ms,
      killSignal: "SIGKILL",
      maxBuffer: config.execution.max_buffer_bytes,
      validatorLogFile
    });
  } catch (error) {
    appendExecutionLog(runDir, "fact_check_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    throw error;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    readBoundary.cleanup();
  }

  writeGenerated(path.join(roleDir, "stdout.jsonl"), child.stdout || "");
  writeGenerated(path.join(roleDir, "stderr.log"), child.stderr || "");
  const metadata = {
    role,
    model,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timed_out: child.error?.code === "ETIMEDOUT",
    exit_code: child.status,
    signal: child.signal,
    error: child.error ? child.error.message : null,
    prompt_file: path.relative(runDir, promptFile),
    settings_file: config.models[model].settings_file,
    allowed_tools: ["Read"],
    json_validator_enabled: true,
    validator_tool: JSON_VALIDATOR_TOOL,
    validator_log_file: path.relative(runDir, validatorLogFile),
    schema_file: path.relative(ROOT, workspaceSchemaForRole(role)),
    project_root: request.project_root,
    read_boundary: {
      mode: readBoundary.boundary.mode,
      source_root: readBoundary.boundary.source_root,
      exposed_root: readBoundary.boundary.exposed_root,
      file_count: readBoundary.boundary.files.length,
      proposed_artifacts: readBoundary.boundary.proposed_artifacts || [],
      read_scope_file: path.relative(runDir, path.join(roleDir, "read-scope.json"))
    }
  };
  if (child.error || child.status !== 0) {
    appendExecutionLog(runDir, "fact_check_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed"
    });
    throw new Error(
      `${role}/${model} failed: ${child.error?.message || `exit ${child.status}`}`
    );
  }

  let parsed;
  try {
    parsed = parseAssistantOutput(child.stdout, role);
    validateWorkspaceOutput(role, parsed.output);
  } catch (error) {
    appendExecutionLog(runDir, "fact_check_invalid_output", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed",
      error: error.message
    });
    throw new Error(`${role}/${model} returned invalid output: ${error.message}`);
  }
  writeJson(path.join(roleDir, "output.json"), parsed.output);
  const factCheckSummary = summarizeFactCheckOutput(parsed.output);
  writeJson(path.join(roleDir, "fact-check-summary.json"), factCheckSummary);
  writeJson(path.join(roleDir, "metadata.json"), {
    ...metadata,
    fact_check_summary_file: path.relative(runDir, path.join(roleDir, "fact-check-summary.json")),
    status: "completed",
    error: null
  });
  appendExecutionLog(runDir, "fact_check_summary", factCheckSummary);
  appendExecutionLog(runDir, "fact_check_completed", {
    role,
    model,
    elapsed_ms: Date.now() - startedMs
  });
  return {
    role,
    model,
    output: parsed.output,
    output_file: path.relative(runDir, path.join(roleDir, "output.json")),
    summary: factCheckSummary,
    summary_file: path.relative(runDir, path.join(roleDir, "fact-check-summary.json"))
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );
  return results;
}

async function runReviewers(config, request, roles, runDir) {
  const settled = await runWithConcurrency(
    roles,
    config.execution.max_concurrency,
    async (role) => {
      const model = config.roles[role];
      try {
        return {
          ok: true,
          result: await runRole(config, request, role, runDir)
        };
      } catch (error) {
        return {
          ok: false,
          error: reviewerInfraError(role, model, error, runDir)
        };
      }
    }
  );
  return {
    reviewerResults: settled.filter((item) => item.ok).map((item) => item.result),
    infraErrors: settled.filter((item) => !item.ok).map((item) => item.error)
  };
}

async function runSynthesis(config, request, reviewerResults, factCheckResult, runDir) {
  const role = "synthesis";
  const model = config.roles.synthesis;
  const startedMs = Date.now();
  const roleDir = path.join(runDir, "roles", role);
  fs.mkdirSync(roleDir, { recursive: true });
  const reviewerOutputs = Object.fromEntries(reviewerResults.map((item) => [
    SOURCE_NAME_BY_ROLE[item.role],
    item.output
  ]));
  const prompt = buildWorkspacePrompt(
    role,
    request.project_root,
    request.review_plan || request.plan,
    request.context || "",
    reviewerOutputs,
    factCheckResult.output
  );
  const promptFile = path.join(roleDir, "prompt.md");
  const validatorLogFile = path.join(roleDir, "validator.log");
  writeGenerated(promptFile, prompt);
  const args = buildClaudeWorkspaceArgs(config, model, role, request.project_root, {
    tools: "",
    allowProjectRead: false,
    validatorLogFile
  });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-review-synthesis-"));
  const startedAt = new Date().toISOString();
  appendExecutionLog(runDir, "synthesis_started", {
    role,
    model,
    reviewer_count: reviewerResults.length
  });
  let child;
  try {
    child = await runCommand(config.claude_bin, args, {
      cwd: workDir,
      env: withoutAnthropicApiKey(process.env),
      input: prompt,
      timeoutMs: config.execution.timeout_ms,
      killSignal: "SIGKILL",
      maxBuffer: config.execution.max_buffer_bytes,
      validatorLogFile
    });
  } catch (error) {
    appendExecutionLog(runDir, "synthesis_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    throw error;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  writeGenerated(path.join(roleDir, "stdout.jsonl"), child.stdout || "");
  writeGenerated(path.join(roleDir, "stderr.log"), child.stderr || "");
  const metadata = {
    role,
    model,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timed_out: child.error?.code === "ETIMEDOUT",
    exit_code: child.status,
    signal: child.signal,
    error: child.error ? child.error.message : null,
    prompt_file: path.relative(runDir, promptFile),
    settings_file: config.models[model].settings_file,
    allowed_tools: [],
    json_validator_enabled: true,
    validator_tool: JSON_VALIDATOR_TOOL,
    validator_log_file: path.relative(runDir, validatorLogFile),
    schema_file: path.relative(ROOT, workspaceSchemaForRole(role)),
    project_root: null
  };
  if (child.error || child.status !== 0) {
    appendExecutionLog(runDir, "synthesis_failed", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed"
    });
    throw new Error(
      `synthesis/${model} failed: ${child.error?.message || `exit ${child.status}`}`
    );
  }
  let parsed;
  try {
    parsed = parseAssistantOutput(child.stdout, role);
    validateWorkspaceOutput(role, parsed.output, {
      factCheckOutput: factCheckResult.output,
      reviewerOutputs
    });
  } catch (error) {
    appendExecutionLog(runDir, "synthesis_invalid_output", {
      role,
      model,
      elapsed_ms: Date.now() - startedMs
    });
    writeJson(path.join(roleDir, "metadata.json"), {
      ...metadata,
      status: "failed",
      error: error.message
    });
    throw new Error(`synthesis/${model} returned invalid output: ${error.message}`);
  }
  writeJson(path.join(roleDir, "output.json"), parsed.output);
  writeJson(path.join(roleDir, "metadata.json"), {
    ...metadata,
    status: "completed",
    error: null
  });
  appendExecutionLog(runDir, "synthesis_completed", {
    role,
    model,
    elapsed_ms: Date.now() - startedMs
  });
  return {
    role,
    model,
    output: parsed.output,
    output_file: path.relative(runDir, path.join(roleDir, "output.json"))
  };
}

function archiveRoleAttempt(runDir, role) {
  const roleDir = path.join(runDir, "roles", role);
  if (!fs.existsSync(roleDir)) {
    return null;
  }
  const attemptsDir = path.join(runDir, "roles", `${role}-attempts`);
  fs.mkdirSync(attemptsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  let target = path.join(attemptsDir, stamp);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(attemptsDir, `${stamp}-${index}`);
    index += 1;
  }
  fs.renameSync(roleDir, target);
  return path.relative(runDir, target);
}

function normalizedRetryCounts(state) {
  const counts = {};
  for (const role of [...REVIEW_ROLES, FACT_CHECK_ROLE, "synthesis"]) {
    const value = Number(state.retry_counts?.[role] || 0);
    counts[role] = Number.isInteger(value) && value >= 0 ? value : 0;
  }
  return counts;
}

function assertRetryAvailable(retryCounts, executors) {
  const exhausted = [...new Set(executors)].filter(
    (executor) => retryCounts[executor] >= MAX_EXECUTOR_RETRIES
  );
  if (exhausted.length) {
    throw new Error(
      `Retry limit reached (${MAX_EXECUTOR_RETRIES}) for executor(s): ${exhausted.join(", ")}`
    );
  }
}

function consumeExecutorRetries(runDir, retryCounts, executors) {
  for (const executor of [...new Set(executors)]) {
    retryCounts[executor] += 1;
  }
  updateState(runDir, {
    retry_counts: retryCounts
  });
  appendExecutionLog(runDir, "executor_retries_consumed", {
    executors: [...new Set(executors)],
    retry_counts: retryCounts,
    retry_limit: MAX_EXECUTOR_RETRIES
  });
}

async function retryWorkspaceReviewStage(config, runDir, stage, options = {}) {
  if (!["reviewers", FACT_CHECK_ROLE, "synthesis"].includes(stage)) {
    throw new Error(
      `Unsupported retry stage: ${stage}. Expected reviewers, ${FACT_CHECK_ROLE}, or synthesis.`
    );
  }
  const absoluteRunDir = path.resolve(runDir);
  const state = readJsonIfExists(path.join(absoluteRunDir, "state.json")) || {};
  if (state.status === "running" && !options.force) {
    throw new Error("Cannot retry while run status is running. Use force only if the previous process is known to be dead.");
  }
  const { request, roles } = loadRequestForRun(config, absoluteRunDir);
  const runRoleStage = options.runRole || runRole;
  const runFactCheckStage = options.runFactCheck || runFactCheck;
  const runSynthesisStage = options.runSynthesis || runSynthesis;
  const completedReviewers = new Map(
    roles
      .map((role) => completedReviewerResult(absoluteRunDir, role))
      .filter(Boolean)
      .map((result) => [result.role, result])
  );
  const retryRoles = stage === "reviewers"
    ? roles.filter((role) => !completedReviewers.has(role))
    : [];
  if (stage === "reviewers" && !retryRoles.length) {
    throw new Error("Cannot retry reviewers: all requested reviewers are already completed");
  }
  if (stage !== "reviewers") {
    loadCompletedReviewerResults(absoluteRunDir, roles, stage);
  }
  const retryCounts = normalizedRetryCounts(state);
  const plannedExecutors = stage === "reviewers"
    ? [...retryRoles, FACT_CHECK_ROLE, "synthesis"]
    : stage === FACT_CHECK_ROLE
      ? [FACT_CHECK_ROLE, "synthesis"]
      : ["synthesis"];
  assertRetryAvailable(retryCounts, plannedExecutors);

  const archivedAttempts = {};
  if (stage === "reviewers") {
    for (const role of retryRoles) {
      archivedAttempts[role] = archiveRoleAttempt(absoluteRunDir, role);
    }
  } else if (stage === FACT_CHECK_ROLE) {
    archivedAttempts[FACT_CHECK_ROLE] = archiveRoleAttempt(absoluteRunDir, FACT_CHECK_ROLE);
    archivedAttempts.synthesis = archiveRoleAttempt(absoluteRunDir, "synthesis");
  } else {
    archivedAttempts.synthesis = archiveRoleAttempt(absoluteRunDir, "synthesis");
  }

  updateState(absoluteRunDir, {
    status: "running",
    pid: process.pid,
    retry_stage: stage,
    retry_started_at: new Date().toISOString(),
    project_root: request.project_root,
    roles,
    error: null,
    report_file: null
  });
  appendExecutionLog(absoluteRunDir, "stage_retry_started", {
    stage,
    retry_roles: retryRoles,
    archived_attempts: archivedAttempts
  });
  try {
    let reviewerResults;
    if (stage === "reviewers") {
      consumeExecutorRetries(absoluteRunDir, retryCounts, retryRoles);
      const settled = await runWithConcurrency(
        retryRoles,
        config.execution.max_concurrency,
        async (role) => {
          try {
            return {
              ok: true,
              result: await runRoleStage(config, request, role, absoluteRunDir)
            };
          } catch (error) {
            return {
              ok: false,
              role,
              error
            };
          }
        }
      );
      const failures = settled.filter((item) => !item.ok);
      if (failures.length) {
        throw new Error(
          `Reviewer retry failed: ${failures.map((item) => `${item.role}: ${item.error.message}`).join("; ")}`
        );
      }
      for (const item of settled) {
        completedReviewers.set(item.result.role, item.result);
      }
      reviewerResults = roles.map((role) => completedReviewers.get(role));
      archivedAttempts[FACT_CHECK_ROLE] = archiveRoleAttempt(absoluteRunDir, FACT_CHECK_ROLE);
      archivedAttempts.synthesis = archiveRoleAttempt(absoluteRunDir, "synthesis");
      appendExecutionLog(absoluteRunDir, "stage_retry_downstream_invalidated", {
        stage,
        archived_attempts: {
          fact_check: archivedAttempts[FACT_CHECK_ROLE],
          synthesis: archivedAttempts.synthesis
        }
      });
    } else {
      reviewerResults = loadCompletedReviewerResults(absoluteRunDir, roles, stage);
    }

    let factCheck;
    if (stage === "synthesis") {
      factCheck = loadCompletedFactCheckResult(absoluteRunDir, stage);
    } else {
      if (stage === FACT_CHECK_ROLE) {
        consumeExecutorRetries(absoluteRunDir, retryCounts, [FACT_CHECK_ROLE]);
      }
      factCheck = await runFactCheckStage(
        config,
        request,
        reviewerResults,
        absoluteRunDir
      );
    }
    if (stage === "synthesis") {
      consumeExecutorRetries(absoluteRunDir, retryCounts, ["synthesis"]);
    }
    const synthesis = await runSynthesisStage(
      config,
      request,
      reviewerResults,
      factCheck,
      absoluteRunDir
    );
    writeWorkspaceReport(absoluteRunDir, request, reviewerResults, factCheck, synthesis, []);
    updateState(absoluteRunDir, {
      status: "completed",
      finished_at: new Date().toISOString(),
      report_file: "report.json",
      error: null,
      retry_stage: null,
      infra_errors: []
    });
    appendExecutionLog(absoluteRunDir, "stage_retry_completed", {
      stage
    });
    appendExecutionLog(absoluteRunDir, "run_completed", {
      run_id: request.run_id,
      reviewer_count: reviewerResults.length,
      infra_error_count: 0
    });
    return {
      run_id: request.run_id,
      stage,
      status: "completed",
      retried_reviewers: retryRoles,
      retry_counts: retryCounts,
      retry_limit: MAX_EXECUTOR_RETRIES,
      archived_attempt: archivedAttempts[stage] || null,
      archived_attempts: archivedAttempts,
      report_file: path.join(absoluteRunDir, "report.json")
    };
  } catch (error) {
    appendExecutionLog(absoluteRunDir, "stage_retry_failed", {
      stage
    });
    appendExecutionLog(absoluteRunDir, "run_failed", {
      run_id: request.run_id
    });
    updateState(absoluteRunDir, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: error.stack || error.message,
      retry_stage: null
    });
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const runDir = path.resolve(requireArg(args, "run-dir"));
  const config = loadWorkspaceReviewFromArgs(args);
  const { request, roles } = loadRequestForRun(config, runDir);
  const reviewPlan = config.execution.compact_plan
    ? compactPlanForReview(request.plan)
    : {
      text: request.plan,
      stats: {
        original_chars: String(request.plan).length,
        compacted_chars: String(request.plan).length,
        saved_chars: 0,
        code_blocks: 0,
        compacted_blocks: 0,
        preserved_blocks: 0
      }
    };
  request.review_plan = reviewPlan.text;
  request.plan_compaction = reviewPlan.stats;
  request.proposed_artifacts = materializeProposedArtifacts(runDir, reviewPlan.artifacts || []);
  request.review_plan_refs = createPlanReferenceManifest(
    request.project_root,
    request.plan,
    request.proposed_artifacts
  );
  writeGenerated(path.join(runDir, "review-plan.md"), request.review_plan);
  writeJson(path.join(runDir, "plan-compaction.json"), request.plan_compaction);
  writeJson(path.join(runDir, "proposed-code-manifest.json"), {
    artifact_count: request.proposed_artifacts.length,
    artifacts: request.proposed_artifacts
  });
  writeJson(path.join(runDir, "review-plan-refs.json"), request.review_plan_refs);

  updateState(runDir, {
    status: "running",
    pid: process.pid,
    started_at: new Date().toISOString(),
    roles,
    project_root: request.project_root,
    error: null
  });
  appendExecutionLog(runDir, "run_started", {
    run_id: request.run_id,
    pid: process.pid,
    roles,
    max_concurrency: config.execution.max_concurrency
  });
  appendExecutionLog(runDir, "plan_compacted", request.plan_compaction);
  appendExecutionLog(runDir, "plan_authoring_linted", {
    errors: request.authoring_lint.errors.length,
    warnings: request.authoring_lint.warnings.length,
    complexity: request.authoring_lint.complexity.level,
    total_lines: request.authoring_lint.metrics.total_lines
  });
  appendExecutionLog(runDir, "proposed_artifacts_prepared", {
    artifacts: request.proposed_artifacts.length
  });

  try {
    const { reviewerResults, infraErrors } = await runReviewers(config, request, roles, runDir);
    if (!reviewerResults.length) {
      throw new Error("All reviewers failed before producing valid JSON output");
    }
    const factCheck = await runFactCheck(config, request, reviewerResults, runDir);
    const synthesis = await runSynthesis(config, request, reviewerResults, factCheck, runDir);
    writeWorkspaceReport(runDir, request, reviewerResults, factCheck, synthesis, infraErrors);
    updateState(runDir, {
      status: "completed",
      finished_at: new Date().toISOString(),
      report_file: "report.json",
      error: null,
      infra_errors: infraErrors
    });
    appendExecutionLog(runDir, "run_completed", {
      run_id: request.run_id,
      reviewer_count: reviewerResults.length,
      infra_error_count: infraErrors.length
    });
  } catch (error) {
    appendExecutionLog(runDir, "run_failed", {
      run_id: request.run_id
    });
    updateState(runDir, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: error.stack || error.message
    });
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runRole,
  runWithConcurrency,
  summarizeReviewOutcome,
  runSynthesis,
  retryWorkspaceReviewStage,
  completedReviewerResult,
  normalizedRetryCounts,
  assertRetryAvailable,
  loadCompletedReviewerResults,
  loadCompletedFactCheckResult,
  writeWorkspaceReport,
  validateWorkspaceOutput,
  validateSynthesisSemantics
};
