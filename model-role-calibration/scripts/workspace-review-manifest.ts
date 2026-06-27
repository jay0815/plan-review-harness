import * as crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { ROOT, writeGenerated } from './lib.js'

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

function sha256(value: any) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`
}

function stable(value: any): any {
  if (Array.isArray(value)) {
    return value.map(stable)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key: any) => [key, stable(value[key])]),
    )
  }
  return value
}

function stableJson(value: any) {
  return JSON.stringify(stable(value))
}

function hashJson(value: any) {
  return sha256(stableJson(value))
}

function hashText(value: any) {
  return sha256(String(value || ''))
}

function hashFileIfExists(file: any) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return null
  }
  return sha256(fs.readFileSync(file))
}

function readJsonIfExists(file: any) {
  if (!fs.existsSync(file)) {
    return null
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file: any, value: any) {
  writeGenerated(file, JSON.stringify(value, null, 2) + '\n')
}

function manifestPath(runDir: any) {
  return path.join(runDir, MANIFEST_FILE)
}

function requireRunManifest(runDir: any) {
  const file = manifestPath(runDir)
  if (!fs.existsSync(file)) {
    throw new Error(`Missing required run manifest: ${file}`)
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function git(projectRoot: any, args: any, options: any = {}) {
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

function hashUntrackedFiles(projectRoot: any) {
  const output = git(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z'], {
    trim: false,
  })
  if (!output) {
    return {
      hashes: {},
      skipped: [],
    }
  }
  const hashes: Record<string, any> = {}
  const skipped: any[] = []
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

function workspaceSnapshot(projectRoot: any) {
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
    dirty_files: dirtyEntries.map((line: any) => line.slice(3)),
    dirty_entries: dirtyEntries,
    untracked_file_hashes: untracked.hashes,
    untracked_file_hash_skipped: untracked.skipped,
    untracked_file_hash_limits: untracked.limits,
    dirty_patch_hash: dirtyEntries.length
      ? sha256([statusText, diffText, stableJson(untracked)].join('\n--- dirty patch components ---\n'))
      : null,
  }
}

function workspacePromptFile(role: any) {
  return path.join(ROOT, 'prompts', `probe-${role}.md`)
}

function workspaceSchemaFile(role: any) {
  if (role === 'fact_check') {
    return path.join(ROOT, 'schemas', 'fact-check-output.schema.json')
  }
  return path.join(ROOT, 'schemas', `${role}-output.schema.json`)
}

function hashFilesByRole(roles: any, resolver: any) {
  const items: Record<string, any> = {}
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

function declaredRuntime(config: any, roles: any) {
  const runtimeRoles = [...new Set([...roles, 'fact_check', 'synthesis'])].filter((role: any) =>
    WORKSPACE_REVIEW_ROLES.includes(role),
  )
  const promptSet = hashFilesByRole(runtimeRoles, workspacePromptFile)
  const schemaSet = hashFilesByRole(runtimeRoles, workspaceSchemaFile)
  const routePath = config.config_file || DEFAULT_ROUTE_FILE
  const routeProfile: any = {
    path: path.relative(ROOT, routePath),
    hash: hashJson(config.roles),
    source_file_hash: hashFileIfExists(routePath),
    effective_roles: config.roles,
  }
  const defaultRoute = readJsonIfExists(DEFAULT_ROUTE_FILE)
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

function parseExecutionLogFields(text: any) {
  const details: Record<string, any> = {}
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

function executionLogEvents(runDir: any) {
  const file = path.join(runDir, 'execution.log')
  if (!fs.existsSync(file)) {
    return []
  }
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line: any) => {
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
    .filter(Boolean)
}

function existingArtifact(runDir: any, file: any) {
  if (!file || !fs.existsSync(path.join(runDir, file))) {
    return null
  }
  return file
}

function activeRunRoles(request: any, state: any) {
  const reviewers =
    Array.isArray(request?.roles) && request.roles.length
      ? request.roles
      : Array.isArray(state?.roles) && state.roles.length
        ? state.roles
        : ['risk', 'architecture', 'execution', 'rebuttal']
  return [...new Set([...reviewers, 'fact_check', 'synthesis'])].filter((role: any) =>
    WORKSPACE_REVIEW_ROLES.includes(role),
  )
}

function roleMetadata(runDir: any, role: any) {
  return readJsonIfExists(path.join(runDir, 'roles', role, 'metadata.json'))
}

function inferredRoleRoutes(runDir: any, roles: any) {
  const defaultRoute = readJsonIfExists(DEFAULT_ROUTE_FILE)
  const routes = {
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

function inferredExecution(runDir: any) {
  const started: any = executionLogEvents(runDir).find((item: any) => item?.event === 'run_started')
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

function backfillConfig(runDir: any, roles: any) {
  return {
    config_file: null,
    roles: inferredRoleRoutes(runDir, roles),
    execution: inferredExecution(runDir),
    claude_bin: null,
    claude_version: null,
  }
}

function backfillRunManifest(runDir: any, options: any = {}) {
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
    workspace: workspaceSnapshot(request.project_root || state.project_root || absoluteRunDir),
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
      review_plan_refs_hash: reviewPlanRefs ? hashJson(reviewPlanRefs) : null,
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

function createRunManifest(config: any, request: any, runDir: any, options: any = {}) {
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
    workspace: workspaceSnapshot(request.project_root),
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

function updateRunManifest(runDir: any, updater: any) {
  const file = manifestPath(runDir)
  const current = requireRunManifest(runDir)
  const patch = typeof updater === 'function' ? updater(current) : updater
  const next = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  }
  writeJson(file, next)
  return next
}

function markManifestRunning(runDir: any, request: any) {
  const reviewPlanFile = path.join(runDir, 'review-plan.md')
  return updateRunManifest(runDir, (current: any) => ({
    status: 'running',
    inputs: {
      ...current.inputs,
      review_plan: {
        path: 'review-plan.md',
        hash: hashFileIfExists(reviewPlanFile) || hashText(request.review_plan || request.plan),
      },
      review_plan_refs_hash: request.review_plan_refs
        ? hashJson(request.review_plan_refs)
        : current.inputs.review_plan_refs_hash,
    },
    artifacts: {
      ...current.artifacts,
      review_plan: 'review-plan.md',
      plan_compaction: 'plan-compaction.json',
      review_plan_refs: 'review-plan-refs.json',
      plan_authoring_lint: 'plan-authoring-lint.json',
    },
  }))
}

function relativeFromRun(runDir: any, file: any) {
  if (!file) {
    return null
  }
  return path.isAbsolute(file) ? path.relative(runDir, file) : file
}

function absoluteFromRun(runDir: any, file: any) {
  if (!file) {
    return null
  }
  return path.isAbsolute(file) ? file : path.join(runDir, file)
}

function promptHash(runDir: any, metadata: any) {
  return hashFileIfExists(absoluteFromRun(runDir, metadata.prompt_file))
}

function schemaHash(metadata: any) {
  const schemaFile = metadata.schema_file ? path.join(ROOT, metadata.schema_file) : workspaceSchemaFile(metadata.role)
  return hashFileIfExists(schemaFile)
}

function readScopeHash(runDir: any, metadata: any) {
  return hashFileIfExists(absoluteFromRun(runDir, metadata.read_boundary?.read_scope_file))
}

function outputHash(runDir: any, role: any) {
  return hashFileIfExists(path.join(runDir, 'roles', role, 'output.json'))
}

function existingRelativeFile(runDir: any, file: any) {
  const relative = relativeFromRun(runDir, file)
  if (!relative) {
    return null
  }
  return fs.existsSync(absoluteFromRun(runDir, relative)) ? relative : null
}

function roleFileIfExists(runDir: any, role: any, fileName: any) {
  return existingRelativeFile(runDir, path.join('roles', role, fileName))
}

function attemptArtifactPaths(runDir: any, metadata: any, extra: any = {}) {
  const role = metadata.role
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

function normalizeRelPath(file: any) {
  return String(file || '')
    .replace(/\\/g, '/')
    .split(path.sep)
    .join('/')
}

function relocateRolePath(file: any, role: any, archivedRoleDir: any) {
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

function relocateAttemptArtifacts(attempt: any, role: any, archivedRoleDir: any) {
  const next = {
    ...attempt,
    archived_as: archivedRoleDir,
  }
  for (const field of ATTEMPT_ARTIFACT_FIELDS) {
    next[field] = relocateRolePath(next[field], role, archivedRoleDir)
  }
  return next
}

function recordResolvedExecution(runDir: any, metadata: any, extra: any = {}) {
  const role = metadata.role
  if (!role) {
    throw new Error('Cannot record resolved execution without role')
  }
  return updateRunManifest(runDir, (current: any) => {
    const previous = current.resolved_execution?.[role] || {}
    const history = Array.isArray(previous.attempt_history) ? previous.attempt_history : []
    const artifactPaths = attemptArtifactPaths(runDir, metadata, extra)
    const attempt = {
      attempt_index: history.length + 1,
      status: extra.status || metadata.status || null,
      adapter: 'claude-code',
      provider: 'claude-code-wrapper',
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
      ...artifactPaths,
    }
    const nextHistory = [...history, attempt]
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
          attempt_history: nextHistory,
        },
      },
    }
  })
}

function archiveResolvedExecutionAttempt(runDir: any, role: any, archivedRoleDir: any) {
  if (!archivedRoleDir) {
    return null
  }
  return updateRunManifest(runDir, (current: any) => {
    const roleExecution = current.resolved_execution?.[role]
    if (!roleExecution) {
      return {}
    }
    const history = Array.isArray(roleExecution.attempt_history) ? roleExecution.attempt_history : []
    if (!history.length) {
      return {}
    }
    const latestIndex = history.length - 1
    const relocatedLatest = relocateAttemptArtifacts(history[latestIndex], role, archivedRoleDir)
    const nextHistory = history.map((attempt: any, index: any) => (index === latestIndex ? relocatedLatest : attempt))
    const nextRoleExecution = {
      ...roleExecution,
      archived_as: archivedRoleDir,
      attempt_history: nextHistory,
    }
    for (const field of ATTEMPT_ARTIFACT_FIELDS) {
      nextRoleExecution[field] = relocatedLatest[field] ?? nextRoleExecution[field] ?? null
    }
    return {
      resolved_execution: {
        ...current.resolved_execution,
        [role]: nextRoleExecution,
      },
    }
  })
}

function markManifestFinished(runDir: any, status: any, patch: any = {}) {
  return updateRunManifest(runDir, (current: any) => ({
    ...patch,
    status,
    finished_at: new Date().toISOString(),
    artifacts: {
      ...current.artifacts,
      report: fs.existsSync(path.join(runDir, 'report.json')) ? 'report.json' : current.artifacts?.report,
    },
  }))
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
