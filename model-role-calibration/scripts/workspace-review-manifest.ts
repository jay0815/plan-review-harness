import * as crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { type JsonValue, ROOT, writeGenerated } from './lib.js'

type MutableJsonObject = Record<string, unknown>

interface ExecutionLogEvent {
  at: string
  event: string
  details: MutableJsonObject
}

interface SkippedHashFile {
  path: string
  reason: string
  size_bytes: number
}

interface DeclaredRuntime extends MutableJsonObject {
  route_profile: MutableJsonObject & {
    effective_roles: Record<string, unknown>
  }
}

interface ResolvedExecutionRecord extends MutableJsonObject {
  model?: string | null
  latest_status?: string | null
  output_hash: string
}

interface RunManifest extends MutableJsonObject {
  run_id: string
  status: string
  inputs: MutableJsonObject
  declared_runtime: DeclaredRuntime
  resolved_execution: Record<string, ResolvedExecutionRecord>
  artifacts: MutableJsonObject
}

function objectValue(value: unknown): MutableJsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as MutableJsonObject) : {}
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

interface ManifestOptions {
  createdAt?: string
  force?: boolean
}

interface ExecutionMetadata {
  role?: string
  model?: string
  status?: string
  prompt_file?: string
  schema_file?: string
  settings_file?: string
  started_at?: string
  finished_at?: string
  exit_code?: number | null
  signal?: string | null
  timed_out?: boolean
  failure_kind?: string
  error?: string | null
  fallback_from?: string
  invalid_output_file?: string
  validator_log_file?: string
  fact_check_summary_file?: string
  allowed_tools?: string[]
  read_boundary?: {
    read_scope_file?: string
  }
}

interface ExecutionExtra {
  status?: string
  metadata_file?: string
  failure_kind?: string
  error?: string
  fallback_from?: string
}

const MANIFEST_FILE = 'run-manifest.json'
const DEFAULT_ROUTE_FILE = path.join(ROOT, 'default-role-routes.json')
const WORKSPACE_REVIEW_ROLES = ['risk', 'architecture', 'execution', 'rebuttal', 'fact_check', 'synthesis']
const MAX_UNTRACKED_HASH_FILES = 200
const MAX_UNTRACKED_HASH_BYTES = 5 * 1024 * 1024
const ATTEMPT_ARTIFACT_FIELDS = [
  'metadata_file',
  'prompt_file',
  'output_file',
  'invalid_output_file',
  'stdout_file',
  'stderr_file',
  'validator_log_file',
  'fact_check_summary_file',
  'read_scope_file',
]

function sha256(value: string | Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`
}

function stable(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(stable)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    )
  }
  return value
}

function stableJson(value: JsonValue): string {
  return JSON.stringify(stable(value))
}

function hashJson(value: JsonValue): string {
  return sha256(stableJson(value))
}

function hashText(value: unknown): string {
  return sha256(String(value || ''))
}

function hashFileIfExists(file: string | null | undefined): string | null {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return null
  }
  return sha256(fs.readFileSync(file))
}

function readJsonIfExists<T = MutableJsonObject>(file: string): T | null {
  if (!fs.existsSync(file)) {
    return null
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

function writeJson(file: string, value: unknown) {
  writeGenerated(file, JSON.stringify(value, null, 2) + '\n')
}

function manifestPath(runDir: string): string {
  return path.join(runDir, MANIFEST_FILE)
}

function requireRunManifest(runDir: string): RunManifest {
  const file = manifestPath(runDir)
  if (!fs.existsSync(file)) {
    throw new Error(`Missing required run manifest: ${file}`)
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RunManifest
}

function git(projectRoot: string, args: string[], options: { trim?: boolean } = {}): string | null {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.error || result.status !== 0) {
    return null
  }
  const stdout = String(result.stdout || '')
  return options.trim === false ? stdout : stdout.trim()
}

function hashUntrackedFiles(projectRoot: string) {
  const output = git(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z'], {
    trim: false,
  })
  if (!output) {
    return {
      hashes: {},
      skipped: [],
    }
  }
  const hashes: Record<string, string | null> = {}
  const skipped: SkippedHashFile[] = []
  const relativePaths = output.split('\0').filter(Boolean).sort()
  for (const relativePath of relativePaths) {
    const absolute = path.join(projectRoot, relativePath)
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      continue
    }
    const stat = fs.statSync(absolute)
    if (Object.keys(hashes).length >= MAX_UNTRACKED_HASH_FILES) {
      skipped.push({
        path: relativePath,
        reason: 'file_count_limit',
        size_bytes: stat.size,
      })
      continue
    }
    if (stat.size > MAX_UNTRACKED_HASH_BYTES) {
      skipped.push({
        path: relativePath,
        reason: 'file_size_limit',
        size_bytes: stat.size,
      })
      continue
    }
    hashes[relativePath] = hashFileIfExists(absolute)
  }
  return {
    hashes,
    skipped,
    limits: {
      max_files: MAX_UNTRACKED_HASH_FILES,
      max_file_bytes: MAX_UNTRACKED_HASH_BYTES,
    },
  }
}

function workspaceSnapshot(projectRoot: string) {
  const root = path.resolve(projectRoot)
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true'
  if (!inside) {
    return {
      project_root: root,
      git_available: false,
      git_head: null,
      dirty: null,
      dirty_files: [],
      dirty_patch_hash: null,
    }
  }
  const statusText = git(root, ['status', '--porcelain=v1']) || ''
  const dirtyEntries = statusText.split('\n').filter(Boolean)
  const diffText = git(root, ['diff', '--binary', 'HEAD', '--']) || ''
  const untracked = hashUntrackedFiles(root)
  return {
    project_root: root,
    git_available: true,
    git_head: git(root, ['rev-parse', 'HEAD']),
    dirty: dirtyEntries.length > 0,
    dirty_files: dirtyEntries.map((line: string) => line.slice(3)),
    dirty_entries: dirtyEntries,
    untracked_file_hashes: untracked.hashes,
    untracked_file_hash_skipped: untracked.skipped,
    untracked_file_hash_limits: untracked.limits,
    dirty_patch_hash: dirtyEntries.length
      ? sha256(
          [statusText, diffText, stableJson(untracked as unknown as JsonValue)].join(
            '\n--- dirty patch components ---\n',
          ),
        )
      : null,
  }
}

function workspacePromptFile(role: string): string {
  return path.join(ROOT, 'prompts', `probe-${role}.md`)
}

function workspaceSchemaFile(role: string): string {
  if (role === 'fact_check') {
    return path.join(ROOT, 'schemas', 'fact-check-output.schema.json')
  }
  return path.join(ROOT, 'schemas', `${role}-output.schema.json`)
}

function hashFilesByRole(roles: string[], resolver: (role: string) => string) {
  const items: Record<string, { path: string; hash: string | null }> = {}
  for (const role of roles) {
    const file = resolver(role)
    items[role] = {
      path: path.relative(ROOT, file),
      hash: hashFileIfExists(file),
    }
  }
  return {
    hash: hashJson(items),
    files: items,
  }
}

function declaredRuntime(config: MutableJsonObject, roles: string[]): DeclaredRuntime {
  const runtimeRoles = [...new Set([...roles, 'fact_check', 'synthesis'])].filter((role) =>
    WORKSPACE_REVIEW_ROLES.includes(role),
  )
  const promptSet = hashFilesByRole(runtimeRoles, workspacePromptFile)
  const schemaSet = hashFilesByRole(runtimeRoles, workspaceSchemaFile)
  const routePath = stringValue(config.config_file, DEFAULT_ROUTE_FILE)
  const routeProfile: DeclaredRuntime['route_profile'] = {
    path: path.relative(ROOT, routePath),
    hash: hashJson(config.roles as JsonValue),
    source_file_hash: hashFileIfExists(routePath),
    effective_roles: objectValue(config.roles),
  }
  const defaultRoute = readJsonIfExists<{ source?: unknown }>(DEFAULT_ROUTE_FILE)
  if (!config.config_file && defaultRoute?.source) {
    routeProfile.approval_ref = defaultRoute.source
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
    claude_version: config.claude_version || null,
  }
}

function parseExecutionLogFields(text: string) {
  const details: MutableJsonObject = {}
  const fieldPattern = /(\w+)=("(?:\\.|[^"])*"|\[[^\]]*\]|\{[^}]*\}|[^\s]+)/g
  let field
  while ((field = fieldPattern.exec(text || '')) !== null) {
    try {
      details[field[1]] = JSON.parse(field[2])
    } catch {
      details[field[1]] = field[2]
    }
  }
  return details
}

function executionLogEvents(runDir: string): ExecutionLogEvent[] {
  const file = path.join(runDir, 'execution.log')
  if (!fs.existsSync(file)) {
    return []
  }
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line: string) => {
      const match = /^\[([^\]]+)\]\s+(\S+)(?:\s+(.*))?$/.exec(line)
      if (!match) {
        return null
      }
      return {
        at: match[1],
        event: match[2],
        details: parseExecutionLogFields(match[3] || ''),
      }
    })
    .filter((event): event is ExecutionLogEvent => Boolean(event))
}

function existingArtifact(runDir: string, file: string): string | null {
  if (!file || !fs.existsSync(path.join(runDir, file))) {
    return null
  }
  return file
}

function activeRunRoles(request: MutableJsonObject, state: MutableJsonObject): string[] {
  const reviewers =
    Array.isArray(request?.roles) && request.roles.length
      ? request.roles.filter((role): role is string => typeof role === 'string')
      : Array.isArray(state?.roles) && state.roles.length
        ? state.roles.filter((role): role is string => typeof role === 'string')
        : ['risk', 'architecture', 'execution', 'rebuttal']
  return [...new Set<string>([...reviewers, 'fact_check', 'synthesis'])].filter((role) =>
    WORKSPACE_REVIEW_ROLES.includes(role),
  )
}

function roleMetadata(runDir: string, role: string): ExecutionMetadata | null {
  return readJsonIfExists<ExecutionMetadata>(path.join(runDir, 'roles', role, 'metadata.json'))
}

function inferredRoleRoutes(runDir: string, roles: string[]) {
  const defaultRoute = readJsonIfExists<{ routes?: Record<string, string> }>(DEFAULT_ROUTE_FILE)
  const routes: Record<string, string> = {
    ...(defaultRoute?.routes || {}),
  }
  for (const role of roles) {
    const metadata = roleMetadata(runDir, role)
    if (metadata?.model) {
      routes[role] = metadata.model
    }
  }
  return routes
}

function inferredExecution(runDir: string) {
  const started = executionLogEvents(runDir).find((item) => item.event === 'run_started')
  return {
    max_concurrency: started?.details?.max_concurrency ?? null,
    timeout_ms: null,
    max_buffer_bytes: null,
    max_turns: null,
    compact_plan: fs.existsSync(path.join(runDir, 'plan-compaction.json')) ? true : null,
    isolate_reviewers: null,
    read_scope_max_files: null,
    backfilled_from: 'legacy-run-artifacts',
  }
}

function backfillConfig(runDir: string, roles: string[]) {
  return {
    config_file: null,
    roles: inferredRoleRoutes(runDir, roles),
    execution: inferredExecution(runDir),
    claude_bin: null,
    claude_version: null,
  }
}

function backfillRunManifest(runDir: string, options: ManifestOptions = {}) {
  const absoluteRunDir = path.resolve(runDir)
  const file = manifestPath(absoluteRunDir)
  if (fs.existsSync(file) && !options.force) {
    throw new Error(`Refusing to overwrite existing run manifest: ${file}`)
  }
  const request = readJsonIfExists(path.join(absoluteRunDir, 'request.json'))
  const state = readJsonIfExists(path.join(absoluteRunDir, 'state.json'))
  if (!request || !state) {
    throw new Error(`Cannot backfill run manifest without request.json and state.json: ${absoluteRunDir}`)
  }
  const roles = activeRunRoles(request, state)
  const createdAt = request.created_at || state.created_at || new Date().toISOString()
  const updatedAt = state.finished_at || state.updated_at || createdAt
  const status = state.status || 'created'
  const config = backfillConfig(absoluteRunDir, roles)
  const reviewPlanRefs = readJsonIfExists(path.join(absoluteRunDir, 'review-plan-refs.json'))
  const manifest = {
    version: 1,
    run_id: request.run_id || state.run_id || path.basename(absoluteRunDir),
    status,
    created_at: createdAt,
    updated_at: updatedAt,
    ...(state.finished_at ? { finished_at: state.finished_at } : {}),
    workspace: workspaceSnapshot(stringValue(request.project_root || state.project_root, absoluteRunDir)),
    inputs: {
      plan: {
        path: request.plan_file || null,
        hash: hashText(request.plan || ''),
      },
      context_hash: request.context ? hashText(request.context) : null,
      review_plan: existingArtifact(absoluteRunDir, 'review-plan.md')
        ? {
            path: 'review-plan.md',
            hash: hashFileIfExists(path.join(absoluteRunDir, 'review-plan.md')),
          }
        : null,
      review_plan_refs_hash: reviewPlanRefs ? hashJson(reviewPlanRefs as unknown as JsonValue) : null,
    },
    declared_runtime: declaredRuntime(config, roles),
    resolved_execution: {},
    artifacts: {
      request: existingArtifact(absoluteRunDir, 'request.json'),
      state: existingArtifact(absoluteRunDir, 'state.json'),
      review_plan: existingArtifact(absoluteRunDir, 'review-plan.md'),
      plan_compaction: existingArtifact(absoluteRunDir, 'plan-compaction.json'),
      review_plan_refs: existingArtifact(absoluteRunDir, 'review-plan-refs.json'),
      plan_authoring_lint: existingArtifact(absoluteRunDir, 'plan-authoring-lint.json'),
      report: existingArtifact(absoluteRunDir, 'report.json'),
      backfilled_from: 'legacy-run-artifacts',
    },
  }
  writeJson(file, manifest)
  for (const role of roles) {
    const metadata = roleMetadata(absoluteRunDir, role)
    if (metadata) {
      recordResolvedExecution(absoluteRunDir, metadata, {
        status: metadata.status,
        metadata_file: path.join('roles', role, 'metadata.json'),
      })
    }
  }
  return requireRunManifest(absoluteRunDir)
}

function createRunManifest(
  config: MutableJsonObject,
  request: MutableJsonObject,
  runDir: string,
  options: ManifestOptions = {},
) {
  const file = manifestPath(runDir)
  if (fs.existsSync(file)) {
    throw new Error(`Refusing to overwrite existing run manifest: ${file}`)
  }
  const roles =
    Array.isArray(request.roles) && request.roles.length
      ? request.roles
      : ['risk', 'architecture', 'execution', 'rebuttal']
  const createdAt = options.createdAt || request.created_at || new Date().toISOString()
  const manifest = {
    version: 1,
    run_id: request.run_id,
    status: 'created',
    created_at: createdAt,
    updated_at: createdAt,
    workspace: workspaceSnapshot(stringValue(request.project_root, runDir)),
    inputs: {
      plan: {
        path: request.plan_file || null,
        hash: hashText(request.plan),
      },
      context_hash: request.context ? hashText(request.context) : null,
      review_plan: null,
      review_plan_refs_hash: null,
    },
    declared_runtime: declaredRuntime(config, roles),
    resolved_execution: {},
    artifacts: {
      request: 'request.json',
      state: 'state.json',
    },
  }
  writeJson(file, manifest)
  return manifest
}

function updateRunManifest(
  runDir: string,
  updater: MutableJsonObject | ((current: RunManifest) => MutableJsonObject),
): RunManifest {
  const file = manifestPath(runDir)
  const current = requireRunManifest(runDir)
  const patch = typeof updater === 'function' ? updater(current) : updater
  const next = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  }
  writeJson(file, next)
  return next as RunManifest
}

function markManifestRunning(runDir: string, request: MutableJsonObject) {
  const reviewPlanFile = path.join(runDir, 'review-plan.md')
  return updateRunManifest(runDir, (current) => {
    const inputs = objectValue(current.inputs)
    const artifacts = objectValue(current.artifacts)
    return {
      status: 'running',
      inputs: {
        ...inputs,
        review_plan: {
          path: 'review-plan.md',
          hash: hashFileIfExists(reviewPlanFile) || hashText(request.review_plan || request.plan),
        },
        review_plan_refs_hash: request.review_plan_refs
          ? hashJson(request.review_plan_refs as JsonValue)
          : inputs.review_plan_refs_hash,
      },
      artifacts: {
        ...artifacts,
        review_plan: 'review-plan.md',
        plan_compaction: 'plan-compaction.json',
        review_plan_refs: 'review-plan-refs.json',
        plan_authoring_lint: 'plan-authoring-lint.json',
      },
    }
  })
}

function relativeFromRun(runDir: string, file: string | null | undefined): string | null {
  if (!file) {
    return null
  }
  return path.isAbsolute(file) ? path.relative(runDir, file) : file
}

function absoluteFromRun(runDir: string, file: string | null | undefined): string | null {
  if (!file) {
    return null
  }
  return path.isAbsolute(file) ? file : path.join(runDir, file)
}

function promptHash(runDir: string, metadata: ExecutionMetadata): string | null {
  return hashFileIfExists(absoluteFromRun(runDir, metadata.prompt_file))
}

function schemaHash(metadata: ExecutionMetadata, role: string): string | null {
  const schemaFile = metadata.schema_file ? path.join(ROOT, metadata.schema_file) : workspaceSchemaFile(role)
  return hashFileIfExists(schemaFile)
}

function readScopeHash(runDir: string, metadata: ExecutionMetadata): string | null {
  return hashFileIfExists(absoluteFromRun(runDir, metadata.read_boundary?.read_scope_file))
}

function outputHash(runDir: string, role: string): string | null {
  return hashFileIfExists(path.join(runDir, 'roles', role, 'output.json'))
}

function existingRelativeFile(runDir: string, file: string | null | undefined): string | null {
  const relative = relativeFromRun(runDir, file)
  if (!relative) {
    return null
  }
  const absolute = absoluteFromRun(runDir, relative)
  return absolute && fs.existsSync(absolute) ? relative : null
}

function roleFileIfExists(runDir: string, role: string, fileName: string): string | null {
  return existingRelativeFile(runDir, path.join('roles', role, fileName))
}

function attemptArtifactPaths(runDir: string, metadata: ExecutionMetadata, role: string, extra: ExecutionExtra = {}) {
  return {
    metadata_file: existingRelativeFile(runDir, extra.metadata_file || path.join('roles', role, 'metadata.json')),
    prompt_file: existingRelativeFile(runDir, metadata.prompt_file),
    output_file: roleFileIfExists(runDir, role, 'output.json'),
    invalid_output_file: existingRelativeFile(runDir, metadata.invalid_output_file),
    stdout_file: roleFileIfExists(runDir, role, 'stdout.jsonl'),
    stderr_file: roleFileIfExists(runDir, role, 'stderr.log'),
    validator_log_file: existingRelativeFile(runDir, metadata.validator_log_file),
    fact_check_summary_file: existingRelativeFile(runDir, metadata.fact_check_summary_file),
    read_scope_file: existingRelativeFile(runDir, metadata.read_boundary?.read_scope_file),
  }
}

function normalizeRelPath(file: string): string {
  return String(file || '')
    .replace(/\\/g, '/')
    .split(path.sep)
    .join('/')
}

function relocateRolePath(
  file: string | null | undefined,
  role: string,
  archivedRoleDir: string,
): string | null | undefined {
  if (!file) {
    return file
  }
  const normalizedFile = normalizeRelPath(file)
  const activePrefix = `roles/${role}/`
  if (!normalizedFile.startsWith(activePrefix)) {
    return file
  }
  const archivedPrefix = normalizeRelPath(archivedRoleDir).replace(/\/$/, '')
  return `${archivedPrefix}/${normalizedFile.slice(activePrefix.length)}`
}

function relocateAttemptArtifacts(attempt: MutableJsonObject, role: string, archivedRoleDir: string) {
  const next: MutableJsonObject = {
    ...attempt,
    archived_as: archivedRoleDir,
  }
  for (const field of ATTEMPT_ARTIFACT_FIELDS) {
    const value = next[field]
    next[field] = relocateRolePath(typeof value === 'string' ? value : null, role, archivedRoleDir)
  }
  return next
}

function recordResolvedExecution(runDir: string, metadata: ExecutionMetadata, extra: ExecutionExtra = {}) {
  const role = metadata.role
  if (!role) {
    throw new Error('Cannot record resolved execution without role')
  }
  return updateRunManifest(runDir, (current) => {
    const resolvedExecution = objectValue(current.resolved_execution)
    const previous = objectValue(resolvedExecution[role])
    const history = Array.isArray(previous.attempt_history) ? previous.attempt_history.filter(objectValue) : []
    const artifactPaths = attemptArtifactPaths(runDir, metadata, role, extra)
    const attempt = {
      attempt_index: history.length + 1,
      status: extra.status || metadata.status || null,
      adapter: 'claude-code',
      provider: 'claude-code-wrapper',
      model: metadata.model || null,
      prompt_hash: promptHash(runDir, metadata),
      schema_hash: schemaHash(metadata, role),
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
      ...artifactPaths,
    }
    const nextHistory = [...history, attempt]
    return {
      resolved_execution: {
        ...resolvedExecution,
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
          attempt_history: nextHistory,
        },
      },
    }
  })
}

function archiveResolvedExecutionAttempt(runDir: string, role: string, archivedRoleDir: string | null | undefined) {
  if (!archivedRoleDir) {
    return null
  }
  return updateRunManifest(runDir, (current) => {
    const resolvedExecution = objectValue(current.resolved_execution)
    const roleExecution = objectValue(resolvedExecution[role])
    if (!Object.keys(roleExecution).length) {
      return {}
    }
    const history = Array.isArray(roleExecution.attempt_history)
      ? roleExecution.attempt_history.filter(objectValue)
      : []
    if (!history.length) {
      return {}
    }
    const latestIndex = history.length - 1
    const relocatedLatest = relocateAttemptArtifacts(history[latestIndex], role, archivedRoleDir)
    const nextHistory = history.map((attempt, index) => (index === latestIndex ? relocatedLatest : attempt))
    const nextRoleExecution: MutableJsonObject = {
      ...roleExecution,
      archived_as: archivedRoleDir,
      attempt_history: nextHistory,
    }
    for (const field of ATTEMPT_ARTIFACT_FIELDS) {
      nextRoleExecution[field] = relocatedLatest[field] ?? nextRoleExecution[field] ?? null
    }
    return {
      resolved_execution: {
        ...resolvedExecution,
        [role]: nextRoleExecution,
      },
    }
  })
}

function markManifestFinished(runDir: string, status: string, patch: MutableJsonObject = {}) {
  return updateRunManifest(runDir, (current) => {
    const artifacts = objectValue(current.artifacts)
    return {
      ...patch,
      status,
      finished_at: new Date().toISOString(),
      artifacts: {
        ...artifacts,
        report: fs.existsSync(path.join(runDir, 'report.json')) ? 'report.json' : artifacts.report,
      },
    }
  })
}

export {
  MANIFEST_FILE,
  manifestPath,
  requireRunManifest,
  createRunManifest,
  updateRunManifest,
  markManifestRunning,
  markManifestFinished,
  recordResolvedExecution,
  archiveResolvedExecutionAttempt,
  backfillRunManifest,
  hashText,
  hashJson,
  hashFileIfExists,
  workspaceSnapshot,
}
