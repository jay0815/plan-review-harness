// Shared types for workspace review modules.
// Extracted from workspace-review-lib.ts to enable modular imports.

export type JsonRecord = Record<string, unknown>
export type WorkspaceRole = string

export interface RoleRouteConfig {
  routes: Record<string, string>
  source: JsonRecord
}

export interface WorkspaceReviewLoadOptions {
  validateClaudeBin?: boolean
  claudeBin?: string
  workspaceRunsDir?: string
  execution?: JsonRecord
}

export interface WorkspaceReviewSource {
  config_file?: string | null
  settings_dir?: string | null
  config_dir: string
  loader_args: string[]
}

export interface ModelConfigInput extends JsonRecord {
  settings_file?: unknown
  required_env?: unknown
}

export interface ValidatedModelConfig extends JsonRecord {
  settings_file: string
  required_env: string[]
  summary: {
    base_url: unknown
    model: unknown
    auth_env: string
  }
}

export interface WorkspaceReviewConfig extends JsonRecord {
  version: 1
  config_file: string | null
  settings_dir: string | null
  loader_args: string[]
  config_dir: string
  claude_bin: string
  claude_version: string | null
  workspace_runs_dir: string
  models: Record<string, ValidatedModelConfig>
  roles: Record<string, string>
  execution: {
    max_concurrency: number
    timeout_ms: number
    max_buffer_bytes: number
    max_turns: number
    compact_plan: boolean
    isolate_reviewers: boolean
    read_scope_max_files: number
  }
}

export interface WorkspaceRunDirectoryConfig {
  workspace_runs_dir: string
}

export interface ConfigSummaryInput {
  config_file?: unknown
  settings_dir?: unknown
  claude_bin?: unknown
  claude_version?: unknown
  workspace_runs_dir?: unknown
  roles: Record<string, string>
  models: Record<string, unknown>
}

export interface ConfigSummaryResult {
  config_file: unknown
  settings_dir: unknown
  claude_bin: unknown
  claude_version: unknown
  workspace_runs_dir: unknown
  roles: Record<string, string>
  role_route_source: JsonRecord
  models: Record<
    string,
    {
      settings_file: unknown
      base_url: unknown
      model: unknown
      auth_env: unknown
    }
  >
}
