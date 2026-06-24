#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  ROOT,
  parseJsonFile,
  readText,
  schemaForProbe,
  slug,
  writeGenerated
} = require("./lib");

const REVIEW_ROLES = ["risk", "architecture", "execution", "rebuttal"];
const FACT_CHECK_ROLE = "fact_check";
const SYNTHESIS_ROLE = "synthesis";
const JSON_VALIDATOR_TOOL = "mcp__json_validator__validate_json_output";
const MAX_EXECUTOR_RETRIES = 3;
const WORKSPACE_ROLES = [...REVIEW_ROLES, FACT_CHECK_ROLE, SYNTHESIS_ROLE];
const REQUIRED_ROLES = [...REVIEW_ROLES, FACT_CHECK_ROLE, SYNTHESIS_ROLE];
const PLACEHOLDER_PATTERN = /REPLACE_|YOUR_|CHANGEME|<[^>]+>/i;
const DEFAULT_MODEL_FILES = {
  kimi: "kimi.json",
  deepseek: "deepseek.json",
  glm: "glm.json",
  qwen: "qwen.json"
};
const DEFAULT_MODEL_REQUIRED_ENV = {
  kimi: ["ANTHROPIC_BASE_URL"],
  deepseek: ["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"],
  glm: ["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"],
  qwen: ["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"]
};
const DEFAULT_ROLE_ROUTE_FILE = path.join(ROOT, "default-role-routes.json");
const DEFAULT_ROLE_ROUTE_CONFIG = parseJsonFile(DEFAULT_ROLE_ROUTE_FILE);
const DEFAULT_ROLE_ROUTES = Object.freeze({ ...DEFAULT_ROLE_ROUTE_CONFIG.routes });
const DEFAULT_ROLE_ROUTE_SOURCE = Object.freeze({
  ...DEFAULT_ROLE_ROUTE_CONFIG.source,
  route_file: "model-role-calibration/default-role-routes.json"
});
const COMPACT_CODE_BLOCK_LINE_THRESHOLD = 12;
const COMPACT_CODE_BLOCK_CHAR_THRESHOLD = 900;
const DEFAULT_READ_SCOPE_MAX_FILES = 80;
const PROPOSED_CODE_DIR = "proposed-code";
const LINE_REF_SUFFIX_PATTERN = /:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/;
const PRESERVE_CODE_BLOCK_LANGS = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "mermaid"
]);
const COMMON_PROJECT_FILES = [
  "package.json",
  "tsconfig.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "README.md",
  "readme.md",
  ".gitignore"
];
const SKIP_SCOPE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "runs",
  "workspace-runs"
]);

const CODE_BLOCK_EXTENSION_BY_LANGUAGE = {
  cjs: ".cjs",
  css: ".css",
  html: ".html",
  javascript: ".js",
  js: ".js",
  json: ".json",
  jsx: ".jsx",
  markdown: ".md",
  md: ".md",
  mjs: ".mjs",
  ts: ".ts",
  tsx: ".tsx",
  typescript: ".ts",
  yaml: ".yaml",
  yml: ".yaml"
};

function assertWorkspaceRole(role) {
  if (!WORKSPACE_ROLES.includes(role)) {
    throw new Error(`Invalid workspace review role "${role}". Expected one of: ${WORKSPACE_ROLES.join(", ")}`);
  }
}

function expandHome(value) {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveConfiguredPath(value, configDir) {
  const expanded = expandHome(String(value));
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(configDir, expanded);
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function assertNonPlaceholder(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`${label} still contains a placeholder value`);
  }
}

function validateSettingsFile(model, modelConfig, configDir) {
  if (!modelConfig || typeof modelConfig !== "object" || Array.isArray(modelConfig)) {
    throw new Error(`models.${model} must be an object`);
  }
  if (!modelConfig.settings_file) {
    throw new Error(`models.${model}.settings_file is required`);
  }
  const settingsFile = resolveConfiguredPath(modelConfig.settings_file, configDir);
  if (!fs.existsSync(settingsFile)) {
    throw new Error(`Missing settings file for model "${model}": ${settingsFile}`);
  }
  const stat = fs.statSync(settingsFile);
  if (!stat.isFile()) {
    throw new Error(`Settings path for model "${model}" is not a file: ${settingsFile}`);
  }
  fs.accessSync(settingsFile, fs.constants.R_OK);

  const settingsText = readText(settingsFile);
  if (/"ANTHROPIC_API_KEY"\s*:/.test(settingsText)) {
    throw new Error(
      `Settings file for model "${model}" contains forbidden ANTHROPIC_API_KEY; ` +
      "use ANTHROPIC_AUTH_TOKEN only"
    );
  }
  let settings;
  try {
    settings = JSON.parse(settingsText);
  } catch (error) {
    throw new Error(`Invalid JSON in settings file for model "${model}": ${error.message}`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`Settings file for model "${model}" must contain a JSON object`);
  }
  const env = settings.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new Error(`Settings file for model "${model}" must contain an env object`);
  }
  const requiredEnv = Array.isArray(modelConfig.required_env)
    ? modelConfig.required_env
    : ["ANTHROPIC_BASE_URL"];
  for (const key of requiredEnv) {
    assertNonPlaceholder(env[key], `${model} settings env.${key}`);
  }
  const authToken = env.ANTHROPIC_AUTH_TOKEN;
  if (
    typeof authToken !== "string" ||
    !authToken.trim() ||
    PLACEHOLDER_PATTERN.test(authToken)
  ) {
    throw new Error(
      `Settings file for model "${model}" must define a non-placeholder ` +
      "ANTHROPIC_AUTH_TOKEN"
    );
  }

  return {
    ...modelConfig,
    settings_file: settingsFile,
    required_env: requiredEnv,
    summary: {
      base_url: env.ANTHROPIC_BASE_URL || null,
      model: env.ANTHROPIC_MODEL || null,
      auth_env: "ANTHROPIC_AUTH_TOKEN"
    }
  };
}

function validateClaudeBinary(command) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 10000,
    env: withoutAnthropicApiKey(process.env)
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message || result.stderr.trim() || `exit ${result.status}`;
    throw new Error(`Unable to execute Claude Code binary "${command}": ${reason}`);
  }
  return (result.stdout || result.stderr || "").trim();
}

function normalizeWorkspaceReviewConfig(raw, source, options = {}) {
  if (raw.version !== 1) {
    throw new Error(`Unsupported workspace review config version: ${raw.version}`);
  }
  if (!raw.models || typeof raw.models !== "object" || Array.isArray(raw.models)) {
    throw new Error("Workspace review config must contain a models object");
  }
  if (!raw.roles || typeof raw.roles !== "object" || Array.isArray(raw.roles)) {
    throw new Error("Workspace review config must contain a roles object");
  }

  const configDir = source.config_dir;
  const roles = {
    ...DEFAULT_ROLE_ROUTES,
    ...raw.roles
  };
  const requiredModels = new Set();
  for (const role of REQUIRED_ROLES) {
    assertWorkspaceRole(role);
    const model = roles[role];
    if (typeof model !== "string" || !model.trim()) {
      throw new Error(`roles.${role} must name a configured model`);
    }
    requiredModels.add(model);
  }
  if (roles.planner) {
    requiredModels.add(roles.planner);
  }

  const models = {};
  for (const model of requiredModels) {
    if (!Object.prototype.hasOwnProperty.call(raw.models, model)) {
      throw new Error(`Role routing references missing model configuration: ${model}`);
    }
  }
  const configuredModels = Object.keys(raw.models);
  if (!configuredModels.length) {
    throw new Error("Workspace review config must declare at least one model");
  }
  for (const model of configuredModels) {
    models[model] = validateSettingsFile(model, raw.models[model], configDir);
  }

  const execution = raw.execution || {};
  const normalized = {
    version: 1,
    config_file: source.config_file || null,
    settings_dir: source.settings_dir || null,
    loader_args: source.loader_args,
    config_dir: configDir,
    claude_bin: raw.claude_bin || "claude",
    claude_version: null,
    workspace_runs_dir: resolveConfiguredPath(
      raw.workspace_runs_dir || path.join(ROOT, "workspace-runs"),
      configDir
    ),
    models,
    roles,
    execution: {
      max_concurrency: positiveInteger(execution.max_concurrency || 4, "execution.max_concurrency"),
      timeout_ms: positiveInteger(execution.timeout_ms || 900000, "execution.timeout_ms"),
      max_buffer_bytes: positiveInteger(
        execution.max_buffer_bytes || 20 * 1024 * 1024,
        "execution.max_buffer_bytes"
      ),
      max_turns: positiveInteger(execution.max_turns || 24, "execution.max_turns"),
      compact_plan: execution.compact_plan !== false,
      isolate_reviewers: execution.isolate_reviewers !== false,
      read_scope_max_files: positiveInteger(
        execution.read_scope_max_files || DEFAULT_READ_SCOPE_MAX_FILES,
        "execution.read_scope_max_files"
      )
    }
  };
  if (options.validateClaudeBin !== false) {
    normalized.claude_version = validateClaudeBinary(normalized.claude_bin);
  }
  return normalized;
}

function loadWorkspaceReviewConfig(configFile, options = {}) {
  const absoluteConfigFile = path.resolve(expandHome(configFile));
  if (!fs.existsSync(absoluteConfigFile)) {
    throw new Error(`Workspace review config does not exist: ${absoluteConfigFile}`);
  }
  let raw;
  try {
    raw = parseJsonFile(absoluteConfigFile);
  } catch (error) {
    throw new Error(`Invalid workspace review config JSON: ${error.message}`);
  }
  return normalizeWorkspaceReviewConfig(raw, {
    config_file: absoluteConfigFile,
    config_dir: path.dirname(absoluteConfigFile),
    loader_args: ["--config", absoluteConfigFile]
  }, options);
}

function loadWorkspaceReviewSettingsDirectory(settingsDir, options = {}) {
  const absoluteSettingsDir = path.resolve(expandHome(settingsDir));
  if (!fs.existsSync(absoluteSettingsDir)) {
    throw new Error(`Settings directory does not exist: ${absoluteSettingsDir}`);
  }
  const stat = fs.statSync(absoluteSettingsDir);
  if (!stat.isDirectory()) {
    throw new Error(`Settings path is not a directory: ${absoluteSettingsDir}`);
  }
  fs.accessSync(absoluteSettingsDir, fs.constants.R_OK);

  const models = Object.fromEntries(
    Object.entries(DEFAULT_MODEL_FILES).map(([model, filename]) => [
      model,
      {
        settings_file: path.join(absoluteSettingsDir, filename),
        required_env: DEFAULT_MODEL_REQUIRED_ENV[model]
      }
    ])
  );
  const loaderArgs = ["--settings-dir", absoluteSettingsDir];
  if (options.claudeBin) {
    loaderArgs.push("--claude-bin", options.claudeBin);
  }
  return normalizeWorkspaceReviewConfig({
    version: 1,
    claude_bin: options.claudeBin || "claude",
    workspace_runs_dir: options.workspaceRunsDir || path.join(ROOT, "workspace-runs"),
    models,
    roles: DEFAULT_ROLE_ROUTES,
    execution: options.execution || {}
  }, {
    settings_dir: absoluteSettingsDir,
    config_dir: absoluteSettingsDir,
    loader_args: loaderArgs
  }, options);
}

function loadWorkspaceReviewFromArgs(args, options = {}) {
  const configFile = args.config && args.config !== true ? String(args.config) : null;
  const settingsDir = args["settings-dir"] && args["settings-dir"] !== true
    ? String(args["settings-dir"])
    : null;
  if (configFile && settingsDir) {
    throw new Error("Use either --settings-dir or --config, not both");
  }
  if (settingsDir) {
    return loadWorkspaceReviewSettingsDirectory(settingsDir, {
      ...options,
      claudeBin: args["claude-bin"] && args["claude-bin"] !== true
        ? String(args["claude-bin"])
        : options.claudeBin
    });
  }
  if (configFile) {
    return loadWorkspaceReviewConfig(configFile, options);
  }
  throw new Error("Missing required argument: --settings-dir");
}

function configSummary(config) {
  return {
    config_file: config.config_file,
    settings_dir: config.settings_dir,
    claude_bin: config.claude_bin,
    claude_version: config.claude_version,
    workspace_runs_dir: config.workspace_runs_dir,
    roles: config.roles,
    role_route_source: DEFAULT_ROLE_ROUTE_SOURCE,
    models: Object.fromEntries(Object.entries(config.models).map(([model, value]) => [
      model,
      {
        settings_file: value.settings_file,
        base_url: value.summary.base_url,
        model: value.summary.model,
        auth_env: value.summary.auth_env
      }
    ]))
  };
}

function validateProjectRoot(projectRoot) {
  const resolved = path.resolve(expandHome(projectRoot));
  if (!fs.existsSync(resolved)) {
    throw new Error(`Project root does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Project root is not a directory: ${resolved}`);
  }
  fs.accessSync(resolved, fs.constants.R_OK);
  return resolved;
}

function isInsidePath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeProjectRelativePath(projectRoot, candidate) {
  let value = String(candidate || "").trim();
  if (!value) {
    return null;
  }
  value = value
    .replace(/^["'`(<[]+/, "")
    .replace(/[)"'`,.;\]]+$/, "")
    .replace(LINE_REF_SUFFIX_PATTERN, "");
  if (!value || /^(?:https?|chrome|data):\/\//i.test(value)) {
    return null;
  }
  const absoluteProjectRoot = path.resolve(projectRoot);
  let absolute;
  if (path.isAbsolute(value)) {
    absolute = path.resolve(value);
    if (!isInsidePath(absoluteProjectRoot, absolute)) {
      return {
        blocked: value
      };
    }
  } else {
    absolute = path.resolve(absoluteProjectRoot, value);
    if (!isInsidePath(absoluteProjectRoot, absolute)) {
      return {
        blocked: value
      };
    }
  }
  const relative = path.relative(absoluteProjectRoot, absolute).split(path.sep).join("/");
  if (!relative || relative.startsWith("../") || relative.includes("\0")) {
    return null;
  }
  return {
    relative,
    absolute
  };
}

function existingCodeRefPaths(text) {
  const lines = String(text || "").split("\n");
  const paths = [];
  let inSection = false;
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      inSection = /existing\s+code\s+refs?|现有代码引用/i.test(heading[1].trim());
      continue;
    }
    if (!inSection) {
      continue;
    }
    const pathMatch = line.match(/^\s*-\s*path\s*:\s*(.+?)\s*$/i);
    if (pathMatch) {
      paths.push(pathMatch[1].trim().replace(/^`|`$/g, ""));
    }
  }
  return paths;
}

function collectPathCandidates(text) {
  const candidates = new Set();
  const input = String(text || "");
  const lineRef = "(?::\\d+(?::\\d+)?(?:-\\d+(?::\\d+)?)?)?";
  const patterns = [
    /`([^`\n]+)`/g,
    new RegExp(`(?:^|[\\s"'([])(/[A-Za-z0-9_./@+-]+(?:\\.[A-Za-z0-9]+)?${lineRef})`, "gm"),
    new RegExp(
      `(?:^|[\\s"'([])((?:\\.{1,2}/)?(?:[A-Za-z0-9_.@+-]+/)+[A-Za-z0-9_.@+-]+(?:\\.[A-Za-z0-9]+)?${lineRef})`,
      "gm"
    ),
    /(?:^|[\s"'([])((?:package|tsconfig|pnpm-lock|pnpm-workspace|package-lock|yarn|bun|README|readme|CHANGELOG|\.gitignore)[A-Za-z0-9_.-]*)(?=$|[\s"'`),.;\]])/gm
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(input)) !== null) {
      const raw = match[1] || "";
      for (const part of raw.split(/\s+/)) {
        if (part.includes("/") || COMMON_PROJECT_FILES.includes(part) || /\.[A-Za-z0-9]+(?::\d+)?$/.test(part)) {
          candidates.add(part);
        }
      }
    }
  }
  return [...candidates];
}

function stripLineRefSuffix(value) {
  return String(value || "")
    .trim()
    .replace(/^["'`(<[]+/, "")
    .replace(/[)"'`,.;\]]+$/, "")
    .replace(LINE_REF_SUFFIX_PATTERN, "");
}

function lineRefSuffix(value) {
  const match = String(value || "").trim().match(LINE_REF_SUFFIX_PATTERN);
  return match ? match[0].slice(1) : null;
}

function normalizeProposedArtifacts(artifacts = []) {
  return (Array.isArray(artifacts) ? artifacts : [])
    .filter((artifact) => artifact && typeof artifact.relative_path === "string")
    .map((artifact) => ({
      relative_path: artifact.relative_path.split(path.sep).join("/"),
      source_file: artifact.source_file || null,
      language: artifact.language || "",
      line_count: artifact.line_count || null,
      char_count: artifact.char_count || null,
      block_index: artifact.block_index || null,
      origin: artifact.origin || "plan_proposed_artifact",
      review_semantics: artifact.review_semantics || "plan_draft",
      expected_completeness: artifact.expected_completeness || "not_compile_target",
      content: artifact.content || null
    }))
    .filter((artifact) => {
      const relative = artifact.relative_path;
      return relative.startsWith(`${PROPOSED_CODE_DIR}/`) &&
        !relative.includes("\0") &&
        !relative.split("/").includes("..");
    });
}

function addProposedArtifactToScope(artifact, files, proposedArtifacts) {
  files.add(artifact.relative_path);
  proposedArtifacts.set(artifact.relative_path, artifact);
}

function createPlanReferenceManifest(projectRoot, plan, proposedArtifacts = []) {
  const existingRefsByKey = new Map();
  const blockedRefs = new Set();
  const skippedRefs = new Set();
  for (const candidate of collectPathCandidates(plan)) {
    const normalized = normalizeProjectRelativePath(projectRoot, candidate);
    if (!normalized) {
      continue;
    }
    if (normalized.blocked) {
      blockedRefs.add(normalized.blocked);
      continue;
    }
    if (!fs.existsSync(normalized.absolute) || !fs.lstatSync(normalized.absolute).isFile()) {
      skippedRefs.add(normalized.relative);
      continue;
    }
    const key = `${normalized.relative}:${lineRefSuffix(candidate) || ""}`;
    existingRefsByKey.set(key, {
      path: normalized.relative,
      line_ref: lineRefSuffix(candidate),
      original_ref: String(candidate)
    });
  }
  const normalizedArtifacts = normalizeProposedArtifacts(proposedArtifacts).map((artifact) => ({
    path: artifact.relative_path,
    line_ref: `1-${artifact.line_count || "?"}`,
    language: artifact.language || "",
    block_index: artifact.block_index || null,
    char_count: artifact.char_count || null,
    origin: artifact.origin || "plan_proposed_artifact",
    review_semantics: artifact.review_semantics || "plan_draft",
    expected_completeness: artifact.expected_completeness || "not_compile_target"
  }));
  return {
    version: 1,
    format_status: {
      has_existing_code_refs_section: /^##\s+Existing Code Refs\b/im.test(String(plan || "")),
      has_proposed_code_artifacts_section: /^##\s+Proposed Code Artifacts\b/im.test(String(plan || "")),
      generated_review_plan: true,
      generated_ref_json: true
    },
    existing_code_refs: [...existingRefsByKey.values()].sort((a, b) => (
      `${a.path}:${a.line_ref || ""}`.localeCompare(`${b.path}:${b.line_ref || ""}`)
    )),
    proposed_code_artifacts: normalizedArtifacts,
    blocked_refs: [...blockedRefs].sort(),
    skipped_refs: [...skippedRefs].sort()
  };
}

function shouldSkipScopePath(relativePath) {
  return relativePath.split("/").some((part) => SKIP_SCOPE_DIRS.has(part));
}

function addFileToScope(projectRoot, relativePath, files, skippedRefs) {
  if (shouldSkipScopePath(relativePath)) {
    skippedRefs.add(relativePath);
    return;
  }
  const absolute = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolute)) {
    skippedRefs.add(relativePath);
    return;
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile()) {
    skippedRefs.add(relativePath);
    return;
  }
  files.add(relativePath);
}

function expandDirectoryToScope(projectRoot, relativeDir, files, skippedRefs, maxFiles) {
  if (files.size >= maxFiles || shouldSkipScopePath(relativeDir)) {
    skippedRefs.add(relativeDir);
    return;
  }
  const absoluteDir = path.join(projectRoot, relativeDir);
  if (!fs.existsSync(absoluteDir) || !fs.lstatSync(absoluteDir).isDirectory()) {
    skippedRefs.add(relativeDir);
    return;
  }
  const stack = [absoluteDir];
  while (stack.length && files.size < maxFiles) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (files.size >= maxFiles) {
        break;
      }
      const absolute = path.join(current, entry.name);
      const relative = path.relative(projectRoot, absolute).split(path.sep).join("/");
      if (shouldSkipScopePath(relative)) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        files.add(relative);
      }
    }
  }
}

function buildReadScopeFromText(role, projectRoot, text, options = {}) {
  const maxFiles = options.maxFiles || DEFAULT_READ_SCOPE_MAX_FILES;
  const files = new Set();
  const blockedRefs = new Set();
  const skippedRefs = new Set();
  const proposedArtifacts = new Map();
  const artifactsByPath = new Map(normalizeProposedArtifacts(options.proposedArtifacts).map((artifact) => [
    artifact.relative_path,
    artifact
  ]));
  if (!options.existingRefsOnly && options.includeCommonFiles !== false) {
    for (const common of COMMON_PROJECT_FILES) {
      if (fs.existsSync(path.join(projectRoot, common))) {
        addFileToScope(projectRoot, common, files, skippedRefs);
      }
    }
  }
  if (options.includeAllProposedArtifacts) {
    for (const artifact of artifactsByPath.values()) {
      addProposedArtifactToScope(artifact, files, proposedArtifacts);
    }
  }
  const pathCandidates = options.existingRefsOnly
    ? existingCodeRefPaths(text)
    : collectPathCandidates(text);
  for (const candidate of pathCandidates) {
    const withoutLineRef = stripLineRefSuffix(candidate);
    if (artifactsByPath.has(withoutLineRef)) {
      addProposedArtifactToScope(artifactsByPath.get(withoutLineRef), files, proposedArtifacts);
      skippedRefs.delete(withoutLineRef);
      continue;
    }
    if (files.size >= maxFiles) {
      skippedRefs.add(candidate);
      continue;
    }
    const normalized = normalizeProjectRelativePath(projectRoot, candidate);
    if (!normalized) {
      continue;
    }
    if (normalized.blocked) {
      blockedRefs.add(normalized.blocked);
      continue;
    }
    if (!fs.existsSync(normalized.absolute)) {
      skippedRefs.add(normalized.relative);
      continue;
    }
    const stat = fs.lstatSync(normalized.absolute);
    if (stat.isDirectory()) {
      expandDirectoryToScope(projectRoot, normalized.relative, files, skippedRefs, maxFiles);
    } else if (stat.isFile()) {
      files.add(normalized.relative);
    } else {
      skippedRefs.add(normalized.relative);
    }
  }
  return {
    role,
    mode: "scoped_mirror",
    max_files: maxFiles,
    files: [...files].sort(),
    proposed_artifacts: [...proposedArtifacts.values()]
      .sort((a, b) => a.relative_path.localeCompare(b.relative_path))
      .map((artifact) => ({
        relative_path: artifact.relative_path,
        source_file: artifact.source_file || null,
        language: artifact.language || "",
        line_count: artifact.line_count || null,
        char_count: artifact.char_count || null,
        block_index: artifact.block_index || null,
        origin: artifact.origin || "plan_proposed_artifact",
        review_semantics: artifact.review_semantics || "plan_draft",
        expected_completeness: artifact.expected_completeness || "not_compile_target"
      })),
    blocked_refs: [...blockedRefs].sort(),
    skipped_refs: [...skippedRefs].filter((item) => !files.has(item)).sort()
  };
}

function buildRoleReadScope(role, projectRoot, plan, options = {}) {
  const scope = buildReadScopeFromText(role, projectRoot, plan, {
    ...options,
    includeAllProposedArtifacts: true,
    existingRefsOnly: true
  });
  scope.description = [
    "只暴露 Plan 的 Existing Code Refs 章节明确列出的现有工程文件；章节缺失或为 None 时不暴露现有工程文件，也不默认加入项目配置文件。",
    "Plan 其他章节提到但未列入 Existing Code Refs 的路径不会被复制。",
    "proposed-code 仅用于传输兼容和定位计划作者写下的未来代码，不是推荐 Plan 结构、现有工程事实或最终实现承诺。",
    "Reviewer 若需要未暴露文件，应写入 missing_questions，不应猜测。"
  ].join("");
  return scope;
}

function buildFactCheckReadScope(projectRoot, reviewerOutputs, options = {}) {
  const text = Object.values(reviewerOutputs || {}).flatMap((output) => (
    (Array.isArray(output?.issues) ? output.issues : [])
      .map((issue) => issue?.evidence)
      .filter((evidence) => typeof evidence === "string" && evidence.trim())
  )).join("\n");
  const scope = buildReadScopeFromText(FACT_CHECK_ROLE, projectRoot, text, {
    ...options,
    includeCommonFiles: false
  });
  scope.description = [
    "只暴露 Reviewer evidence 明确引用的工程文件。",
    "Fact Check 不应搜索新证据或新增问题。"
  ].join("");
  return scope;
}

function copyScopedWorkspace(projectRoot, readScope, workspaceParent) {
  const exposedRoot = path.join(workspaceParent, "project");
  fs.mkdirSync(exposedRoot, { recursive: true });
  const copied = [];
  const proposedByPath = new Map((readScope.proposed_artifacts || []).map((artifact) => [
    artifact.relative_path,
    artifact
  ]));
  for (const relative of readScope.files || []) {
    if (proposedByPath.has(relative)) {
      continue;
    }
    const source = path.join(projectRoot, relative);
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) {
      continue;
    }
    const destination = path.join(exposedRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    copied.push(relative);
  }
  for (const artifact of proposedByPath.values()) {
    const destination = path.join(exposedRoot, artifact.relative_path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (artifact.source_file && fs.existsSync(artifact.source_file)) {
      fs.copyFileSync(artifact.source_file, destination);
    } else if (artifact.content != null) {
      fs.writeFileSync(destination, String(artifact.content), "utf8");
    } else {
      continue;
    }
    copied.push(artifact.relative_path);
  }
  return {
    mode: "scoped_mirror",
    source_root: projectRoot,
    exposed_root: exposedRoot,
    files: copied.sort(),
    proposed_artifacts: (readScope.proposed_artifacts || []).map((artifact) => ({
      relative_path: artifact.relative_path,
      source_file: artifact.source_file || null,
      language: artifact.language || "",
      line_count: artifact.line_count || null,
      char_count: artifact.char_count || null,
      block_index: artifact.block_index || null,
      origin: artifact.origin || "plan_proposed_artifact",
      review_semantics: artifact.review_semantics || "plan_draft",
      expected_completeness: artifact.expected_completeness || "not_compile_target"
    })),
    blocked_refs: readScope.blocked_refs || [],
    skipped_refs: readScope.skipped_refs || []
  };
}

function readBoundarySection(readBoundary) {
  if (!readBoundary) {
    return "";
  }
  const files = readBoundary.files || [];
  const proposedArtifacts = readBoundary.proposed_artifacts || [];
  const blockedRefs = readBoundary.blocked_refs || [];
  const skippedRefs = readBoundary.skipped_refs || [];
  return [
    "## 读取边界",
    "",
    `模式：${readBoundary.mode || "prompt_only"}`,
    readBoundary.description ? `说明：${readBoundary.description}` : null,
    "只能将下列相对路径作为工程事实 evidence 来源；如果需要的文件不在列表中，写入 missing_questions，不要猜测。",
    files.length ? files.map((file) => `- ${file}`).join("\n") : "- （无可读取工程文件）",
    proposedArtifacts.length
      ? [
        "",
        "兼容保留的未来代码草案（仅说明计划文本设想，不得作为现有工程事实或实现完备性依据）：",
        ...proposedArtifacts.map((artifact) => (
          `- ${artifact.relative_path}:1-${artifact.line_count || "?"} ` +
          `(semantics=${artifact.review_semantics || "plan_draft"}, ` +
          `expected=${artifact.expected_completeness || "not_compile_target"})`
        ))
      ].join("\n")
      : null,
    blockedRefs.length
      ? ["", "已阻止的外部路径引用：", ...blockedRefs.map((item) => `- ${item}`)].join("\n")
      : null,
    skippedRefs.length
      ? ["", "未暴露或不存在的计划引用：", ...skippedRefs.slice(0, 20).map((item) => `- ${item}`)].join("\n")
      : null
  ].filter(Boolean).join("\n");
}

function compactList(values, limit = 8) {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length <= limit) {
    return unique;
  }
  return [
    ...unique.slice(0, limit),
    `... 另有 ${unique.length - limit} 项`
  ];
}

function extractCodeSignals(code) {
  const lines = code.split("\n");
  const declarations = [];
  const tests = [];
  const effects = [];
  const todos = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const declaration = trimmed.match(
      /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z0-9_$]+)/
    );
    if (declaration) {
      declarations.push(declaration[1]);
    }
    const test = trimmed.match(/^(?:test|it|describe)\((['"`])(.{1,120}?)\1/);
    if (test) {
      tests.push(test[2]);
    }
    if (
      /\b(await|return|throw|expect|send|goto|click|write|close|create|clear|emit)\b/.test(trimmed) &&
      trimmed.length <= 160
    ) {
      effects.push(trimmed.replace(/\s+/g, " "));
    }
    if (/TODO|FIXME|Expected:|Run:|Commit:/i.test(trimmed)) {
      todos.push(trimmed.replace(/\s+/g, " "));
    }
  }
  return {
    declarations: compactList(declarations),
    tests: compactList(tests),
    effects: compactList(effects, 10),
    todos: compactList(todos, 6)
  };
}

function codeBlockExtension(language) {
  const normalized = String(language || "").toLowerCase();
  return CODE_BLOCK_EXTENSION_BY_LANGUAGE[normalized] || ".txt";
}

function proposedArtifactForCodeBlock(language, code, blockIndex) {
  const extension = codeBlockExtension(language);
  const relativePath = path.join(
    PROPOSED_CODE_DIR,
    `block-${String(blockIndex).padStart(3, "0")}${extension}`
  ).split(path.sep).join("/");
  const content = String(code).endsWith("\n") ? String(code) : `${code}\n`;
  return {
    block_index: blockIndex,
    language: language || "code",
    relative_path: relativePath,
    line_count: content.split("\n").length - 1,
    char_count: content.length,
    origin: "compacted_code_block",
    review_semantics: "plan_draft",
    expected_completeness: "not_compile_target",
    content
  };
}

function compactCodeBlock(language, code, blockIndex, artifact = null) {
  const lines = code.split("\n");
  const signals = extractCodeSignals(code);
  const pseudo = [
    "```pseudo",
    `[压缩自 ${language || "code"} 代码块 #${blockIndex}：${lines.length} 行，${code.length} 字符]`,
    artifact
      ? `源码 artifact：${artifact.relative_path}:1-${artifact.line_count}`
      : null,
    artifact
      ? "用途：该 artifact 是从 plan 代码块拆出的草案证据，用于校验设计意图、接口契约和关键控制流；默认不是可直接编译的最终代码。"
      : "用途：保留审查语义，不作为可直接复制的实现代码。",
    artifact
      ? "完整性边界：除非 plan 明确声明该 artifact 必须原样落地，否则缺 import、局部类型导出、stub 函数体或示例变量未声明只能作为草案完整性提示，不能单独作为 blocker。"
      : null,
    "审查重点：接口契约、执行顺序、测试意图、错误处理和回滚边界。",
    signals.declarations.length
      ? `声明/入口：${signals.declarations.join(", ")}`
      : null,
    signals.tests.length
      ? `测试意图：${signals.tests.join("；")}`
      : null,
    signals.effects.length
      ? [
        "关键伪流程：",
        ...signals.effects.map((item, index) => `${index + 1}. ${item}`)
      ].join("\n")
      : "关键伪流程：根据该代码块前后的任务描述实现，避免逐字复制长代码。",
    signals.todos.length
      ? [
        "显式标记：",
        ...signals.todos.map((item) => `- ${item}`)
      ].join("\n")
      : null,
    "```"
  ].filter(Boolean).join("\n");
  return pseudo;
}

function compactPlanForReview(plan, options = {}) {
  const lineThreshold = options.lineThreshold || COMPACT_CODE_BLOCK_LINE_THRESHOLD;
  const charThreshold = options.charThreshold || COMPACT_CODE_BLOCK_CHAR_THRESHOLD;
  const originalPlan = String(plan);
  let codeBlocks = 0;
  let compactedBlocks = 0;
  let preservedBlocks = 0;
  let implementationDetailChars = 0;
  let implementationDetailLines = 0;
  const artifacts = [];
  const compacted = originalPlan.replace(
    /```([^\n`]*)\n([\s\S]*?)```/g,
    (match, rawLanguage, code) => {
      codeBlocks += 1;
      const language = String(rawLanguage || "").trim().split(/\s+/)[0].toLowerCase();
      const lineCount = code.split("\n").length;
      const shouldPreserve =
        PRESERVE_CODE_BLOCK_LANGS.has(language) ||
        (lineCount < lineThreshold && code.length < charThreshold);
      if (shouldPreserve) {
        preservedBlocks += 1;
        return match;
      }
      compactedBlocks += 1;
      implementationDetailChars += code.length;
      implementationDetailLines += lineCount;
      const artifact = proposedArtifactForCodeBlock(language, code, codeBlocks);
      artifacts.push(artifact);
      return compactCodeBlock(language, code, codeBlocks, artifact);
    }
  );
  const implementationDetailRatio = originalPlan.length
    ? Number((implementationDetailChars / originalPlan.length).toFixed(4))
    : 0;
  const originalLineCount = originalPlan.split("\n").length;
  const planBloatWarning =
    codeBlocks >= 6 ||
    compactedBlocks >= 3 ||
    implementationDetailChars >= 6000 ||
    implementationDetailRatio >= 0.25 ||
    originalLineCount >= 800;
  const header = compactedBlocks > 0
    ? [
      "> 审查输入说明：长代码块已压缩为非权威摘要，原始计划仍保存在 run 的 `request.json`。",
      "> 计划应做到决策完备，而不是实现完备。未来代码示例不能作为现有工程事实或最终实现承诺。",
      "> 自动抽取的 `proposed-code/` artifact 只是 legacy 传输兼容机制，不是推荐的 Plan 结构，也不表示代码应原样实现。",
      "> Reviewer 不得要求补全 import、props、函数体、JSX、mock 或测试源码；只审查业务、架构、公共契约、失败语义和阻塞决策。",
      planBloatWarning
        ? "> 计划膨胀提示：实现细节占比较高。仅当其淹没关键决策、引入未经确认的实现假设或造成契约矛盾时，才报告 plan_bloat。"
        : null,
      ""
    ].filter(Boolean).join("\n")
    : "";
  const text = `${header}${compacted}`;
  return {
    text,
    stats: {
      original_chars: originalPlan.length,
      compacted_chars: text.length,
      saved_chars: originalPlan.length - text.length,
      original_lines: originalLineCount,
      code_blocks: codeBlocks,
      compacted_blocks: compactedBlocks,
      preserved_blocks: preservedBlocks,
      implementation_detail_chars: implementationDetailChars,
      implementation_detail_lines: implementationDetailLines,
      implementation_detail_ratio: implementationDetailRatio,
      plan_bloat_warning: planBloatWarning,
      proposed_artifact_count: artifacts.length,
      proposed_artifact_chars: artifacts.reduce((sum, artifact) => sum + artifact.char_count, 0)
    },
    artifacts
  };
}

const ACCESS_NOTES = {
  reviewer: [
    "你可以使用 Read、Glob、Grep 只读检查该目录。不要修改文件，不要执行 Bash。",
    "涉及已存在代码的工程事实，evidence 必须包含现有工程文件的相对路径和行号。",
    "计划中的未来代码、伪代码和示例不是现有工程事实，也不是最终实现承诺；不要审查其源码完整性。",
    "判断标准是实现者能否在不重新做关键业务或架构决策的前提下开始编码，不是能否机械复制计划中的代码。",
    "找不到证据时放入 missing_questions。"
  ],
  fact_check: [
    "你只能使用 Read 读取 Reviewer evidence 明确引用的相对文件；不要使用 Glob/Grep 搜索新证据，不要发现新问题。",
    "Reviewer 未提供可定位文件、行号或片段时，将对应 claim 标记为 unverifiable 或 unsupported。",
    "未来代码、伪代码和示例只能证明计划文本写了什么，不能证明现有工程事实或最终实现；源码草案不完整不能单独支持 blocker。"
  ],
  synthesis: [
    "本角色不得读取工程目录，也不会获得工程读取工具；只能基于待评审计划、Reviewer 意见和 Fact Check 报告合成结论。",
    "涉及工程事实的结论必须遵从 Fact Check 状态；不要补充任何来源都未提出的新事实。"
  ]
};

function workspaceReviewInput(projectRoot, plan, context = "", accessMode = "reviewer", readBoundary = null) {
  const accessNotes = ACCESS_NOTES[accessMode] || ACCESS_NOTES.reviewer;
  return [
    "# 工程评审输入",
    "",
    "## 工程目录",
    "",
    `\`${projectRoot}\``,
    "",
    ...accessNotes,
    "",
    readBoundarySection(readBoundary),
    "",
    "## 待评审计划",
    "",
    plan.trim(),
    context.trim() ? `\n## 补充上下文\n\n${context.trim()}` : ""
  ].filter(Boolean).join("\n");
}

function reviewerIssueIds(reviewerOutputs = {}) {
  return Object.entries(reviewerOutputs).flatMap(([source, output]) => {
    const issues = Array.isArray(output?.issues) ? output.issues : [];
    return issues.map((issue, index) => ({
      issue_id: `${slug(source)}-${String(index + 1).padStart(3, "0")}`,
      source,
      issue_title: String(issue?.title || ""),
      reviewer_issue_index: index
    }));
  });
}

function buildWorkspacePrompt(
  role,
  projectRoot,
  plan,
  context = "",
  reviewerOutputs = null,
  factCheckOutput = null,
  readBoundary = null
) {
  assertWorkspaceRole(role);
  const templateFile = path.join(ROOT, "prompts", `probe-${role}.md`);
  let template = readText(templateFile);
  if (role === "rebuttal") {
    template = template
      .replace(
        "下面这个方案已经被专家认可。请你仍然独立审查它是否存在问题。",
        "请在不受其他 Reviewer 结论影响的前提下，独立审查下面的计划是否存在问题。"
      )
      .replace(
        "- 不要因为“专家认可”就默认方案正确。\n",
        "- 不要因为计划来自当前 Claude Code 会话就默认方案正确。\n"
      );
  }
  if (role === "synthesis") {
    template = template.replace("请阅读下面三组审查意见", "请阅读下面多组审查意见");
    const sourceSections = Object.entries(reviewerOutputs || {}).map(([source, output]) => [
      `## ${source}`,
      "",
      "```json",
      JSON.stringify(output, null, 2),
      "```"
    ].join("\n")).join("\n\n");
    const factCheckSection = factCheckOutput
      ? [
        "# Fact Check 报告",
        "",
        "```json",
        JSON.stringify(factCheckOutput, null, 2),
        "```"
      ].join("\n")
      : "";
    const input = [
      workspaceReviewInput(projectRoot, plan, context, "synthesis", readBoundary),
      "",
      "# Reviewer 意见",
      "",
      sourceSections,
      factCheckSection ? "\n" + factCheckSection : ""
    ].join("\n");
    return template.replace("{{INPUT}}", input);
  }
  if (role === FACT_CHECK_ROLE) {
    const issueIds = reviewerIssueIds(reviewerOutputs);
    const sourceSections = Object.entries(reviewerOutputs || {}).map(([source, output]) => [
      `## ${source}`,
      "",
      "```json",
      JSON.stringify(output, null, 2),
      "```"
    ].join("\n")).join("\n\n");
    const input = [
      workspaceReviewInput(projectRoot, plan, context, "fact_check", readBoundary),
      "",
      "# Reviewer Issue IDs",
      "",
      "输出 `checked_issues` 时必须使用下列 `issue_id` 作为匹配主键；`source` 与 `issue_title` 也必须与这里逐字一致。",
      "",
      "```json",
      JSON.stringify(issueIds, null, 2),
      "```",
      "",
      "# Reviewer 意见",
      "",
      sourceSections
    ].join("\n");
    return template.replace("{{INPUT}}", input);
  }
  return template.replace("{{INPUT}}", workspaceReviewInput(projectRoot, plan, context, "reviewer", readBoundary));
}

function workspaceSchemaForRole(role) {
  assertWorkspaceRole(role);
  if (role === FACT_CHECK_ROLE) {
    return path.join(ROOT, "schemas", "fact-check-output.schema.json");
  }
  return schemaForProbe(role);
}

function buildClaudeWorkspaceArgs(config, model, role, projectRoot, options = {}) {
  const modelConfig = config.models[model];
  if (!modelConfig) {
    throw new Error(`No validated model configuration for "${model}"`);
  }
  const tools = options.tools === undefined ? "Read,Glob,Grep" : options.tools;
  const allowProjectRead = options.allowProjectRead !== false;
  const validatorLogFile = options.validatorLogFile;
  if (!validatorLogFile) {
    throw new Error(`Missing validator log file for workspace role "${role}"`);
  }
  const schemaFile = workspaceSchemaForRole(role);
  const rolePrompt = options.systemPrompt || (
    allowProjectRead
      ? "You are a non-interactive plan review agent. Inspect only the provided project directory. Never modify files or execute shell commands. Return only one raw JSON object that conforms to the provided schema; no prose before or after JSON."
      : "You are a non-interactive plan review synthesis agent. Do not inspect project files, modify files, or execute shell commands. Return only one raw JSON object that conforms to the provided schema; no prose before or after JSON."
  );
  const systemPrompt = [
    rolePrompt,
    "Before the final answer, call mcp__json_validator__validate_json_output with the exact raw JSON candidate.",
    "If validation fails, correct the candidate and validate it again. Return the validated raw JSON only."
  ].join(" ");
  const allowedTools = [tools, JSON_VALIDATOR_TOOL].filter(Boolean).join(",");
  const args = [
    "--settings",
    modelConfig.settings_file,
    "--bare",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--tools",
    tools,
    "--allowed-tools",
    allowedTools,
    "--mcp-config",
    JSON.stringify({
      mcpServers: {
        json_validator: {
          type: "stdio",
          command: process.execPath,
          args: [path.join(ROOT, "scripts", "json-validator-mcp.js")],
          env: {
            MODEL_ROLE_CALIBRATION_SCHEMA_FILE: schemaFile,
            MODEL_ROLE_CALIBRATION_VALIDATOR_LOG: validatorLogFile,
            MODEL_ROLE_CALIBRATION_ATTEMPT: options.attemptLabel || `workspace-${role}`,
            MODEL_ROLE_CALIBRATION_MODEL: model,
            MODEL_ROLE_CALIBRATION_PROBE: role
          },
          alwaysLoad: true,
          timeout: 10000
        }
      }
    }),
    "--no-chrome",
    "--permission-mode",
    "dontAsk",
    "--system-prompt",
    systemPrompt,
    "--input-format",
    "text",
    "--output-format",
    "stream-json",
    "--json-schema",
    JSON.stringify(parseJsonFile(schemaFile)),
    "--max-turns",
    String(config.execution.max_turns)
  ];
  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  } else if (options.sessionId) {
    args.push("--session-id", options.sessionId);
  }
  if (options.sessionName) {
    args.push("--name", options.sessionName);
  }
  if (allowProjectRead) {
    args.push("--add-dir", projectRoot);
  }
  args.push("-p");
  return args;
}

function runDirectory(config, runId) {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new Error(`Invalid workspace review run id: ${runId}`);
  }
  return path.join(config.workspace_runs_dir, runId);
}

function executionLogPath(runDir) {
  return path.join(runDir, "execution.log");
}

function appendExecutionLog(runDir, event, details = {}) {
  const fields = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  fs.appendFileSync(
    executionLogPath(runDir),
    `[${new Date().toISOString()}] ${event}${fields ? ` ${fields}` : ""}\n`,
    "utf8"
  );
}

function updateState(runDir, patch) {
  const stateFile = path.join(runDir, "state.json");
  let current = {};
  if (fs.existsSync(stateFile)) {
    current = parseJsonFile(stateFile);
  }
  const next = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString()
  };
  writeGenerated(stateFile, JSON.stringify(next, null, 2) + "\n");
  return next;
}

function redactedSettingsWarnings(config) {
  const warnings = [];
  for (const [model, value] of Object.entries(config.models)) {
    const mode = fs.statSync(value.settings_file).mode & 0o777;
    if (mode & 0o077) {
      warnings.push(
        `${model} settings file is readable by group or others; run chmod 600 ${value.settings_file}`
      );
    }
  }
  return warnings;
}

function withoutAnthropicApiKey(env = process.env) {
  const sanitized = {};
  for (const key of Object.keys(env)) {
    if (key === "ANTHROPIC_API_KEY") {
      continue;
    }
    sanitized[key] = env[key];
  }
  return sanitized;
}

module.exports = {
  REVIEW_ROLES,
  FACT_CHECK_ROLE,
  SYNTHESIS_ROLE,
  JSON_VALIDATOR_TOOL,
  MAX_EXECUTOR_RETRIES,
  WORKSPACE_ROLES,
  REQUIRED_ROLES,
  DEFAULT_MODEL_FILES,
  DEFAULT_ROLE_ROUTE_SOURCE,
  DEFAULT_ROLE_ROUTES,
  assertWorkspaceRole,
  expandHome,
  resolveConfiguredPath,
  validateSettingsFile,
  validateClaudeBinary,
  loadWorkspaceReviewConfig,
  loadWorkspaceReviewSettingsDirectory,
  loadWorkspaceReviewFromArgs,
  configSummary,
  validateProjectRoot,
  buildRoleReadScope,
  buildFactCheckReadScope,
  copyScopedWorkspace,
  compactPlanForReview,
  createPlanReferenceManifest,
  workspaceReviewInput,
  buildWorkspacePrompt,
  workspaceSchemaForRole,
  buildClaudeWorkspaceArgs,
  runDirectory,
  executionLogPath,
  appendExecutionLog,
  updateState,
  redactedSettingsWarnings,
  withoutAnthropicApiKey
};
