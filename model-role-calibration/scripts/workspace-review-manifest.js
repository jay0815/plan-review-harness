const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  ROOT,
  writeGenerated
} = require("./lib");

const MANIFEST_FILE = "run-manifest.json";
const DEFAULT_ROUTE_FILE = path.join(ROOT, "default-role-routes.json");
const WORKSPACE_REVIEW_ROLES = ["risk", "architecture", "execution", "rebuttal", "fact_check", "synthesis"];
const MAX_UNTRACKED_HASH_FILES = 200;
const MAX_UNTRACKED_HASH_BYTES = 5 * 1024 * 1024;
const ATTEMPT_ARTIFACT_FIELDS = [
  "metadata_file",
  "prompt_file",
  "output_file",
  "invalid_output_file",
  "stdout_file",
  "stderr_file",
  "validator_log_file",
  "fact_check_summary_file",
  "read_scope_file"
];

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function stable(value) {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])])
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function hashJson(value) {
  return sha256(stableJson(value));
}

function hashText(value) {
  return sha256(String(value || ""));
}

function hashFileIfExists(file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return null;
  }
  return sha256(fs.readFileSync(file));
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeGenerated(file, JSON.stringify(value, null, 2) + "\n");
}

function manifestPath(runDir) {
  return path.join(runDir, MANIFEST_FILE);
}

function requireRunManifest(runDir) {
  const file = manifestPath(runDir);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing required run manifest: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function git(projectRoot, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 5000
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  const stdout = String(result.stdout || "");
  return options.trim === false ? stdout : stdout.trim();
}

function hashUntrackedFiles(projectRoot) {
  const output = git(projectRoot, ["ls-files", "--others", "--exclude-standard", "-z"], {
    trim: false
  });
  if (!output) {
    return {
      hashes: {},
      skipped: []
    };
  }
  const hashes = {};
  const skipped = [];
  const relativePaths = output.split("\0").filter(Boolean).sort();
  for (const relativePath of relativePaths) {
    const absolute = path.join(projectRoot, relativePath);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      continue;
    }
    const stat = fs.statSync(absolute);
    if (Object.keys(hashes).length >= MAX_UNTRACKED_HASH_FILES) {
      skipped.push({
        path: relativePath,
        reason: "file_count_limit",
        size_bytes: stat.size
      });
      continue;
    }
    if (stat.size > MAX_UNTRACKED_HASH_BYTES) {
      skipped.push({
        path: relativePath,
        reason: "file_size_limit",
        size_bytes: stat.size
      });
      continue;
    }
    hashes[relativePath] = hashFileIfExists(absolute);
  }
  return {
    hashes,
    skipped,
    limits: {
      max_files: MAX_UNTRACKED_HASH_FILES,
      max_file_bytes: MAX_UNTRACKED_HASH_BYTES
    }
  };
}

function workspaceSnapshot(projectRoot) {
  const root = path.resolve(projectRoot);
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!inside) {
    return {
      project_root: root,
      git_available: false,
      git_head: null,
      dirty: null,
      dirty_files: [],
      dirty_patch_hash: null
    };
  }
  const statusText = git(root, ["status", "--porcelain=v1"]) || "";
  const dirtyEntries = statusText.split("\n").filter(Boolean);
  const diffText = git(root, ["diff", "--binary", "HEAD", "--"]) || "";
  const untracked = hashUntrackedFiles(root);
  return {
    project_root: root,
    git_available: true,
    git_head: git(root, ["rev-parse", "HEAD"]),
    dirty: dirtyEntries.length > 0,
    dirty_files: dirtyEntries.map((line) => line.slice(3)),
    dirty_entries: dirtyEntries,
    untracked_file_hashes: untracked.hashes,
    untracked_file_hash_skipped: untracked.skipped,
    untracked_file_hash_limits: untracked.limits,
    dirty_patch_hash: dirtyEntries.length
      ? sha256([
        statusText,
        diffText,
        stableJson(untracked)
      ].join("\n--- dirty patch components ---\n"))
      : null
  };
}

function workspacePromptFile(role) {
  return path.join(ROOT, "prompts", `probe-${role}.md`);
}

function workspaceSchemaFile(role) {
  if (role === "fact_check") {
    return path.join(ROOT, "schemas", "fact-check-output.schema.json");
  }
  return path.join(ROOT, "schemas", `${role}-output.schema.json`);
}

function hashFilesByRole(roles, resolver) {
  const items = {};
  for (const role of roles) {
    const file = resolver(role);
    items[role] = {
      path: path.relative(ROOT, file),
      hash: hashFileIfExists(file)
    };
  }
  return {
    hash: hashJson(items),
    files: items
  };
}

function declaredRuntime(config, roles) {
  const runtimeRoles = [...new Set([...roles, "fact_check", "synthesis"])]
    .filter((role) => WORKSPACE_REVIEW_ROLES.includes(role));
  const promptSet = hashFilesByRole(runtimeRoles, workspacePromptFile);
  const schemaSet = hashFilesByRole(runtimeRoles, workspaceSchemaFile);
  const routePath = config.config_file || DEFAULT_ROUTE_FILE;
  const routeProfile = {
    path: path.relative(ROOT, routePath),
    hash: hashJson(config.roles),
    source_file_hash: hashFileIfExists(routePath),
    effective_roles: config.roles
  };
  const defaultRoute = readJsonIfExists(DEFAULT_ROUTE_FILE);
  if (!config.config_file && defaultRoute?.source) {
    routeProfile.approval_ref = defaultRoute.source;
  }
  return {
    policy: null,
    route_profile: routeProfile,
    prompt_set_hash: promptSet.hash,
    prompt_set: promptSet.files,
    schema_set_hash: schemaSet.hash,
    schema_set: schemaSet.files,
    execution: config.execution,
    claude_bin: config.claude_bin,
    claude_version: config.claude_version || null
  };
}

function createRunManifest(config, request, runDir, options = {}) {
  const file = manifestPath(runDir);
  if (fs.existsSync(file)) {
    throw new Error(`Refusing to overwrite existing run manifest: ${file}`);
  }
  const roles = Array.isArray(request.roles) && request.roles.length
    ? request.roles
    : ["risk", "architecture", "execution", "rebuttal"];
  const createdAt = options.createdAt || request.created_at || new Date().toISOString();
  const manifest = {
    version: 1,
    run_id: request.run_id,
    status: "created",
    created_at: createdAt,
    updated_at: createdAt,
    workspace: workspaceSnapshot(request.project_root),
    inputs: {
      plan: {
        path: request.plan_file || null,
        hash: hashText(request.plan)
      },
      context_hash: request.context ? hashText(request.context) : null,
      review_plan: null,
      review_plan_refs_hash: null
    },
    declared_runtime: declaredRuntime(config, roles),
    resolved_execution: {},
    artifacts: {
      request: "request.json",
      state: "state.json"
    }
  };
  writeJson(file, manifest);
  return manifest;
}

function updateRunManifest(runDir, updater) {
  const file = manifestPath(runDir);
  const current = requireRunManifest(runDir);
  const patch = typeof updater === "function" ? updater(current) : updater;
  const next = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString()
  };
  writeJson(file, next);
  return next;
}

function markManifestRunning(runDir, request) {
  const reviewPlanFile = path.join(runDir, "review-plan.md");
  return updateRunManifest(runDir, (current) => ({
    status: "running",
    inputs: {
      ...current.inputs,
      review_plan: {
        path: "review-plan.md",
        hash: hashFileIfExists(reviewPlanFile) || hashText(request.review_plan || request.plan)
      },
      review_plan_refs_hash: request.review_plan_refs
        ? hashJson(request.review_plan_refs)
        : current.inputs.review_plan_refs_hash
    },
    artifacts: {
      ...current.artifacts,
      review_plan: "review-plan.md",
      plan_compaction: "plan-compaction.json",
      review_plan_refs: "review-plan-refs.json",
      plan_authoring_lint: "plan-authoring-lint.json"
    }
  }));
}

function relativeFromRun(runDir, file) {
  if (!file) {
    return null;
  }
  return path.isAbsolute(file) ? path.relative(runDir, file) : file;
}

function absoluteFromRun(runDir, file) {
  if (!file) {
    return null;
  }
  return path.isAbsolute(file) ? file : path.join(runDir, file);
}

function promptHash(runDir, metadata) {
  return hashFileIfExists(absoluteFromRun(runDir, metadata.prompt_file));
}

function schemaHash(metadata) {
  const schemaFile = metadata.schema_file
    ? path.join(ROOT, metadata.schema_file)
    : workspaceSchemaFile(metadata.role);
  return hashFileIfExists(schemaFile);
}

function readScopeHash(runDir, metadata) {
  return hashFileIfExists(absoluteFromRun(runDir, metadata.read_boundary?.read_scope_file));
}

function outputHash(runDir, role) {
  return hashFileIfExists(path.join(runDir, "roles", role, "output.json"));
}

function existingRelativeFile(runDir, file) {
  const relative = relativeFromRun(runDir, file);
  if (!relative) {
    return null;
  }
  return fs.existsSync(absoluteFromRun(runDir, relative)) ? relative : null;
}

function roleFileIfExists(runDir, role, fileName) {
  return existingRelativeFile(runDir, path.join("roles", role, fileName));
}

function attemptArtifactPaths(runDir, metadata, extra = {}) {
  const role = metadata.role;
  return {
    metadata_file: existingRelativeFile(
      runDir,
      extra.metadata_file || path.join("roles", role, "metadata.json")
    ),
    prompt_file: existingRelativeFile(runDir, metadata.prompt_file),
    output_file: roleFileIfExists(runDir, role, "output.json"),
    invalid_output_file: existingRelativeFile(runDir, metadata.invalid_output_file),
    stdout_file: roleFileIfExists(runDir, role, "stdout.jsonl"),
    stderr_file: roleFileIfExists(runDir, role, "stderr.log"),
    validator_log_file: existingRelativeFile(runDir, metadata.validator_log_file),
    fact_check_summary_file: existingRelativeFile(runDir, metadata.fact_check_summary_file),
    read_scope_file: existingRelativeFile(runDir, metadata.read_boundary?.read_scope_file)
  };
}

function normalizeRelPath(file) {
  return String(file || "").replace(/\\/g, "/").split(path.sep).join("/");
}

function relocateRolePath(file, role, archivedRoleDir) {
  if (!file) {
    return file;
  }
  const normalizedFile = normalizeRelPath(file);
  const activePrefix = `roles/${role}/`;
  if (!normalizedFile.startsWith(activePrefix)) {
    return file;
  }
  const archivedPrefix = normalizeRelPath(archivedRoleDir).replace(/\/$/, "");
  return `${archivedPrefix}/${normalizedFile.slice(activePrefix.length)}`;
}

function relocateAttemptArtifacts(attempt, role, archivedRoleDir) {
  const next = {
    ...attempt,
    archived_as: archivedRoleDir
  };
  for (const field of ATTEMPT_ARTIFACT_FIELDS) {
    next[field] = relocateRolePath(next[field], role, archivedRoleDir);
  }
  return next;
}

function recordResolvedExecution(runDir, metadata, extra = {}) {
  const role = metadata.role;
  if (!role) {
    throw new Error("Cannot record resolved execution without role");
  }
  return updateRunManifest(runDir, (current) => {
    const previous = current.resolved_execution?.[role] || {};
    const history = Array.isArray(previous.attempt_history)
      ? previous.attempt_history
      : [];
    const artifactPaths = attemptArtifactPaths(runDir, metadata, extra);
    const attempt = {
      attempt_index: history.length + 1,
      status: extra.status || metadata.status || null,
      adapter: "claude-code",
      provider: "claude-code-wrapper",
      model: metadata.model || null,
      prompt_hash: promptHash(runDir, metadata),
      schema_hash: schemaHash(metadata),
      read_scope_hash: readScopeHash(runDir, metadata),
      output_hash: outputHash(runDir, role),
      allowed_tools: metadata.allowed_tools || [],
      settings_file: metadata.settings_file || null,
      started_at: metadata.started_at || null,
      finished_at: metadata.finished_at || null,
      exit_code: metadata.exit_code ?? null,
      signal: metadata.signal ?? null,
      timed_out: Boolean(metadata.timed_out),
      failure_kind: metadata.failure_kind || extra.failure_kind || null,
      error: metadata.error || extra.error || null,
      fallback_from: extra.fallback_from || null,
      schema_file: metadata.schema_file || null,
      ...artifactPaths
    };
    const nextHistory = [...history, attempt];
    return {
      resolved_execution: {
        ...current.resolved_execution,
        [role]: {
          adapter: attempt.adapter,
          provider: attempt.provider,
          model: attempt.model,
          prompt_hash: attempt.prompt_hash,
          schema_hash: attempt.schema_hash,
          read_scope_hash: attempt.read_scope_hash,
          output_hash: attempt.output_hash,
          allowed_tools: attempt.allowed_tools,
          settings_file: attempt.settings_file,
          metadata_file: attempt.metadata_file,
          prompt_file: attempt.prompt_file,
          output_file: attempt.output_file,
          invalid_output_file: attempt.invalid_output_file,
          stdout_file: attempt.stdout_file,
          stderr_file: attempt.stderr_file,
          validator_log_file: attempt.validator_log_file,
          fact_check_summary_file: attempt.fact_check_summary_file,
          read_scope_file: attempt.read_scope_file,
          attempts: nextHistory.length,
          latest_status: attempt.status,
          fallback_from: attempt.fallback_from,
          attempt_history: nextHistory
        }
      }
    };
  });
}

function archiveResolvedExecutionAttempt(runDir, role, archivedRoleDir) {
  if (!archivedRoleDir) {
    return null;
  }
  return updateRunManifest(runDir, (current) => {
    const roleExecution = current.resolved_execution?.[role];
    if (!roleExecution) {
      return {};
    }
    const history = Array.isArray(roleExecution.attempt_history)
      ? roleExecution.attempt_history
      : [];
    if (!history.length) {
      return {};
    }
    const latestIndex = history.length - 1;
    const relocatedLatest = relocateAttemptArtifacts(history[latestIndex], role, archivedRoleDir);
    const nextHistory = history.map((attempt, index) => (
      index === latestIndex ? relocatedLatest : attempt
    ));
    const nextRoleExecution = {
      ...roleExecution,
      archived_as: archivedRoleDir,
      attempt_history: nextHistory
    };
    for (const field of ATTEMPT_ARTIFACT_FIELDS) {
      nextRoleExecution[field] = relocatedLatest[field] ?? nextRoleExecution[field] ?? null;
    }
    return {
      resolved_execution: {
        ...current.resolved_execution,
        [role]: nextRoleExecution
      }
    };
  });
}

function markManifestFinished(runDir, status, patch = {}) {
  return updateRunManifest(runDir, (current) => ({
    ...patch,
    status,
    finished_at: new Date().toISOString(),
    artifacts: {
      ...current.artifacts,
      report: fs.existsSync(path.join(runDir, "report.json")) ? "report.json" : current.artifacts?.report
    }
  }));
}

module.exports = {
  MANIFEST_FILE,
  manifestPath,
  requireRunManifest,
  createRunManifest,
  updateRunManifest,
  markManifestRunning,
  markManifestFinished,
  recordResolvedExecution,
  archiveResolvedExecutionAttempt,
  hashText,
  hashJson,
  hashFileIfExists,
  workspaceSnapshot
};
