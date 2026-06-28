/**
 * Configuration loading and validation for workspace review.
 * Extracted from workspace-review-lib.ts to enable modular imports.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { ROOT, parseJsonFile, readText } from './lib.js'
import type {
  JsonRecord,
  RoleRouteConfig,
  WorkspaceReviewLoadOptions,
  WorkspaceReviewSource,
  ValidatedModelConfig,
  WorkspaceReviewConfig,
  ConfigSummaryInput,
  ConfigSummaryResult,
} from './workspace-review-types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REVIEW_ROLES = ['risk', 'architecture', 'execution', 'rebuttal'] as const
export const FACT_CHECK_ROLE = 'fact_check'
export const SYNTHESIS_ROLE = 'synthesis'
export const WORKSPACE_ROLES = [...REVIEW_ROLES, FACT_CHECK_ROLE, SYNTHESIS_ROLE]
export const REQUIRED_ROLES = [...REVIEW_ROLES, FACT_CHECK_ROLE, SYNTHESIS_ROLE]

const PLACEHOLDER_PATTERN = /REPLACE_|YOUR_|CHANGEME|<[^>]+>/i

export const DEFAULT_MODEL_FILES: Record<string, string> = {
  kimi: 'kimi.json',
  deepseek: 'deepseek.json',
  glm: 'glm.json',
  qwen: 'qwen.json',
}

const DEFAULT_MODEL_REQUIRED_ENV: Record<string, string[]> = {
  kimi: ['ANTHROPIC_BASE_URL'],
  deepseek: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL'],
  glm: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL'],
  qwen: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL'],
}

const DEFAULT_ROLE_ROUTE_FILE = path.join(ROOT, 'default-role-routes.json')
const DEFAULT_ROLE_ROUTE_CONFIG = parseJsonFile<RoleRouteConfig>(DEFAULT_ROLE_ROUTE_FILE)
export const DEFAULT_ROLE_ROUTES = Object.freeze({ ...DEFAULT_ROLE_ROUTE_CONFIG.routes })
export const DEFAULT_ROLE_ROUTE_SOURCE = Object.freeze({
  run_id: DEFAULT_ROLE_ROUTE_CONFIG.source?.run_id ?? null,
  score_version: DEFAULT_ROLE_ROUTE_CONFIG.source?.score_version ?? null,
  model_role_map: DEFAULT_ROLE_ROUTE_CONFIG.source?.model_role_map ?? null,
})

export const DEFAULT_READ_SCOPE_MAX_FILES = 80

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function expandHome(value: string): string {
  if (value === '~') {
    return os.homedir()
  }
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

export function resolveConfiguredPath(value: unknown, configDir: string): string {
  const expanded = expandHome(String(value))
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(configDir, expanded)
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return parsed
}

function assertNonPlaceholder(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`${label} still contains a placeholder value`)
  }
}

export function assertWorkspaceRole(role: string): void {
  if (!WORKSPACE_ROLES.includes(role)) {
    throw new Error(`Invalid workspace review role "${role}". Expected one of: ${WORKSPACE_ROLES.join(', ')}`)
  }
}

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export function withoutAnthropicApiKey(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {}
  for (const key of Object.keys(env)) {
    if (key === 'ANTHROPIC_API_KEY') {
      continue
    }
    sanitized[key] = env[key]
  }
  return sanitized
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

export function validateSettingsFile(model: string, modelConfig: unknown, configDir: string): ValidatedModelConfig {
  if (!isRecord(modelConfig)) {
    throw new Error(`models.${model} must be an object`)
  }
  if (!modelConfig.settings_file) {
    throw new Error(`models.${model}.settings_file is required`)
  }
  const settingsFile = resolveConfiguredPath(modelConfig.settings_file, configDir)
  if (!fs.existsSync(settingsFile)) {
    throw new Error(`Missing settings file for model "${model}": ${settingsFile}`)
  }
  const stat = fs.statSync(settingsFile)
  if (!stat.isFile()) {
    throw new Error(`Settings path for model "${model}" is not a file: ${settingsFile}`)
  }
  fs.accessSync(settingsFile, fs.constants.R_OK)

  const settingsText = readText(settingsFile)
  if (/"ANTHROPIC_API_KEY"\s*:/.test(settingsText)) {
    throw new Error(
      `Settings file for model "${model}" contains forbidden ANTHROPIC_API_KEY; ` + 'use ANTHROPIC_AUTH_TOKEN only',
    )
  }
  let settings: unknown
  try {
    settings = JSON.parse(settingsText)
  } catch (error: unknown) {
    throw new Error(`Invalid JSON in settings file for model "${model}": ${errorMessage(error)}`)
  }
  if (!isRecord(settings)) {
    throw new Error(`Settings file for model "${model}" must contain a JSON object`)
  }
  const env = settings.env
  if (!isRecord(env)) {
    throw new Error(`Settings file for model "${model}" must contain an env object`)
  }
  const requiredEnv = Array.isArray(modelConfig.required_env)
    ? modelConfig.required_env.map((item: unknown) => String(item))
    : ['ANTHROPIC_BASE_URL']
  for (const key of requiredEnv) {
    assertNonPlaceholder(env[key], `${model} settings env.${key}`)
  }
  const authToken = env.ANTHROPIC_AUTH_TOKEN
  if (typeof authToken !== 'string' || !authToken.trim() || PLACEHOLDER_PATTERN.test(authToken)) {
    throw new Error(`Settings file for model "${model}" must define a non-placeholder ` + 'ANTHROPIC_AUTH_TOKEN')
  }

  return {
    ...modelConfig,
    settings_file: settingsFile,
    required_env: requiredEnv,
    summary: {
      base_url: env.ANTHROPIC_BASE_URL || null,
      model: env.ANTHROPIC_MODEL || null,
      auth_env: 'ANTHROPIC_AUTH_TOKEN',
    },
  }
}

export function validateClaudeBinary(command: string): string {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 10000,
    env: withoutAnthropicApiKey(process.env),
  })
  if (result.error || result.status !== 0) {
    const reason = result.error?.message || result.stderr.trim() || `exit ${result.status}`
    throw new Error(`Unable to execute Claude Code binary "${command}": ${reason}`)
  }
  return (result.stdout || result.stderr || '').trim()
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function normalizeWorkspaceReviewConfig(
  raw: unknown,
  source: WorkspaceReviewSource,
  options: WorkspaceReviewLoadOptions = {},
): WorkspaceReviewConfig {
  if (!isRecord(raw)) {
    throw new Error('Workspace review config must be a JSON object')
  }
  if (raw.version !== 1) {
    throw new Error(`Unsupported workspace review config version: ${raw.version}`)
  }
  if (!isRecord(raw.models)) {
    throw new Error('Workspace review config must contain a models object')
  }
  if (!isRecord(raw.roles)) {
    throw new Error('Workspace review config must contain a roles object')
  }

  const configDir = source.config_dir
  const roles = {
    ...DEFAULT_ROLE_ROUTES,
    ...raw.roles,
  } as Record<string, string>
  const requiredModels = new Set<string>()
  for (const role of REQUIRED_ROLES) {
    assertWorkspaceRole(role)
    const model = roles[role]
    if (typeof model !== 'string' || !model.trim()) {
      throw new Error(`roles.${role} must name a configured model`)
    }
    requiredModels.add(model)
  }
  if (roles.planner) {
    requiredModels.add(roles.planner)
  }

  const models: Record<string, ValidatedModelConfig> = {}
  for (const model of requiredModels) {
    if (!Object.prototype.hasOwnProperty.call(raw.models, model)) {
      throw new Error(`Role routing references missing model configuration: ${model}`)
    }
  }
  const configuredModels = Object.keys(raw.models)
  if (!configuredModels.length) {
    throw new Error('Workspace review config must declare at least one model')
  }
  for (const model of configuredModels) {
    models[model] = validateSettingsFile(model, raw.models[model], configDir)
  }

  const execution = isRecord(raw.execution) ? raw.execution : {}
  const normalized: WorkspaceReviewConfig = {
    version: 1,
    config_file: source.config_file || null,
    settings_dir: source.settings_dir || null,
    loader_args: source.loader_args,
    config_dir: configDir,
    claude_bin: typeof raw.claude_bin === 'string' ? raw.claude_bin : 'claude',
    claude_version: null,
    workspace_runs_dir: resolveConfiguredPath(raw.workspace_runs_dir || path.join(ROOT, 'workspace-runs'), configDir),
    models,
    roles,
    execution: {
      max_concurrency: positiveInteger(execution.max_concurrency || 4, 'execution.max_concurrency'),
      timeout_ms: positiveInteger(execution.timeout_ms || 900000, 'execution.timeout_ms'),
      max_buffer_bytes: positiveInteger(execution.max_buffer_bytes || 20 * 1024 * 1024, 'execution.max_buffer_bytes'),
      max_turns: positiveInteger(execution.max_turns || 24, 'execution.max_turns'),
      compact_plan: execution.compact_plan !== false,
      isolate_reviewers: execution.isolate_reviewers !== false,
      read_scope_max_files: positiveInteger(
        execution.read_scope_max_files || DEFAULT_READ_SCOPE_MAX_FILES,
        'execution.read_scope_max_files',
      ),
    },
  }
  if (options.validateClaudeBin !== false) {
    normalized.claude_version = validateClaudeBinary(normalized.claude_bin)
  }
  return normalized
}

export function loadWorkspaceReviewConfig(
  configFile: string,
  options: WorkspaceReviewLoadOptions = {},
): WorkspaceReviewConfig {
  const absoluteConfigFile = path.resolve(expandHome(configFile))
  if (!fs.existsSync(absoluteConfigFile)) {
    throw new Error(`Workspace review config does not exist: ${absoluteConfigFile}`)
  }
  let raw: unknown
  try {
    raw = parseJsonFile(absoluteConfigFile)
  } catch (error: unknown) {
    throw new Error(`Invalid workspace review config JSON: ${errorMessage(error)}`)
  }
  return normalizeWorkspaceReviewConfig(
    raw,
    {
      config_file: absoluteConfigFile,
      config_dir: path.dirname(absoluteConfigFile),
      loader_args: ['--config', absoluteConfigFile],
    },
    options,
  )
}

export function loadWorkspaceReviewSettingsDirectory(
  settingsDir: string,
  options: WorkspaceReviewLoadOptions = {},
): WorkspaceReviewConfig {
  const absoluteSettingsDir = path.resolve(expandHome(settingsDir))
  if (!fs.existsSync(absoluteSettingsDir)) {
    throw new Error(`Settings directory does not exist: ${absoluteSettingsDir}`)
  }
  const stat = fs.statSync(absoluteSettingsDir)
  if (!stat.isDirectory()) {
    throw new Error(`Settings path is not a directory: ${absoluteSettingsDir}`)
  }
  fs.accessSync(absoluteSettingsDir, fs.constants.R_OK)

  const models = Object.fromEntries(
    Object.entries(DEFAULT_MODEL_FILES).map(([model, filename]) => [
      model,
      {
        settings_file: path.join(absoluteSettingsDir, filename),
        required_env: DEFAULT_MODEL_REQUIRED_ENV[model],
      },
    ]),
  )
  const loaderArgs = ['--settings-dir', absoluteSettingsDir]
  if (options.claudeBin) {
    loaderArgs.push('--claude-bin', options.claudeBin)
  }
  return normalizeWorkspaceReviewConfig(
    {
      version: 1,
      claude_bin: options.claudeBin || 'claude',
      workspace_runs_dir: options.workspaceRunsDir || path.join(ROOT, 'workspace-runs'),
      models,
      roles: DEFAULT_ROLE_ROUTES,
      execution: options.execution || {},
    },
    {
      settings_dir: absoluteSettingsDir,
      config_dir: absoluteSettingsDir,
      loader_args: loaderArgs,
    },
    options,
  )
}

export function loadWorkspaceReviewFromArgs(
  args: JsonRecord,
  options: WorkspaceReviewLoadOptions = {},
): WorkspaceReviewConfig {
  const configFile = args.config && args.config !== true ? String(args.config) : null
  const settingsDir = args['settings-dir'] && args['settings-dir'] !== true ? String(args['settings-dir']) : null
  if (configFile && settingsDir) {
    throw new Error('Use either --settings-dir or --config, not both')
  }
  if (settingsDir) {
    return loadWorkspaceReviewSettingsDirectory(settingsDir, {
      ...options,
      claudeBin: args['claude-bin'] && args['claude-bin'] !== true ? String(args['claude-bin']) : options.claudeBin,
    })
  }
  if (configFile) {
    return loadWorkspaceReviewConfig(configFile, options)
  }
  throw new Error('Missing required argument: --settings-dir')
}

export function configSummary(config: ConfigSummaryInput): ConfigSummaryResult {
  return {
    config_file: config.config_file,
    settings_dir: config.settings_dir,
    claude_bin: config.claude_bin,
    claude_version: config.claude_version,
    workspace_runs_dir: config.workspace_runs_dir,
    roles: config.roles,
    role_route_source: DEFAULT_ROLE_ROUTE_SOURCE,
    models: Object.fromEntries(
      Object.entries(config.models).map(([model, value]) => {
        const modelConfig = isRecord(value) ? value : {}
        const summary = isRecord(modelConfig.summary) ? modelConfig.summary : {}
        return [
          model,
          {
            settings_file: modelConfig.settings_file,
            base_url: summary.base_url,
            model: summary.model,
            auth_env: summary.auth_env,
          },
        ]
      }),
    ),
  }
}
