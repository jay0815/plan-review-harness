#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const lib_js_1 = require("./lib.js");
const doctor_workspace_review_run_js_1 = require("./doctor-workspace-review-run.js");
const verify_workspace_review_run_js_1 = require("./verify-workspace-review-run.js");
const workspace_review_manifest_js_1 = require("./workspace-review-manifest.js");
function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function writeJsonl(file, events) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');
}
function writeRunManifest(runDir, runId, status, roles = []) {
    writeJson(path.join(runDir, 'run-manifest.json'), {
        version: 1,
        run_id: runId,
        status,
        created_at: '2026-06-16T00:00:00.000Z',
        updated_at: '2026-06-16T00:00:00.000Z',
        workspace: {
            project_root: '/tmp/project',
            git_available: false,
            git_head: null,
            dirty: null,
            dirty_files: [],
            dirty_patch_hash: null,
        },
        inputs: {
            plan: {
                path: null,
                hash: 'sha256:test-plan',
            },
            context_hash: null,
            review_plan: {
                path: 'review-plan.md',
                hash: 'sha256:test-review-plan',
            },
            review_plan_refs_hash: 'sha256:test-review-plan-refs',
        },
        declared_runtime: {
            route_profile: {
                path: 'model-role-calibration/default-role-routes.json',
                hash: 'sha256:test-routes',
                effective_roles: {},
            },
            prompt_set_hash: 'sha256:test-prompts',
            schema_set_hash: 'sha256:test-schemas',
        },
        resolved_execution: Object.fromEntries(roles.map((role) => [
            role,
            {
                adapter: 'claude-code',
                provider: 'claude-code-wrapper',
                model: 'test-model',
                attempts: 1,
                latest_status: 'completed',
                attempt_history: [
                    {
                        attempt_index: 1,
                        status: 'completed',
                        metadata_file: `roles/${role}/metadata.json`,
                    },
                ],
            },
        ])),
        artifacts: {
            request: 'request.json',
            state: 'state.json',
        },
    });
}
function roleEvents({ tools = ['Read'], reads = [] } = {}) {
    return [
        {
            type: 'system',
            subtype: 'init',
            session_id: '00000000-0000-4000-8000-000000000000',
            model: 'test-model',
            tools,
        },
        ...reads.map((file, index) => ({
            type: 'assistant',
            message: {
                content: [
                    {
                        type: 'tool_use',
                        id: `tool-${index}`,
                        name: 'Read',
                        input: {
                            file_path: file,
                        },
                    },
                ],
            },
        })),
    ];
}
function roleEventsWithReadResults({ tools = ['Read'], reads = [], failedReads = [] } = {}) {
    const events = [
        {
            type: 'system',
            subtype: 'init',
            session_id: '00000000-0000-4000-8000-000000000000',
            model: 'test-model',
            tools,
        },
    ];
    let index = 0;
    for (const file of reads) {
        const id = `tool-ok-${index}`;
        index += 1;
        events.push({
            type: 'assistant',
            message: {
                content: [
                    {
                        type: 'tool_use',
                        id,
                        name: 'Read',
                        input: {
                            file_path: file,
                        },
                    },
                ],
            },
        });
        events.push({
            type: 'user',
            message: {
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: id,
                        content: '1\tok',
                    },
                ],
            },
        });
    }
    for (const file of failedReads) {
        const id = `tool-failed-${index}`;
        index += 1;
        events.push({
            type: 'assistant',
            message: {
                content: [
                    {
                        type: 'tool_use',
                        id,
                        name: 'Read',
                        input: {
                            file_path: file,
                        },
                    },
                ],
            },
        });
        events.push({
            type: 'user',
            message: {
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: id,
                        is_error: true,
                        content: 'File does not exist',
                    },
                ],
            },
        });
    }
    return events;
}
const EXECUTION_BOUNDARIES = [
    'main_path',
    'step_order',
    'dependencies',
    'inputs',
    'outputs',
    'acceptance',
    'tests',
    'failure_semantics',
    'rollback_or_recovery',
    'compatibility_or_release',
    'implementation_discretion',
    'plan_bloat',
];
function executionCoverage() {
    return EXECUTION_BOUNDARIES.map((boundary) => ({
        boundary,
        status: 'covered',
        evidence_basis: 'plan_text',
        notes: `测试 fixture 覆盖 ${boundary} 边界。`,
    }));
}
function createRole(runDir, role, options = {}) {
    const roleDir = path.join(runDir, 'roles', role);
    fs.mkdirSync(roleDir, { recursive: true });
    const exposedRoot = path.join(runDir, 'scoped', role, 'project');
    const sourceRoot = path.join(runDir, 'source');
    const reads = options.reads || [path.join(exposedRoot, 'package.json')];
    writeJson(path.join(roleDir, 'metadata.json'), {
        role,
        model: options.model || 'test-model',
        started_at: '2026-06-16T00:00:00.000Z',
        finished_at: '2026-06-16T00:00:10.000Z',
        status: 'completed',
        error: null,
        allowed_tools: options.tools || ['Read'],
        read_boundary: options.read_boundary === false
            ? null
            : {
                mode: 'scoped_mirror',
                source_root: sourceRoot,
                exposed_root: exposedRoot,
                file_count: 2,
                read_scope_file: `roles/${role}/read-scope.json`,
            },
    });
    writeJson(path.join(roleDir, 'read-scope.json'), {
        mode: 'scoped_mirror',
        source_root: sourceRoot,
        exposed_root: exposedRoot,
        files: ['package.json', 'src/index.ts'],
    });
    const defaultOutput = {
        probe: role,
        issues: [],
        missing_questions: [],
        false_positive_risks: [],
    };
    if (role === 'execution') {
        defaultOutput.coverage_declaration = {
            reviewed_boundaries: executionCoverage(),
            unverified_assumptions: [],
            not_reviewed: [],
        };
    }
    writeJson(path.join(roleDir, 'output.json'), options.output || defaultOutput);
    writeJsonl(path.join(roleDir, 'stdout.jsonl'), roleEvents({
        tools: options.tools === undefined ? ['Read'] : options.tools,
        reads,
    }));
}
function main() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-review-verify-test-'));
    try {
        const runDir = path.join(tempDir, 'workspace-review-test');
        fs.mkdirSync(runDir, { recursive: true });
        node_assert_1.default.equal((0, verify_workspace_review_run_js_1.resolveRunDir)({ 'run-dir': runDir }), path.resolve(runDir));
        node_assert_1.default.equal((0, verify_workspace_review_run_js_1.resolveRunDir)({ 'run-id': 'workspace-review-test' }, { workspaceRunsDir: tempDir }), path.join(tempDir, 'workspace-review-test'));
        node_assert_1.default.throws(() => (0, verify_workspace_review_run_js_1.resolveRunDir)({ 'run-id': '../bad' }), /Invalid run id/);
        node_assert_1.default.throws(() => (0, verify_workspace_review_run_js_1.resolveRunDir)({}), /--run-id or --run-dir/);
        node_assert_1.default.throws(() => (0, verify_workspace_review_run_js_1.resolveRunDir)({ 'run-id': 'x', 'run-dir': runDir }), /either --run-id or --run-dir/);
        const manifestRunDir = path.join(tempDir, 'workspace-review-manifest');
        fs.mkdirSync(manifestRunDir, { recursive: true });
        const manifestConfig = {
            config_file: null,
            roles: {
                risk: 'kimi',
                architecture: 'kimi',
                execution: 'kimi',
                rebuttal: 'glm',
                fact_check: 'glm',
                synthesis: 'glm',
                planner: 'kimi',
            },
            execution: {
                max_concurrency: 4,
                timeout_ms: 900000,
                max_buffer_bytes: 1024,
                max_turns: 24,
                compact_plan: true,
                isolate_reviewers: true,
                read_scope_max_files: 80,
            },
            claude_bin: 'claude',
            claude_version: 'Claude Code test',
        };
        const manifestRequest = {
            run_id: 'workspace-review-manifest',
            created_at: '2026-06-16T00:00:00.000Z',
            project_root: tempDir,
            plan: '# Manifest Plan\n',
            plan_file: null,
            context: '',
            roles: ['risk'],
        };
        const createdManifest = (0, workspace_review_manifest_js_1.createRunManifest)(manifestConfig, manifestRequest, manifestRunDir);
        node_assert_1.default.equal(createdManifest.status, 'created');
        node_assert_1.default.equal(createdManifest.inputs.plan.hash.startsWith('sha256:'), true);
        node_assert_1.default.equal(createdManifest.declared_runtime.route_profile.effective_roles.risk, 'kimi');
        manifestRequest.review_plan = '# Manifest Review Plan\n';
        manifestRequest.review_plan_refs = {
            existing_code_refs: [{ path: 'src/index.ts' }],
            existing_code_ref_dirs: [],
            skipped_refs: [],
        };
        fs.writeFileSync(path.join(manifestRunDir, 'review-plan.md'), manifestRequest.review_plan, 'utf8');
        (0, workspace_review_manifest_js_1.markManifestRunning)(manifestRunDir, manifestRequest);
        const manifestRoleDir = path.join(manifestRunDir, 'roles', 'risk');
        fs.mkdirSync(manifestRoleDir, { recursive: true });
        fs.writeFileSync(path.join(manifestRoleDir, 'prompt.md'), 'prompt\n', 'utf8');
        writeJson(path.join(manifestRoleDir, 'read-scope.json'), {
            files: ['src/index.ts'],
        });
        writeJson(path.join(manifestRoleDir, 'output.json'), {
            probe: 'risk',
            issues: [],
            missing_questions: [],
            false_positive_risks: [],
        });
        (0, workspace_review_manifest_js_1.recordResolvedExecution)(manifestRunDir, {
            role: 'risk',
            model: 'kimi',
            status: 'completed',
            started_at: '2026-06-16T00:00:01.000Z',
            finished_at: '2026-06-16T00:00:02.000Z',
            timed_out: false,
            exit_code: 0,
            signal: null,
            error: null,
            prompt_file: 'roles/risk/prompt.md',
            settings_file: '/tmp/kimi.json',
            allowed_tools: ['Read', 'Glob', 'Grep'],
            schema_file: 'schemas/risk-output.schema.json',
            read_boundary: {
                read_scope_file: 'roles/risk/read-scope.json',
            },
        });
        (0, workspace_review_manifest_js_1.markManifestFinished)(manifestRunDir, 'completed');
        const completedManifest = JSON.parse(fs.readFileSync(path.join(manifestRunDir, 'run-manifest.json'), 'utf8'));
        node_assert_1.default.equal(completedManifest.status, 'completed');
        node_assert_1.default.equal(completedManifest.inputs.review_plan.hash, (0, workspace_review_manifest_js_1.hashFileIfExists)(path.join(manifestRunDir, 'review-plan.md')));
        node_assert_1.default.equal(completedManifest.inputs.review_plan_refs_hash.startsWith('sha256:'), true);
        node_assert_1.default.equal(completedManifest.resolved_execution.risk.attempts, 1);
        node_assert_1.default.equal(completedManifest.resolved_execution.risk.latest_status, 'completed');
        node_assert_1.default.equal(completedManifest.resolved_execution.risk.prompt_hash.startsWith('sha256:'), true);
        node_assert_1.default.equal(completedManifest.resolved_execution.risk.schema_hash.startsWith('sha256:'), true);
        node_assert_1.default.equal(completedManifest.resolved_execution.risk.output_hash.startsWith('sha256:'), true);
        const legacyRunDir = path.join(tempDir, 'workspace-review-legacy');
        fs.mkdirSync(legacyRunDir, { recursive: true });
        writeJson(path.join(legacyRunDir, 'request.json'), {
            run_id: 'workspace-review-legacy',
            created_at: '2026-06-16T00:00:00.000Z',
            project_root: tempDir,
            plan: '# Legacy Plan\n',
            plan_file: null,
            context: '',
            roles: ['risk', 'architecture', 'execution', 'rebuttal'],
        });
        writeJson(path.join(legacyRunDir, 'state.json'), {
            run_id: 'workspace-review-legacy',
            status: 'completed',
            created_at: '2026-06-16T00:00:00.000Z',
            updated_at: '2026-06-16T00:10:00.000Z',
            project_root: tempDir,
            started_at: '2026-06-16T00:00:01.000Z',
            finished_at: '2026-06-16T00:10:00.000Z',
            roles: ['risk', 'architecture', 'execution', 'rebuttal'],
            infra_errors: [],
        });
        fs.writeFileSync(path.join(legacyRunDir, 'review-plan.md'), '# Legacy Review Plan\n', 'utf8');
        writeJson(path.join(legacyRunDir, 'plan-compaction.json'), {
            original_chars: 1000,
            compacted_chars: 900,
            saved_chars: 100,
            code_blocks: 1,
            compacted_blocks: 1,
            preserved_blocks: 0,
        });
        writeJson(path.join(legacyRunDir, 'review-plan-refs.json'), {
            version: 1,
            format_status: {
                refs_scoped_to_existing_code_refs_section: true,
            },
            existing_code_refs: [],
            existing_code_ref_dirs: [],
            proposed_code_artifacts: [],
            blocked_refs: [],
            skipped_refs: [],
        });
        writeJson(path.join(legacyRunDir, 'plan-authoring-lint.json'), {
            valid: true,
            errors: [],
            warnings: [],
            metrics: {
                existing_code_ref_count: 1,
                structured_existing_code_ref_count: 1,
                inline_existing_code_ref_count: 0,
            },
        });
        fs.writeFileSync(path.join(legacyRunDir, 'execution.log'), [
            '[2026-06-16T00:00:01.000Z] run_started run_id="workspace-review-legacy" pid=123 roles=["risk","architecture","execution","rebuttal"] max_concurrency=4',
            '[2026-06-16T00:01:00.000Z] read_scope_prepared role="risk" files=2',
            '[2026-06-16T00:09:00.000Z] fact_check_summary total_checked=0',
            '[2026-06-16T00:10:00.000Z] run_completed run_id="workspace-review-legacy" reviewer_count=4 infra_error_count=0',
            '',
        ].join('\n'), 'utf8');
        for (const role of ['risk', 'architecture', 'execution', 'rebuttal']) {
            createRole(legacyRunDir, role);
        }
        createRole(legacyRunDir, 'fact_check', {
            model: 'glm',
            output: {
                probe: 'fact_check',
                checked_issues: [],
                source_summaries: [],
                limits: [],
            },
        });
        writeJson(path.join(legacyRunDir, 'roles', 'fact_check', 'fact-check-summary.json'), {
            total_checked: 0,
            status_counts: {},
            evidence_status_counts: {},
            claim_support_counts: {},
            verified_ratio: 0,
            challenged_count: 0,
            strictness_signal: 'no_issues_checked',
            limits_count: 0,
        });
        createRole(legacyRunDir, 'synthesis', {
            model: 'glm',
            tools: [],
            reads: [],
            read_boundary: false,
            output: {
                probe: 'synthesis',
                process_map: {
                    title: 'legacy',
                    mermaid: 'flowchart TD\n  A[A]',
                    nodes: [],
                },
                consensus_issues: [],
                disagreements: [],
                likely_false_positives: [],
                revision_instructions: [],
            },
        });
        writeJson(path.join(legacyRunDir, 'report.json'), {
            run_id: 'workspace-review-legacy',
            outcome: {
                status: 'plan_ready',
                message: 'legacy',
            },
            infra_errors: [],
            fact_check: {
                summary: {
                    total_checked: 0,
                },
            },
        });
        const missingManifest = (0, verify_workspace_review_run_js_1.verifyRun)(legacyRunDir);
        node_assert_1.default.equal(missingManifest.valid, false);
        (0, node_assert_1.default)(missingManifest.checks.some((item) => item.id === 'manifest.present' &&
            item.status === 'fail' &&
            item.details.backfill_command.includes('backfill-workspace-run-manifest.js')));
        const legacyDoctor = (0, doctor_workspace_review_run_js_1.doctorWorkspaceReviewRun)(legacyRunDir);
        (0, node_assert_1.default)(legacyDoctor.next_actions.some((item) => item.kind === 'backfill_run_manifest'));
        const backfilled = (0, workspace_review_manifest_js_1.backfillRunManifest)(legacyRunDir);
        node_assert_1.default.equal(backfilled.status, 'completed');
        node_assert_1.default.equal(backfilled.artifacts.backfilled_from, 'legacy-run-artifacts');
        node_assert_1.default.equal(backfilled.resolved_execution.risk.latest_status, 'completed');
        node_assert_1.default.equal(backfilled.resolved_execution.fact_check.model, 'glm');
        node_assert_1.default.equal(backfilled.resolved_execution.synthesis.output_hash.startsWith('sha256:'), true);
        const backfilledVerification = (0, verify_workspace_review_run_js_1.verifyRun)(legacyRunDir);
        (0, node_assert_1.default)(!backfilledVerification.checks.some((item) => item.id === 'manifest.present' && item.status === 'fail'));
        const runningRunDir = path.join(tempDir, 'workspace-review-running');
        fs.mkdirSync(runningRunDir, { recursive: true });
        writeJson(path.join(runningRunDir, 'state.json'), {
            run_id: 'workspace-review-running',
            status: 'running',
            project_root: '/tmp/project',
            started_at: '2026-06-16T00:00:00.000Z',
            roles: ['risk', 'architecture', 'execution', 'rebuttal'],
        });
        writeJson(path.join(runningRunDir, 'plan-compaction.json'), {
            original_chars: 1000,
            compacted_chars: 700,
            saved_chars: 300,
            code_blocks: 2,
            compacted_blocks: 1,
            preserved_blocks: 1,
        });
        writeRunManifest(runningRunDir, 'workspace-review-running', 'running');
        const running = (0, verify_workspace_review_run_js_1.verifyRun)(runningRunDir);
        node_assert_1.default.equal(running.ready, false);
        node_assert_1.default.equal(running.valid, null);
        node_assert_1.default.equal(running.counts.fail, 0);
        (0, node_assert_1.default)(running.counts.pending >= 1);
        (0, node_assert_1.default)(!running.checks.some((item) => item.id === 'fact_check.present'));
        (0, node_assert_1.default)(!running.checks.some((item) => item.id === 'synthesis.present'));
        const runningDoctor = (0, doctor_workspace_review_run_js_1.doctorWorkspaceReviewRun)(runningRunDir);
        node_assert_1.default.equal(runningDoctor.health, 'pending');
        (0, node_assert_1.default)(runningDoctor.next_actions.some((item) => item.kind === 'wait_for_completion'));
        const failedRunDir = path.join(tempDir, 'workspace-review-failed');
        fs.mkdirSync(path.join(failedRunDir, 'roles'), { recursive: true });
        writeJson(path.join(failedRunDir, 'state.json'), {
            run_id: 'workspace-review-failed',
            status: 'failed',
            project_root: '/tmp/project',
            started_at: '2026-06-16T00:00:00.000Z',
            finished_at: '2026-06-16T00:01:00.000Z',
            error: 'Error: rebuttal/glm returned invalid output: bad JSON',
            roles: ['risk', 'architecture', 'execution', 'rebuttal'],
        });
        writeJson(path.join(failedRunDir, 'plan-compaction.json'), {
            original_chars: 1000,
            compacted_chars: 700,
            saved_chars: 300,
            code_blocks: 2,
            compacted_blocks: 1,
            preserved_blocks: 1,
        });
        writeRunManifest(failedRunDir, 'workspace-review-failed', 'failed');
        const failedInfra = (0, verify_workspace_review_run_js_1.verifyRun)(failedRunDir);
        node_assert_1.default.equal(failedInfra.ready, true);
        node_assert_1.default.equal(failedInfra.valid, false);
        node_assert_1.default.equal(failedInfra.infra_errors[0].role, 'rebuttal');
        node_assert_1.default.equal(failedInfra.infra_errors[0].type, 'invalid_output');
        const failedDoctor = (0, doctor_workspace_review_run_js_1.doctorWorkspaceReviewRun)(failedRunDir);
        node_assert_1.default.equal(failedDoctor.health, 'fail');
        (0, node_assert_1.default)(failedDoctor.next_actions.some((item) => item.kind === 'retry_stage' &&
            item.stage === 'reviewers' &&
            item.command.includes('retry-workspace-review-stage.js')));
        writeJson(path.join(runDir, 'state.json'), {
            run_id: 'workspace-review-test',
            status: 'completed',
            project_root: '/tmp/project',
            started_at: '2026-06-16T00:00:00.000Z',
            finished_at: '2026-06-16T00:10:00.000Z',
            roles: ['risk', 'architecture', 'execution', 'rebuttal'],
        });
        writeJson(path.join(runDir, 'plan-compaction.json'), {
            original_chars: 1000,
            compacted_chars: 600,
            saved_chars: 400,
            code_blocks: 2,
            compacted_blocks: 1,
            preserved_blocks: 1,
        });
        writeRunManifest(runDir, 'workspace-review-test', 'completed', [
            'risk',
            'architecture',
            'execution',
            'rebuttal',
            'fact_check',
            'synthesis',
        ]);
        fs.writeFileSync(path.join(runDir, 'execution.log'), [
            '[2026-06-16T00:00:00.000Z] read_scope_prepared role="risk" files=2',
            '[2026-06-16T00:05:00.000Z] fact_check_summary total_checked=1',
            '',
        ].join('\n'), 'utf8');
        for (const role of ['risk', 'architecture', 'execution', 'rebuttal']) {
            createRole(runDir, role);
        }
        createRole(runDir, 'fact_check', {
            model: 'deepseek',
            output: {
                probe: 'fact_check',
                checked_issues: [
                    {
                        issue_id: 'risk-001',
                        source: 'risk',
                        issue_title: '示例',
                        status: 'verified',
                        scope_status: 'in_scope',
                        evidence_status: 'quote_matches',
                        claim_support: 'direct',
                        reason: '测试',
                        checked_files: ['package.json'],
                    },
                ],
                source_summaries: [],
                limits: [],
            },
        });
        writeJson(path.join(runDir, 'roles', 'fact_check', 'fact-check-summary.json'), {
            total_checked: 1,
            status_counts: {
                verified: 1,
            },
            evidence_status_counts: {
                quote_matches: 1,
            },
            claim_support_counts: {
                direct: 1,
            },
            verified_ratio: 1,
            challenged_count: 0,
            strictness_signal: 'all_verified',
            limits_count: 0,
        });
        createRole(runDir, 'synthesis', {
            model: 'kimi',
            tools: [],
            reads: [],
            read_boundary: false,
            output: {
                probe: 'synthesis',
                process_map: {
                    title: 'test',
                    mermaid: 'flowchart TD\n  A[A]',
                    nodes: [
                        {
                            id: 'A',
                            label: 'A',
                            stage: 'test',
                            status: 'normal',
                            related_issue_titles: [],
                            evidence: 'test',
                        },
                    ],
                },
                consensus_issues: [],
                disagreements: [],
                likely_false_positives: [],
                revision_instructions: [],
            },
        });
        writeJson(path.join(runDir, 'report.json'), {
            run_id: 'workspace-review-test',
            outcome: {
                status: 'plan_ready',
                message: 'test',
            },
            infra_errors: [],
            fact_check: {
                summary: {
                    total_checked: 1,
                },
            },
        });
        writeJson(path.join(runDir, 'plan-authoring-lint.json'), {
            valid: true,
            errors: [],
            warnings: ['fixture warning'],
            metrics: {
                existing_code_ref_count: 2,
                structured_existing_code_ref_count: 1,
                inline_existing_code_ref_count: 1,
            },
        });
        writeJson(path.join(runDir, 'review-plan-refs.json'), {
            version: 1,
            format_status: {
                refs_scoped_to_existing_code_refs_section: true,
            },
            existing_code_refs: [
                {
                    path: 'src/index.ts',
                    line_ref: null,
                    original_ref: 'src/index.ts',
                },
            ],
            existing_code_ref_dirs: [
                {
                    path: 'src',
                    line_ref: null,
                    original_ref: 'src',
                },
            ],
            proposed_code_artifacts: [],
            blocked_refs: [],
            skipped_refs: ['missing.ts'],
        });
        const result = (0, verify_workspace_review_run_js_1.verifyRun)(runDir);
        node_assert_1.default.equal(result.valid, true);
        node_assert_1.default.equal(result.project_root, '/tmp/project');
        node_assert_1.default.equal(result.logs.execution_log, path.join(runDir, 'execution.log'));
        node_assert_1.default.equal(result.counts.fail, 0);
        (0, node_assert_1.default)(result.counts.warn >= 1);
        (0, node_assert_1.default)(result.checks.some((item) => item.id === 'fact_check.strictness_signal' && item.status === 'warn'));
        const doctor = (0, doctor_workspace_review_run_js_1.doctorWorkspaceReviewRun)(runDir);
        node_assert_1.default.equal(doctor.health, 'warn');
        node_assert_1.default.equal(doctor.action_level, 'P2');
        node_assert_1.default.equal(doctor.plan_outcome.status, 'plan_ready');
        node_assert_1.default.equal(doctor.plan_authoring_lint.existing_code_ref_count, 2);
        node_assert_1.default.equal(doctor.review_plan_refs.existing_file_ref_count, 1);
        node_assert_1.default.equal(doctor.review_plan_refs.existing_dir_ref_count, 1);
        node_assert_1.default.equal(doctor.review_plan_refs.skipped_ref_count, 1);
        node_assert_1.default.equal(doctor.fact_check.strictness_signal, 'all_verified');
        node_assert_1.default.equal(doctor.synthesis.revision_instruction_count, 0);
        (0, node_assert_1.default)(doctor.next_actions.some((item) => item.kind === 'record_regression_sample'));
        writeJsonl(path.join(runDir, 'roles', 'risk', 'stdout.jsonl'), roleEventsWithReadResults({
            reads: [path.join(runDir, 'scoped', 'risk', 'project', 'package.json')],
            failedReads: [path.join(runDir, 'other', 'missing.ts')],
        }));
        const failedOutOfBoundaryAttempt = (0, verify_workspace_review_run_js_1.verifyRun)(runDir);
        node_assert_1.default.equal(failedOutOfBoundaryAttempt.valid, true);
        (0, node_assert_1.default)(failedOutOfBoundaryAttempt.checks.some((item) => item.id === 'reviewer.risk.no_out_of_boundary_reads' && item.status === 'pass'));
        (0, node_assert_1.default)(failedOutOfBoundaryAttempt.checks.some((item) => item.id === 'reviewer.risk.failed_out_of_boundary_read_attempts' && item.status === 'warn'));
        writeJsonl(path.join(runDir, 'roles', 'risk', 'stdout.jsonl'), roleEvents({
            reads: [path.join(runDir, 'scoped', 'risk', 'project', 'package.json')],
        }));
        writeJson(path.join(runDir, 'report.json'), {
            run_id: 'workspace-review-test',
            outcome: {
                status: 'needs_revision',
                message: 'Plan 结构检查存在错误；必须先修订计划再执行。',
            },
            infra_errors: [],
            fact_check: {
                summary: {
                    total_checked: 1,
                },
            },
        });
        writeJson(path.join(runDir, 'plan-authoring-lint.json'), {
            valid: false,
            errors: ['missing section'],
            warnings: [],
            metrics: {
                existing_code_ref_count: 2,
                structured_existing_code_ref_count: 1,
                inline_existing_code_ref_count: 1,
            },
        });
        const needsRevisionDoctor = (0, doctor_workspace_review_run_js_1.doctorWorkspaceReviewRun)(runDir);
        node_assert_1.default.equal(needsRevisionDoctor.health, 'warn');
        node_assert_1.default.equal(needsRevisionDoctor.action_level, 'P0');
        node_assert_1.default.equal(needsRevisionDoctor.plan_outcome.status, 'needs_revision');
        (0, node_assert_1.default)(needsRevisionDoctor.next_actions.some((item) => item.kind === 'revise_plan_authoring_errors'));
        writeJson(path.join(runDir, 'plan-authoring-lint.json'), {
            valid: true,
            errors: [],
            warnings: ['fixture warning'],
            metrics: {
                existing_code_ref_count: 2,
                structured_existing_code_ref_count: 1,
                inline_existing_code_ref_count: 1,
            },
        });
        writeJson(path.join(runDir, 'report.json'), {
            run_id: 'workspace-review-test',
            outcome: {
                status: 'plan_ready',
                message: 'test',
            },
            infra_errors: [],
            fact_check: {
                summary: {
                    total_checked: 1,
                },
            },
        });
        writeJson(path.join(runDir, 'report.json'), {
            run_id: 'workspace-review-test',
            infra_errors: [],
            fact_check: {
                summary: {
                    total_checked: 1,
                },
            },
        });
        const missingOutcome = (0, verify_workspace_review_run_js_1.verifyRun)(runDir);
        node_assert_1.default.equal(missingOutcome.valid, false);
        (0, node_assert_1.default)(missingOutcome.checks.some((item) => item.id === 'report.outcome' && item.status === 'fail'));
        writeJson(path.join(runDir, 'report.json'), {
            run_id: 'workspace-review-test',
            outcome: {
                status: 'plan_ready',
                message: 'test',
            },
            infra_errors: [],
            fact_check: {
                summary: {
                    total_checked: 1,
                },
            },
        });
        writeJsonl(path.join(runDir, 'roles', 'fact_check', 'stdout.jsonl'), roleEvents({
            tools: ['Read', 'Grep'],
            reads: [path.join(runDir, 'scoped', 'fact_check', 'project', 'package.json')],
        }));
        const badFactCheckTools = (0, verify_workspace_review_run_js_1.verifyRun)(runDir);
        node_assert_1.default.equal(badFactCheckTools.valid, false);
        (0, node_assert_1.default)(badFactCheckTools.checks.some((item) => item.id === 'fact_check.read_only' && item.status === 'fail'));
        writeJsonl(path.join(runDir, 'roles', 'fact_check', 'stdout.jsonl'), roleEvents({
            tools: ['Read'],
            reads: [path.join(runDir, 'scoped', 'fact_check', 'project', 'package.json')],
        }));
        const riskMetadata = JSON.parse(fs.readFileSync(path.join(runDir, 'roles', 'risk', 'metadata.json'), 'utf8'));
        riskMetadata.read_boundary.exposed_root = path.join(runDir, 'other');
        writeJson(path.join(runDir, 'roles', 'risk', 'metadata.json'), riskMetadata);
        const failed = (0, verify_workspace_review_run_js_1.verifyRun)(runDir);
        node_assert_1.default.equal(failed.valid, false);
        (0, node_assert_1.default)(failed.checks.some((item) => item.id === 'reviewer.risk.no_out_of_boundary_reads' && item.status === 'fail'));
        console.log('Workspace review verification tests passed.');
    }
    finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
if ((0, lib_js_1.isMainScript)(__filename)) {
    main();
}
