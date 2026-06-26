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
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const workspace_review_lib_js_1 = require("./workspace-review-lib.js");
const run_workspace_review_js_1 = require("./run-workspace-review.js");
const workspace_review_manifest_js_1 = require("./workspace-review-manifest.js");
const plan_review_mcp_js_1 = require("./plan-review-mcp.js");
function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function recordAttemptIfManifest(runDir, metadata) {
    if (fs.existsSync(path.join(runDir, 'run-manifest.json'))) {
        (0, workspace_review_manifest_js_1.recordResolvedExecution)(runDir, metadata);
    }
}
function settings(baseUrl, model = null) {
    return {
        env: {
            ANTHROPIC_BASE_URL: baseUrl,
            ...(model ? { ANTHROPIC_MODEL: model } : {}),
            ANTHROPIC_AUTH_TOKEN: 'test-auth-token',
        },
    };
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
function executionCoverage(overrides = {}) {
    return EXECUTION_BOUNDARIES.map((boundary) => ({
        boundary,
        status: 'covered',
        evidence_basis: 'plan_text',
        notes: `测试 fixture 覆盖 ${boundary} 边界。`,
        ...(overrides[boundary] || {}),
    }));
}
function configFixture(tempDir) {
    const settingsDir = path.join(tempDir, 'settings');
    writeJson(path.join(settingsDir, 'kimi.json'), settings('https://kimi.example'));
    writeJson(path.join(settingsDir, 'deepseek.json'), settings('https://gateway.example', 'deepseek'));
    writeJson(path.join(settingsDir, 'glm.json'), settings('https://gateway.example', 'glm'));
    writeJson(path.join(settingsDir, 'qwen.json'), settings('https://gateway.example', 'qwen'));
    const configFile = path.join(tempDir, 'workspace-review.json');
    writeJson(configFile, {
        version: 1,
        claude_bin: process.execPath,
        workspace_runs_dir: './runs',
        models: {
            kimi: {
                settings_file: './settings/kimi.json',
                required_env: ['ANTHROPIC_BASE_URL'],
            },
            deepseek: {
                settings_file: './settings/deepseek.json',
                required_env: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL'],
            },
            glm: {
                settings_file: './settings/glm.json',
                required_env: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL'],
            },
            qwen: {
                settings_file: './settings/qwen.json',
                required_env: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL'],
            },
        },
        roles: {
            risk: 'qwen',
            architecture: 'kimi',
            execution: 'kimi',
            rebuttal: 'glm',
            synthesis: 'kimi',
            planner: 'deepseek',
        },
        execution: {
            max_concurrency: 3,
            timeout_ms: 10000,
            max_buffer_bytes: 1048576,
            max_turns: 12,
        },
    });
    return { configFile, settingsDir };
}
function writeReviewerAttempt(runDir, role, model, status = 'completed') {
    const roleDir = path.join(runDir, 'roles', role);
    const output = {
        probe: role,
        issues: [],
        missing_questions: [],
        false_positive_risks: [],
    };
    if (role === 'execution') {
        output.coverage_declaration = {
            reviewed_boundaries: executionCoverage(),
            unverified_assumptions: [],
            not_reviewed: [],
        };
    }
    writeJson(path.join(roleDir, 'output.json'), output);
    const metadata = {
        role,
        model,
        status,
    };
    writeJson(path.join(roleDir, 'metadata.json'), metadata);
    recordAttemptIfManifest(runDir, metadata);
}
function writeFactCheckAttempt(runDir, model, status = 'completed') {
    const roleDir = path.join(runDir, 'roles', 'fact_check');
    writeJson(path.join(roleDir, 'output.json'), {
        probe: 'fact_check',
        checked_issues: [],
        source_summaries: [],
        limits: [],
    });
    writeJson(path.join(roleDir, 'fact-check-summary.json'), {
        total_checked: 0,
        challenged_count: 0,
    });
    const metadata = {
        role: 'fact_check',
        model,
        status,
    };
    writeJson(path.join(roleDir, 'metadata.json'), metadata);
    recordAttemptIfManifest(runDir, metadata);
}
function writeSynthesisAttempt(runDir, model, status = 'completed') {
    const roleDir = path.join(runDir, 'roles', 'synthesis');
    writeJson(path.join(roleDir, 'output.json'), {
        probe: 'synthesis',
        source_findings: [],
        process_map: {
            title: 'test',
            mermaid: 'flowchart TD\n  A[Test]',
            nodes: [
                {
                    id: 'A',
                    label: 'Test',
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
    });
    const metadata = {
        role: 'synthesis',
        model,
        status,
    };
    writeJson(path.join(roleDir, 'metadata.json'), metadata);
    recordAttemptIfManifest(runDir, metadata);
}
function createRetryRun(config, tempDir, runId, roles, retryCounts = {}) {
    const projectRoot = path.join(tempDir, `${runId}-project`);
    const runDir = path.join(tempDir, `${runId}-run`);
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(runDir, { recursive: true });
    const request = {
        run_id: runId,
        created_at: '2026-06-16T00:00:00.000Z',
        project_root: projectRoot,
        plan: '# Test plan',
        context: '',
        roles,
    };
    writeJson(path.join(runDir, 'request.json'), request);
    writeJson(path.join(runDir, 'state.json'), {
        run_id: runId,
        project_root: projectRoot,
        roles,
        status: 'failed',
        retry_counts: retryCounts,
    });
    (0, workspace_review_manifest_js_1.createRunManifest)(config, request, runDir, {
        createdAt: request.created_at,
    });
    return {
        runDir,
        projectRoot,
        config: {
            ...config,
            execution: {
                ...config.execution,
                max_concurrency: 2,
            },
        },
    };
}
function retryExecutors(calls) {
    return {
        runRole: async (config, request, role, runDir) => {
            calls.reviewers.push(role);
            const model = config.roles[role];
            writeReviewerAttempt(runDir, role, model);
            return {
                role,
                model,
                output: {
                    probe: role,
                    issues: [],
                    missing_questions: [],
                    false_positive_risks: [],
                },
                output_file: path.join('roles', role, 'output.json'),
            };
        },
        runFactCheck: async (config, request, reviewerResults, runDir) => {
            calls.fact_check += 1;
            calls.fact_check_reviewers = reviewerResults.map((item) => item.role);
            const model = config.roles.fact_check;
            writeFactCheckAttempt(runDir, model);
            return {
                role: 'fact_check',
                model,
                output: {
                    probe: 'fact_check',
                    checked_issues: [],
                    source_summaries: [],
                    limits: [],
                },
                output_file: 'roles/fact_check/output.json',
                summary: {
                    total_checked: 0,
                    challenged_count: 0,
                },
                summary_file: 'roles/fact_check/fact-check-summary.json',
            };
        },
        runSynthesis: async (config, request, reviewerResults, factCheck, runDir) => {
            calls.synthesis += 1;
            calls.synthesis_reviewers = reviewerResults.map((item) => item.role);
            calls.synthesis_fact_check_probe = factCheck.output.probe;
            const model = config.roles.synthesis;
            writeSynthesisAttempt(runDir, model);
            return {
                role: 'synthesis',
                model,
                output: {
                    probe: 'synthesis',
                    source_findings: [],
                    process_map: {
                        title: 'test',
                        mermaid: 'flowchart TD\n  A[Test]',
                        nodes: [
                            {
                                id: 'A',
                                label: 'Test',
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
                output_file: 'roles/synthesis/output.json',
            };
        },
    };
}
async function main() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-mcp-test-'));
    const server = path.join(__dirname, 'plan-review-mcp.js');
    try {
        const { configFile, settingsDir } = configFixture(tempDir);
        const config = (0, workspace_review_lib_js_1.loadWorkspaceReviewConfig)(configFile);
        node_assert_1.default.equal(config.roles.risk, 'qwen');
        node_assert_1.default.equal(config.models.kimi.summary.auth_env, 'ANTHROPIC_AUTH_TOKEN');
        node_assert_1.default.equal((0, workspace_review_lib_js_1.configSummary)(config).models.qwen.model, 'qwen');
        const directoryConfig = (0, workspace_review_lib_js_1.loadWorkspaceReviewSettingsDirectory)(settingsDir, {
            validateClaudeBin: false,
        });
        node_assert_1.default.equal(directoryConfig.config_file, null);
        node_assert_1.default.equal(directoryConfig.settings_dir, settingsDir);
        node_assert_1.default.deepEqual(directoryConfig.loader_args, ['--settings-dir', settingsDir]);
        node_assert_1.default.equal(directoryConfig.roles.risk, 'kimi');
        node_assert_1.default.equal(directoryConfig.roles.fact_check, 'glm');
        node_assert_1.default.equal(directoryConfig.roles.synthesis, 'glm');
        node_assert_1.default.equal(directoryConfig.roles.planner, 'kimi');
        node_assert_1.default.equal(directoryConfig.execution.max_concurrency, 4);
        node_assert_1.default.equal(directoryConfig.execution.isolate_reviewers, true);
        node_assert_1.default.equal(directoryConfig.execution.read_scope_max_files, 80);
        node_assert_1.default.equal(directoryConfig.models.glm.settings_file, path.join(settingsDir, 'glm.json'));
        node_assert_1.default.equal((0, workspace_review_lib_js_1.configSummary)(directoryConfig).role_route_source.score_version, 'manual-v4');
        const logRunDir = path.join(tempDir, 'log-run');
        fs.mkdirSync(logRunDir);
        (0, workspace_review_lib_js_1.appendExecutionLog)(logRunDir, 'agent_started', {
            role: 'risk',
            model: 'qwen',
        });
        const executionLog = fs.readFileSync((0, workspace_review_lib_js_1.executionLogPath)(logRunDir), 'utf8');
        (0, node_assert_1.default)(executionLog.includes('agent_started'));
        (0, node_assert_1.default)(executionLog.includes('role="risk"'));
        (0, node_assert_1.default)(executionLog.includes('model="qwen"'));
        (0, node_assert_1.default)(!executionLog.includes('test-auth-token'));
        const prompt = (0, workspace_review_lib_js_1.buildWorkspacePrompt)('risk', tempDir, '检查当前计划', '只允许只读访问');
        (0, node_assert_1.default)(prompt.includes('检查当前计划'));
        (0, node_assert_1.default)(prompt.includes('现有工程文件的相对路径和行号'));
        (0, node_assert_1.default)(prompt.includes('未来代码、伪代码和示例'));
        (0, node_assert_1.default)(prompt.includes('不重新做关键业务或架构决策'));
        const projectRoot = path.join(tempDir, 'project');
        fs.mkdirSync(path.join(projectRoot, 'src', 'cdp'), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"scripts":{}}\n');
        fs.writeFileSync(path.join(projectRoot, 'tsconfig.json'), '{}\n');
        fs.writeFileSync(path.join(projectRoot, 'src', 'cli.ts'), 'export const cli = true;\n');
        fs.writeFileSync(path.join(projectRoot, 'src', 'cdp', 'extract.ts'), 'export const extract = true;\n');
        fs.writeFileSync(path.join(projectRoot, 'secret.txt'), 'do not copy\n');
        const readScope = (0, workspace_review_lib_js_1.buildRoleReadScope)('risk', projectRoot, ['修改 `src/cli.ts` 和 `src/cdp/extract.ts`。', `不要读取 ${path.join(tempDir, 'outside.ts')}。`].join('\n'), {
            maxFiles: 10,
        });
        node_assert_1.default.equal(readScope.files.length, 0, 'no Existing Code Refs section means no files exposed');
        const readScopeWithRefs = (0, workspace_review_lib_js_1.buildRoleReadScope)('risk', projectRoot, [
            '## Existing Code Refs',
            '- path: src/cli.ts',
            '  lines: 1-1',
            '  symbol: cli',
            '  reason: test',
            '',
            '## Tasks',
            '修改 `src/cli.ts` 和 `src/cdp/extract.ts`。',
            `不要读取 ${path.join(tempDir, 'outside.ts')}。`,
        ].join('\n'), {
            maxFiles: 10,
        });
        (0, node_assert_1.default)(readScopeWithRefs.files.includes('src/cli.ts'));
        (0, node_assert_1.default)(!readScopeWithRefs.files.includes('src/cdp/extract.ts'), 'only files in Existing Code Refs are exposed');
        (0, node_assert_1.default)(!readScopeWithRefs.files.includes('package.json'), 'COMMON_PROJECT_FILES not unconditionally exposed');
        (0, node_assert_1.default)(!readScopeWithRefs.files.includes('secret.txt'));
        fs.mkdirSync(path.join(projectRoot, 'src', 'screens', 'main', 'mine'), { recursive: true });
        fs.mkdirSync(path.join(projectRoot, 'src', 'navigation'), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'src', 'screens', 'main', 'mine', 'index.tsx'), 'export const Mine = true;\n');
        fs.writeFileSync(path.join(projectRoot, 'src', 'navigation', 'index.tsx'), 'export const Navigation = true;\n');
        const readScopeWithChineseMapping = (0, workspace_review_lib_js_1.buildRoleReadScope)('risk', projectRoot, [
            '## 3. 现有代码映射',
            '`screens/main/mine/index.tsx:1`：Mine tab 不要求登录。',
            '`navigation/index.tsx:1`：路由配置。',
            '',
            '## 4. 任务',
            '其他章节提到 `src/cdp/extract.ts`，不应暴露。',
        ].join('\n'), {
            maxFiles: 10,
        });
        (0, node_assert_1.default)(readScopeWithChineseMapping.files.includes('src/screens/main/mine/index.tsx'));
        (0, node_assert_1.default)(readScopeWithChineseMapping.files.includes('src/navigation/index.tsx'));
        (0, node_assert_1.default)(!readScopeWithChineseMapping.files.includes('src/cdp/extract.ts'));
        const mirrorParent = fs.mkdtempSync(path.join(tempDir, 'mirror-'));
        const boundary = (0, workspace_review_lib_js_1.copyScopedWorkspace)(projectRoot, readScopeWithRefs, mirrorParent);
        (0, node_assert_1.default)(fs.existsSync(path.join(boundary.exposed_root, 'src', 'cli.ts')));
        (0, node_assert_1.default)(!fs.existsSync(path.join(boundary.exposed_root, 'secret.txt')));
        fs.rmSync(mirrorParent, { recursive: true, force: true });
        const factScope = (0, workspace_review_lib_js_1.buildFactCheckReadScope)(projectRoot, {
            'Risk Reviewer': {
                issues: [
                    {
                        evidence: 'src/cli.ts:1 shows cli',
                        why_it_matters: 'package.json scripts consume it',
                    },
                ],
            },
        }, {
            maxFiles: 10,
        });
        (0, node_assert_1.default)(factScope.files.includes('src/cli.ts'));
        (0, node_assert_1.default)(!factScope.files.includes('package.json'), 'Fact Check should not receive common project files unless Reviewer evidence cites them');
        const factScopeWithConfigEvidence = (0, workspace_review_lib_js_1.buildFactCheckReadScope)(projectRoot, {
            'Risk Reviewer': {
                issues: [
                    {
                        evidence: '`package.json:1` defines scripts',
                    },
                ],
            },
        }, {
            maxFiles: 10,
        });
        (0, node_assert_1.default)(factScopeWithConfigEvidence.files.includes('package.json'), 'Fact Check should receive a project config when Reviewer evidence explicitly cites it');
        const factScopeWithPlanRefs = (0, workspace_review_lib_js_1.buildFactCheckReadScope)(projectRoot, {
            'Risk Reviewer': {
                issues: [
                    {
                        evidence: 'src/cli.ts:1 shows cli',
                        why_it_matters: 'package.json scripts consume it',
                    },
                ],
            },
        }, {
            maxFiles: 10,
            plan: ['## 3. 现有代码映射', '- `src/cdp`', '', '## 4. 任务', '- 其他章节提到 `secret.txt`，不应暴露。'].join('\n'),
        });
        (0, node_assert_1.default)(factScopeWithPlanRefs.files.includes('src/cli.ts'));
        (0, node_assert_1.default)(factScopeWithPlanRefs.files.includes('src/cdp/extract.ts'), 'Fact Check should receive files from Plan Existing Code Refs as supporting evidence');
        (0, node_assert_1.default)(!factScopeWithPlanRefs.files.includes('package.json'), 'Fact Check should still ignore non-evidence impact text when plan refs are provided');
        (0, node_assert_1.default)(!factScopeWithPlanRefs.files.includes('secret.txt'));
        const factCheckPrompt = (0, workspace_review_lib_js_1.buildWorkspacePrompt)('fact_check', tempDir, '检查当前计划', '', {
            'Risk Reviewer': {
                probe: 'risk',
                issues: [
                    {
                        title: '配置值不一致',
                        type: 'risk',
                        severity: 'high',
                        evidence: 'packages/example.ts:1 rounds: 30',
                        why_it_matters: '计划要求 15',
                        confidence: 0.9,
                    },
                ],
                missing_questions: [],
                false_positive_risks: [],
            },
        }, null, {
            mode: 'scoped_mirror',
            files: ['packages/example.ts'],
            blocked_refs: [],
            skipped_refs: [],
        });
        (0, node_assert_1.default)(factCheckPrompt.includes('Fact Judge'));
        (0, node_assert_1.default)(factCheckPrompt.includes('只能使用 Read'));
        (0, node_assert_1.default)(factCheckPrompt.includes('"probe": "fact_check"'));
        (0, node_assert_1.default)(factCheckPrompt.includes('# Reviewer Issue IDs'));
        (0, node_assert_1.default)(factCheckPrompt.includes('"issue_id": "Risk-Reviewer-001"'));
        (0, node_assert_1.default)(factCheckPrompt.includes('## Risk Reviewer'));
        (0, node_assert_1.default)(factCheckPrompt.includes('读取边界'));
        (0, node_assert_1.default)(factCheckPrompt.includes('packages/example.ts'));
        const longPlan = [
            '# 实施计划',
            '',
            '```ts',
            "import { test, expect } from 'bun:test';",
            'export async function clearStaticCacheWithPage(page: PageLike) {',
            '  const client = await page.target().createCDPSession();',
            "  await client.send('Network.clearBrowserCache');",
            '  return { ok: true };',
            '}',
            "test('clearStaticCacheWithPage clears cache', async () => {",
            '  expect(await clearStaticCacheWithPage(page)).toEqual({ ok: true });',
            '});',
            'export async function clearHostResolverCache(browser: BrowserLike) {',
            '  const context = await browser.createBrowserContext();',
            '  const page = await context.newPage();',
            "  await page.goto('chrome://net-internals/#dns');",
            "  await page.evaluate(() => document.querySelector('#dns-view-clear-cache')?.click());",
            '  await page.close();',
            '  await context.close();',
            '  return { ok: true };',
            '}',
            ...Array.from({ length: 30 }, (_, index) => [
                `const step${index} = await runDetailedImplementationStep(${index});`,
                `expect(step${index}.ok).toBe(true);`,
            ]).flat(),
            '```',
            '',
            '```bash',
            'bun test test/dns-cache.test.ts',
            '```',
        ].join('\n');
        const compactedPlan = (0, workspace_review_lib_js_1.compactPlanForReview)(longPlan);
        (0, node_assert_1.default)(compactedPlan.text.includes('```pseudo'));
        (0, node_assert_1.default)(compactedPlan.text.includes('非权威摘要'));
        (0, node_assert_1.default)(compactedPlan.text.includes('决策完备'));
        (0, node_assert_1.default)(compactedPlan.text.includes('源码 artifact：proposed-code/block-001.ts:1-'));
        (0, node_assert_1.default)(compactedPlan.text.includes('legacy 传输兼容机制'));
        (0, node_assert_1.default)(compactedPlan.text.includes('声明/入口'));
        (0, node_assert_1.default)(compactedPlan.text.includes('测试意图'));
        (0, node_assert_1.default)(compactedPlan.text.includes('```bash'));
        node_assert_1.default.equal(compactedPlan.stats.code_blocks, 2);
        node_assert_1.default.equal(compactedPlan.stats.compacted_blocks, 1);
        node_assert_1.default.equal(compactedPlan.stats.proposed_artifact_count, 1);
        node_assert_1.default.equal(compactedPlan.artifacts.length, 1);
        node_assert_1.default.equal(compactedPlan.artifacts[0].relative_path, 'proposed-code/block-001.ts');
        node_assert_1.default.equal(compactedPlan.artifacts[0].review_semantics, 'plan_draft');
        node_assert_1.default.equal(compactedPlan.artifacts[0].expected_completeness, 'not_compile_target');
        (0, node_assert_1.default)(compactedPlan.artifacts[0].content.includes('clearHostResolverCache'));
        (0, node_assert_1.default)(compactedPlan.stats.implementation_detail_chars > 0);
        (0, node_assert_1.default)(compactedPlan.stats.implementation_detail_lines > 0);
        node_assert_1.default.equal(compactedPlan.stats.plan_bloat_warning, true);
        (0, node_assert_1.default)(compactedPlan.stats.saved_chars > 0);
        const proposedArtifactDir = path.join(tempDir, 'artifact-source');
        const proposedArtifacts = compactedPlan.artifacts.map((artifact) => {
            const sourceFile = path.join(proposedArtifactDir, artifact.relative_path);
            fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
            fs.writeFileSync(sourceFile, artifact.content, 'utf8');
            return {
                ...artifact,
                source_file: sourceFile,
                content: null,
            };
        });
        const artifactScope = (0, workspace_review_lib_js_1.buildRoleReadScope)('risk', projectRoot, compactedPlan.text, {
            maxFiles: 10,
            proposedArtifacts,
        });
        (0, node_assert_1.default)(artifactScope.files.includes('proposed-code/block-001.ts'));
        node_assert_1.default.equal(artifactScope.proposed_artifacts.length, 1);
        const artifactMirrorParent = fs.mkdtempSync(path.join(tempDir, 'artifact-mirror-'));
        const artifactBoundary = (0, workspace_review_lib_js_1.copyScopedWorkspace)(projectRoot, artifactScope, artifactMirrorParent);
        (0, node_assert_1.default)(fs.existsSync(path.join(artifactBoundary.exposed_root, 'proposed-code', 'block-001.ts')));
        (0, node_assert_1.default)(fs
            .readFileSync(path.join(artifactBoundary.exposed_root, 'proposed-code', 'block-001.ts'), 'utf8')
            .includes('clearHostResolverCache'));
        fs.rmSync(artifactMirrorParent, { recursive: true, force: true });
        const refs = (0, workspace_review_lib_js_1.createPlanReferenceManifest)(projectRoot, ['## Existing Code Refs', '- `src/cli.ts:1-1`', '- `/outside/project.ts:10`'].join('\n'), []);
        node_assert_1.default.equal(refs.format_status.has_existing_code_refs_section, true);
        node_assert_1.default.equal(refs.format_status.has_proposed_code_artifacts_section, false);
        node_assert_1.default.equal(refs.format_status.refs_scoped_to_existing_code_refs_section, true);
        (0, node_assert_1.default)(refs.existing_code_refs.some((item) => item.path === 'src/cli.ts' && item.line_ref === '1-1'));
        node_assert_1.default.deepEqual(refs.existing_code_ref_dirs, []);
        node_assert_1.default.deepEqual(refs.proposed_code_artifacts, []);
        (0, node_assert_1.default)(refs.blocked_refs.includes('/outside/project.ts'));
        const chineseRefs = (0, workspace_review_lib_js_1.createPlanReferenceManifest)(projectRoot, [
            '## 3. 现有代码映射',
            '- `screens/main/mine/index.tsx:1`',
            '- `navigation/index.tsx:1`',
            '- `src/cdp`',
            '',
            '## 4. 任务',
            '- 其他章节提到 `src/cdp/extract.ts`，但不应计入 Existing Code Refs manifest。',
        ].join('\n'), []);
        node_assert_1.default.equal(chineseRefs.format_status.has_existing_code_refs_section, true);
        node_assert_1.default.equal(chineseRefs.format_status.has_existing_code_mapping_section, true);
        node_assert_1.default.equal(chineseRefs.format_status.refs_scoped_to_existing_code_refs_section, true);
        (0, node_assert_1.default)(chineseRefs.existing_code_refs.some((item) => item.path === 'src/screens/main/mine/index.tsx' && item.line_ref === '1'));
        (0, node_assert_1.default)(chineseRefs.existing_code_refs.some((item) => item.path === 'src/navigation/index.tsx' && item.line_ref === '1'));
        (0, node_assert_1.default)(chineseRefs.existing_code_ref_dirs.some((item) => item.path === 'src/cdp'));
        (0, node_assert_1.default)(!chineseRefs.skipped_refs.includes('src/cdp'));
        (0, node_assert_1.default)(!chineseRefs.existing_code_refs.some((item) => item.path === 'src/cdp/extract.ts'));
        const riskValidatorLog = path.join(tempDir, 'risk.validator.log');
        node_assert_1.default.throws(() => (0, workspace_review_lib_js_1.buildClaudeWorkspaceArgs)(config, 'qwen', 'risk', tempDir), /Missing validator log file/);
        const args = (0, workspace_review_lib_js_1.buildClaudeWorkspaceArgs)(config, 'qwen', 'risk', tempDir, {
            validatorLogFile: riskValidatorLog,
        });
        node_assert_1.default.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep');
        node_assert_1.default.equal(args[args.indexOf('--allowed-tools') + 1], 'Read,Glob,Grep,mcp__json_validator__validate_json_output');
        node_assert_1.default.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
        node_assert_1.default.equal(args[args.indexOf('--add-dir') + 1], tempDir);
        (0, node_assert_1.default)(!args.includes('Bash'));
        (0, node_assert_1.default)(!args.includes('Edit'));
        (0, node_assert_1.default)(!args.includes('Write'));
        (0, node_assert_1.default)(!args.includes('--no-session-persistence'));
        const factCheckArgs = (0, workspace_review_lib_js_1.buildClaudeWorkspaceArgs)(config, 'glm', 'fact_check', tempDir, {
            tools: 'Read',
            allowProjectRead: true,
            validatorLogFile: path.join(tempDir, 'fact-check.validator.log'),
        });
        node_assert_1.default.equal(factCheckArgs[factCheckArgs.indexOf('--tools') + 1], 'Read');
        node_assert_1.default.equal(factCheckArgs[factCheckArgs.indexOf('--allowed-tools') + 1], 'Read,mcp__json_validator__validate_json_output');
        node_assert_1.default.equal(factCheckArgs[factCheckArgs.indexOf('--add-dir') + 1], tempDir);
        (0, node_assert_1.default)(!factCheckArgs.includes('--no-session-persistence'));
        const synthesisArgs = (0, workspace_review_lib_js_1.buildClaudeWorkspaceArgs)(config, 'kimi', 'synthesis', tempDir, {
            tools: '',
            allowProjectRead: false,
            validatorLogFile: path.join(tempDir, 'synthesis.validator.log'),
        });
        node_assert_1.default.equal(synthesisArgs[synthesisArgs.indexOf('--tools') + 1], '');
        node_assert_1.default.equal(synthesisArgs[synthesisArgs.indexOf('--allowed-tools') + 1], 'mcp__json_validator__validate_json_output');
        (0, node_assert_1.default)(!synthesisArgs.includes('--add-dir'));
        (0, node_assert_1.default)(!synthesisArgs.includes('--no-session-persistence'));
        (0, node_assert_1.default)(args[args.indexOf('--system-prompt') + 1].includes('Return only one raw JSON object'));
        (0, node_assert_1.default)(args[args.indexOf('--system-prompt') + 1].includes('mcp__json_validator__validate_json_output'));
        for (const [role, model, roleArgs, validatorLog] of [
            ['risk', 'qwen', args, riskValidatorLog],
            ['fact_check', 'glm', factCheckArgs, path.join(tempDir, 'fact-check.validator.log')],
            ['synthesis', 'kimi', synthesisArgs, path.join(tempDir, 'synthesis.validator.log')],
        ]) {
            const mcpConfig = JSON.parse(roleArgs[roleArgs.indexOf('--mcp-config') + 1]);
            const validator = mcpConfig.mcpServers.json_validator;
            node_assert_1.default.equal(validator.command, process.execPath);
            (0, node_assert_1.default)(validator.args[0].endsWith('scripts/json-validator-mcp.js'));
            node_assert_1.default.equal(validator.env.MODEL_ROLE_CALIBRATION_MODEL, model);
            node_assert_1.default.equal(validator.env.MODEL_ROLE_CALIBRATION_PROBE, role);
            node_assert_1.default.equal(validator.env.MODEL_ROLE_CALIBRATION_VALIDATOR_LOG, validatorLog);
        }
        node_assert_1.default.doesNotThrow(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('fact_check', {
            probe: 'fact_check',
            checked_issues: [],
            source_summaries: [],
            limits: [],
        }));
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', {
            probe: 'synthesis',
            source_findings: [],
            process_map: {
                title: 'test',
                mermaid: 'flowchart TD',
                nodes: [],
            },
            consensus_issues: [],
            disagreements: [],
            likely_false_positives: [],
            revision_instructions: [],
        }), /expected at least 1 item/);
        const outOfScopeFactCheck = {
            probe: 'fact_check',
            checked_issues: [
                {
                    issue_id: 'Architecture-Reviewer-001',
                    source: 'Architecture Reviewer',
                    issue_title: '必须建设在线 marketplace',
                    status: 'verified',
                    scope_status: 'out_of_scope',
                    evidence_status: 'plan_only',
                    claim_support: 'direct',
                    reason: '需求明确排除在线 marketplace',
                    checked_files: [],
                },
            ],
            source_summaries: [],
            limits: [],
        };
        const validDiscardedSynthesis = {
            probe: 'synthesis',
            source_findings: [
                {
                    id: 'F1',
                    source: 'Architecture Reviewer',
                    source_title: '必须建设在线 marketplace',
                    source_issue_id: 'Architecture-Reviewer-001',
                    fact_check_status: 'verified',
                    scope_status: 'out_of_scope',
                    disposition: 'out_of_scope',
                    reason: '与需求范围冲突',
                },
            ],
            process_map: {
                title: 'test',
                mermaid: 'flowchart TD\n  A[Test]',
                nodes: [
                    {
                        id: 'A',
                        label: 'Test',
                        stage: 'test',
                        status: 'normal',
                        related_issue_titles: [],
                        evidence: '当前计划',
                    },
                ],
            },
            consensus_issues: [],
            disagreements: [],
            likely_false_positives: [
                {
                    source_finding_ids: ['F1'],
                    reason: '需求明确排除在线 marketplace',
                },
            ],
            revision_instructions: [],
        };
        node_assert_1.default.doesNotThrow(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', validDiscardedSynthesis, { factCheckOutput: outOfScopeFactCheck }));
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', {
            ...validDiscardedSynthesis,
            disagreements: [
                {
                    title: '是否建设 marketplace',
                    positions: [
                        {
                            source: 'Architecture Reviewer',
                            position: '建设',
                            reason: 'reviewer 建议',
                        },
                        {
                            source: '需求',
                            position: '不建设',
                            reason: '明确范围',
                        },
                    ],
                    affected_nodes: ['A'],
                    source_finding_ids: ['F1'],
                    level: 'L3_direction_decision',
                    needs_human_decision: true,
                    decision_options: ['建设', '不建设'],
                },
            ],
        }, { factCheckOutput: outOfScopeFactCheck }), /excluded finding F1 re-entered/);
        const verifiedFactCheck = {
            probe: 'fact_check',
            checked_issues: [
                {
                    issue_id: 'Risk-Reviewer-001',
                    source: 'Risk Reviewer',
                    issue_title: '缓存清理缺少验证',
                    status: 'verified',
                    scope_status: 'in_scope',
                    evidence_status: 'quote_matches',
                    claim_support: 'direct',
                    reason: '工程证据支持该风险',
                    checked_files: ['src/cache.ts'],
                },
            ],
            source_summaries: [],
            limits: [],
        };
        const verifiedSynthesis = {
            probe: 'synthesis',
            source_findings: [
                {
                    id: 'F1',
                    source: 'Risk Reviewer',
                    source_title: '缓存清理缺少验证',
                    source_issue_id: 'Risk-Reviewer-001',
                    fact_check_status: 'verified',
                    scope_status: 'in_scope',
                    disposition: 'retained',
                    reason: 'Fact Check 已验证',
                },
            ],
            process_map: {
                title: 'cache flow',
                mermaid: 'flowchart TD\n  A[Cache clear]',
                nodes: [
                    {
                        id: 'A',
                        label: 'Cache clear',
                        stage: 'execution',
                        status: 'affected',
                        related_issue_titles: ['缓存清理缺少验证'],
                        evidence: 'Reviewer 和 Fact Check 均引用 src/cache.ts',
                    },
                ],
            },
            consensus_issues: [
                {
                    title: '缓存清理缺少验证',
                    merged_from: ['Risk Reviewer'],
                    severity: 'high',
                    affected_nodes: ['A'],
                    source_finding_ids: ['F1'],
                    reason: '验证步骤缺失',
                    required_plan_change: '补充验证标准',
                },
            ],
            disagreements: [],
            likely_false_positives: [],
            revision_instructions: [
                {
                    instruction: '补充缓存清理后的验证标准。',
                    source_finding_ids: ['F1'],
                },
            ],
        };
        node_assert_1.default.doesNotThrow(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', verifiedSynthesis, { factCheckOutput: verifiedFactCheck }));
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', {
            ...verifiedSynthesis,
            consensus_issues: [
                {
                    ...verifiedSynthesis.consensus_issues[0],
                    affected_nodes: ['MissingNode'],
                },
            ],
        }, { factCheckOutput: verifiedFactCheck }), /unknown process_map node MissingNode/);
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', {
            ...verifiedSynthesis,
            process_map: {
                ...verifiedSynthesis.process_map,
                nodes: [
                    {
                        ...verifiedSynthesis.process_map.nodes[0],
                        related_issue_titles: ['不存在的问题标题'],
                    },
                ],
            },
        }, { factCheckOutput: verifiedFactCheck }), /unknown issue title 不存在的问题标题/);
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', {
            ...verifiedSynthesis,
            likely_false_positives: [
                {
                    source_finding_ids: ['F1'],
                    reason: '错误地把已保留 finding 当作误报',
                },
            ],
        }, { factCheckOutput: verifiedFactCheck }), /likely_false_positives cannot reference retained finding F1/);
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', {
            ...verifiedSynthesis,
            source_findings: [
                {
                    ...verifiedSynthesis.source_findings[0],
                    disposition: 'unsupported',
                },
            ],
        }, { factCheckOutput: verifiedFactCheck }), /verified finding cannot use disposition unsupported/);
        const partiallyVerifiedFactCheck = {
            ...verifiedFactCheck,
            checked_issues: [
                {
                    ...verifiedFactCheck.checked_issues[0],
                    status: 'partially_verified',
                    claim_support: 'partial',
                    reason: '只验证了核心事实，严重度缺少充分证据',
                },
            ],
        };
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', {
            ...verifiedSynthesis,
            source_findings: [
                {
                    ...verifiedSynthesis.source_findings[0],
                    fact_check_status: 'partially_verified',
                },
            ],
            consensus_issues: [
                {
                    ...verifiedSynthesis.consensus_issues[0],
                    severity: 'blocker',
                },
            ],
        }, {
            factCheckOutput: partiallyVerifiedFactCheck,
            reviewerOutputs: {
                'Risk Reviewer': {
                    issues: [
                        {
                            title: '缓存清理缺少验证',
                            severity: 'medium',
                        },
                    ],
                },
            },
        }), /partially_verified finding F1 severity blocker exceeds reviewer severity medium/);
        const partiallyVerifiedRetainedSynthesis = {
            ...verifiedSynthesis,
            source_findings: [
                {
                    ...verifiedSynthesis.source_findings[0],
                    fact_check_status: 'partially_verified',
                    disposition: 'retained',
                    reason: '核心事实成立，但阻塞性缺少充分证据；仅保留来源，不生成修订。',
                },
            ],
            process_map: {
                title: 'cache flow',
                mermaid: 'flowchart TD\n  A[Cache clear]',
                nodes: [
                    {
                        id: 'A',
                        label: 'Cache clear',
                        stage: 'execution',
                        status: 'normal',
                        related_issue_titles: [],
                        evidence: 'Fact Check 仅部分验证，当前不形成主动修订。',
                    },
                ],
            },
            consensus_issues: [],
            disagreements: [],
            likely_false_positives: [],
            revision_instructions: [],
        };
        node_assert_1.default.doesNotThrow(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', partiallyVerifiedRetainedSynthesis, {
            factCheckOutput: partiallyVerifiedFactCheck,
        }));
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', {
            ...partiallyVerifiedRetainedSynthesis,
            likely_false_positives: [
                {
                    source_finding_ids: ['F1'],
                    reason: '错误地把 retained 的 partially_verified finding 放入误报。',
                },
            ],
        }, { factCheckOutput: partiallyVerifiedFactCheck }), /likely_false_positives cannot reference retained finding F1/);
        const readyOutcome = (0, run_workspace_review_js_1.summarizeReviewOutcome)([
            {
                role: 'risk',
                output: {
                    issues: [],
                },
            },
        ], {
            summary: {
                total_checked: 0,
                challenged_count: 0,
            },
        }, {
            output: {
                consensus_issues: [],
                disagreements: [],
                revision_instructions: [],
            },
        }, []);
        node_assert_1.default.equal(readyOutcome.status, 'plan_ready');
        const lintBlockedOutcome = (0, run_workspace_review_js_1.summarizeReviewOutcome)([
            {
                role: 'risk',
                output: {
                    issues: [],
                },
            },
        ], {
            summary: {
                total_checked: 0,
                challenged_count: 0,
            },
        }, {
            output: {
                consensus_issues: [],
                disagreements: [],
                revision_instructions: [],
            },
        }, [], {
            errors: [
                {
                    code: 'implementation_code_block',
                    message: 'Plan contains complete Hook implementation',
                },
            ],
            warnings: [],
            metrics: {
                total_lines: 120,
            },
        });
        node_assert_1.default.equal(lintBlockedOutcome.status, 'needs_revision');
        node_assert_1.default.equal(lintBlockedOutcome.authoring_lint_error_count, 1);
        const infraOutcome = (0, run_workspace_review_js_1.summarizeReviewOutcome)([
            {
                role: 'risk',
                output: {
                    issues: [],
                },
            },
        ], {
            summary: {
                total_checked: 0,
                challenged_count: 0,
            },
        }, {
            output: {
                consensus_issues: [],
                disagreements: [],
                revision_instructions: [],
            },
        }, [
            {
                role: 'rebuttal',
                model: 'glm',
                type: 'invalid_output',
            },
        ]);
        node_assert_1.default.equal(infraOutcome.status, 'review_completed_with_infra_errors');
        const reviewerFailure = (0, run_workspace_review_js_1.reviewerStageError)([
            {
                role: 'risk',
                output: {
                    issues: [],
                },
            },
        ], [
            {
                role: 'execution',
                model: 'kimi',
                type: 'agent_failed',
                message: 'timed out after 900000ms',
            },
        ]);
        (0, node_assert_1.default)(reviewerFailure);
        (0, node_assert_1.default)(reviewerFailure.message.includes('before fact_check'));
        node_assert_1.default.deepEqual(reviewerFailure.completedReviewerRoles, ['risk']);
        node_assert_1.default.deepEqual(reviewerFailure.failedReviewerRoles, ['execution']);
        node_assert_1.default.equal(reviewerFailure.infraErrors.length, 1);
        let apiKeyRead = false;
        const inheritedEnv = {
            SAFE_VALUE: 'safe',
        };
        Object.defineProperty(inheritedEnv, 'ANTHROPIC_API_KEY', {
            enumerable: true,
            get() {
                apiKeyRead = true;
                throw new Error('ANTHROPIC_API_KEY must not be read');
            },
        });
        node_assert_1.default.deepEqual((0, workspace_review_lib_js_1.withoutAnthropicApiKey)(inheritedEnv), {
            SAFE_VALUE: 'safe',
        });
        node_assert_1.default.equal(apiKeyRead, false);
        const forbiddenFile = path.join(settingsDir, 'qwen.json');
        fs.writeFileSync(forbiddenFile, JSON.stringify({
            env: {
                ANTHROPIC_BASE_URL: 'https://gateway.example',
                ANTHROPIC_MODEL: 'qwen',
                ANTHROPIC_API_KEY: 'must-not-be-read',
            },
        }));
        node_assert_1.default.throws(() => (0, workspace_review_lib_js_1.loadWorkspaceReviewConfig)(configFile, { validateClaudeBin: false }), /forbidden ANTHROPIC_API_KEY/);
        writeJson(forbiddenFile, settings('https://gateway.example', 'qwen'));
        fs.unlinkSync(path.join(settingsDir, 'glm.json'));
        node_assert_1.default.throws(() => (0, workspace_review_lib_js_1.loadWorkspaceReviewSettingsDirectory)(settingsDir, { validateClaudeBin: false }), /Missing settings file for model "glm"/);
        writeJson(path.join(settingsDir, 'glm.json'), settings('https://gateway.example', 'glm'));
        node_assert_1.default.deepEqual((0, plan_review_mcp_js_1.toolList)().map((tool) => tool.name), ['configuration_status', 'start_plan_review', 'retry_plan_review_stage', 'get_plan_review']);
        const startTool = (0, plan_review_mcp_js_1.toolList)().find((tool) => tool.name === 'start_plan_review');
        const retryTool = (0, plan_review_mcp_js_1.toolList)().find((tool) => tool.name === 'retry_plan_review_stage');
        const getTool = (0, plan_review_mcp_js_1.toolList)().find((tool) => tool.name === 'get_plan_review');
        (0, node_assert_1.default)(startTool.description.includes('同一计划只调用一次'));
        node_assert_1.default.equal(startTool.inputSchema.oneOf.length, 2);
        (0, node_assert_1.default)(startTool.inputSchema.properties.plan_file.description.includes('优先使用'));
        (0, node_assert_1.default)(startTool.inputSchema.properties.project_root.description.includes('CLAUDE_PROJECT_DIR'));
        (0, node_assert_1.default)(retryTool.description.includes('stage=reviewers'));
        (0, node_assert_1.default)(retryTool.description.includes('stage=fact_check'));
        (0, node_assert_1.default)(retryTool.description.includes('stage=synthesis'));
        (0, node_assert_1.default)(retryTool.description.includes('最多重试 3 次'));
        node_assert_1.default.deepEqual(retryTool.inputSchema.properties.stage.enum, ['reviewers', 'fact_check', 'synthesis']);
        (0, node_assert_1.default)(getTool.description.includes('progress notification'));
        (0, node_assert_1.default)(getTool.description.includes('禁止使用 Bash'));
        node_assert_1.default.equal(getTool.inputSchema.properties.wait_ms.default, undefined);
        node_assert_1.default.equal(getTool.annotations.readOnlyHint, true);
        const planFile = path.join(tempDir, 'plan.md');
        fs.writeFileSync(planFile, '# 实施计划\n\n1. 更新配置。\n', 'utf8');
        node_assert_1.default.deepEqual((0, plan_review_mcp_js_1.resolvePlanInput)({
            plan_file: planFile,
        }), {
            plan: '# 实施计划\n\n1. 更新配置。\n',
            plan_file: planFile,
        });
        node_assert_1.default.deepEqual((0, plan_review_mcp_js_1.resolvePlanInput)({
            plan: '# 内联计划',
        }), {
            plan: '# 内联计划',
            plan_file: null,
        });
        node_assert_1.default.throws(() => (0, plan_review_mcp_js_1.resolvePlanInput)({}), /exactly one of plan or plan_file/);
        node_assert_1.default.throws(() => (0, plan_review_mcp_js_1.resolvePlanInput)({
            plan: '# 内联计划',
            plan_file: planFile,
        }), /exactly one of plan or plan_file/);
        node_assert_1.default.throws(() => (0, plan_review_mcp_js_1.resolvePlanInput)({
            plan_file: 'relative-plan.md',
        }), /absolute path/);
        const synthesisSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'synthesis-output.schema.json'), 'utf8'));
        const factCheckSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'fact-check-output.schema.json'), 'utf8'));
        node_assert_1.default.equal(factCheckSchema.properties.probe.const, 'fact_check');
        (0, node_assert_1.default)(factCheckSchema.properties.checked_issues.items.required.includes('issue_id'));
        (0, node_assert_1.default)(factCheckSchema.properties.checked_issues.items.required.includes('scope_status'));
        (0, node_assert_1.default)(synthesisSchema.required.includes('process_map'));
        (0, node_assert_1.default)(synthesisSchema.required.includes('source_findings'));
        (0, node_assert_1.default)(synthesisSchema.properties.consensus_issues.items.required.includes('affected_nodes'));
        (0, node_assert_1.default)(synthesisSchema.properties.consensus_issues.items.required.includes('source_finding_ids'));
        const executionSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'execution-output.schema.json'), 'utf8'));
        (0, node_assert_1.default)(executionSchema.required.includes('coverage_declaration'));
        (0, node_assert_1.default)(executionSchema.properties.coverage_declaration.properties.reviewed_boundaries.items.properties.boundary.enum.includes('implementation_discretion'));
        node_assert_1.default.equal(executionSchema.properties.coverage_declaration.properties.reviewed_boundaries.minItems, EXECUTION_BOUNDARIES.length);
        node_assert_1.default.doesNotThrow(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('execution', {
            probe: 'execution',
            coverage_declaration: {
                reviewed_boundaries: executionCoverage(),
                unverified_assumptions: [],
                not_reviewed: [],
            },
            issues: [],
            missing_questions: [],
            false_positive_risks: [],
        }));
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('execution', {
            probe: 'execution',
            coverage_declaration: {
                reviewed_boundaries: executionCoverage({
                    step_order: {
                        boundary: 'main_path',
                        notes: '重复声明。',
                    },
                }),
                unverified_assumptions: [],
                not_reviewed: [],
            },
            issues: [],
            missing_questions: [],
            false_positive_risks: [],
        }), /duplicate coverage boundary main_path|Schema validation failed/);
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('execution', {
            probe: 'execution',
            coverage_declaration: {
                reviewed_boundaries: executionCoverage({
                    acceptance: {
                        status: 'not_applicable',
                        notes: '验收边界未检查。',
                    },
                }),
                unverified_assumptions: [],
                not_reviewed: [],
            },
            issues: [
                {
                    title: '缺少验收标准',
                    type: 'acceptance',
                    severity: 'high',
                    evidence: '计划没有定义验收结果。',
                    why_it_matters: '无法判断完成。',
                    required_plan_detail: '补充验收标准。',
                    blocks_execution: true,
                    confidence: 0.9,
                },
            ],
            missing_questions: [],
            false_positive_risks: [],
        }), /type acceptance is not covered by coverage_declaration/);
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('execution', {
            probe: 'execution',
            coverage_declaration: {
                reviewed_boundaries: executionCoverage(),
                unverified_assumptions: [],
                not_reviewed: [],
            },
            issues: [
                {
                    title: '目录命名偏好',
                    type: 'preference',
                    severity: 'medium',
                    evidence: '计划允许实现者决定测试目录。',
                    why_it_matters: '这只是偏好。',
                    required_plan_detail: '无需补充。',
                    blocks_execution: true,
                    confidence: 0.9,
                },
            ],
            missing_questions: [],
            false_positive_risks: [],
        }), /preference issue "目录命名偏好" cannot block execution/);
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('execution', {
            probe: 'execution',
            issues: [],
            missing_questions: [],
            false_positive_risks: [],
        }), /coverage_declaration/);
        const synthesisPrompt = (0, workspace_review_lib_js_1.buildWorkspacePrompt)('synthesis', tempDir, '检查当前计划', '', {
            'Risk Reviewer': {
                probe: 'risk',
                issues: [],
                missing_questions: [],
                false_positive_risks: [],
            },
        }, {
            probe: 'fact_check',
            checked_issues: [],
            source_summaries: [],
            limits: [],
        });
        (0, node_assert_1.default)(synthesisPrompt.includes('"process_map"'));
        (0, node_assert_1.default)(synthesisPrompt.includes('"affected_nodes"'));
        (0, node_assert_1.default)(synthesisPrompt.includes('"source_findings"'));
        (0, node_assert_1.default)(synthesisPrompt.includes('Fact Check 报告'));
        (0, node_assert_1.default)(synthesisPrompt.includes('不得读取工程目录'));
        (0, node_assert_1.default)(synthesisPrompt.includes('likely_false_positives` 只能引用 `disposition` 为 `duplicate`、`unsupported`、`contradicted`、`unverifiable` 或 `out_of_scope` 的 finding'));
        (0, node_assert_1.default)(synthesisPrompt.includes('任何 `retained` 或 `merged` finding 都禁止出现在 `likely_false_positives`'));
        (0, node_assert_1.default)(synthesisPrompt.includes('核心事实成立但“blocks_execution / blocker / 必须修订”被 Fact Check 判定为放大'));
        // $ref resolution: source_finding_ids must be array, not string
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', {
            probe: 'synthesis',
            source_findings: [
                {
                    id: 'F1',
                    source: 'Risk Reviewer',
                    source_title: 'test',
                    source_issue_id: 'risk-001',
                    fact_check_status: 'verified',
                    scope_status: 'in_scope',
                    disposition: 'retained',
                    reason: 'test',
                },
            ],
            process_map: {
                title: 't',
                mermaid: 'flowchart TD\n  A[B]',
                nodes: [{ id: 'A', label: 'B', stage: 's', status: 'normal', related_issue_titles: [], evidence: 'e' }],
            },
            consensus_issues: [
                {
                    title: 'c',
                    merged_from: ['Risk Reviewer'],
                    severity: 'medium',
                    affected_nodes: ['A'],
                    source_finding_ids: 'F1',
                    reason: 'r',
                    required_plan_change: 'fix',
                },
            ],
            disagreements: [],
            likely_false_positives: [],
            revision_instructions: [],
        }, {
            factCheckOutput: {
                checked_issues: [
                    {
                        issue_id: 'risk-001',
                        source: 'Risk Reviewer',
                        issue_title: 'test',
                        status: 'verified',
                        scope_status: 'in_scope',
                        evidence_status: 'plan_only',
                        claim_support: 'direct',
                        reason: 'r',
                        checked_files: [],
                    },
                ],
                source_summaries: [],
                limits: [],
            },
        }), 'string source_finding_ids should fail $ref validation');
        // Synthesis reverse check: finding without fact_check entry
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', {
            probe: 'synthesis',
            source_findings: [
                {
                    id: 'F1',
                    source: 'Risk Reviewer',
                    source_title: 'unbacked finding',
                    source_issue_id: 'nonexistent-001',
                    fact_check_status: 'verified',
                    scope_status: 'in_scope',
                    disposition: 'retained',
                    reason: 'test',
                },
            ],
            process_map: {
                title: 't',
                mermaid: 'flowchart TD\n  A[B]',
                nodes: [{ id: 'A', label: 'B', stage: 's', status: 'normal', related_issue_titles: [], evidence: 'e' }],
            },
            consensus_issues: [],
            disagreements: [],
            likely_false_positives: [],
            revision_instructions: [],
        }, { factCheckOutput: { checked_issues: [], source_summaries: [], limits: [] } }), 'finding without matching fact_check entry should be rejected');
        // Fact Check duplicate issue_id should be rejected
        node_assert_1.default.throws(() => (0, run_workspace_review_js_1.validateWorkspaceOutput)('synthesis', {
            probe: 'synthesis',
            source_findings: [
                {
                    id: 'F1',
                    source: 'Risk Reviewer',
                    source_title: 'test',
                    source_issue_id: 'risk-001',
                    fact_check_status: 'verified',
                    scope_status: 'in_scope',
                    disposition: 'retained',
                    reason: 'test',
                },
            ],
            process_map: {
                title: 't',
                mermaid: 'flowchart TD\n  A[B]',
                nodes: [{ id: 'A', label: 'B', stage: 's', status: 'normal', related_issue_titles: [], evidence: 'e' }],
            },
            consensus_issues: [],
            disagreements: [],
            likely_false_positives: [],
            revision_instructions: [],
        }, {
            factCheckOutput: {
                checked_issues: [
                    {
                        issue_id: 'risk-001',
                        source: 'Risk Reviewer',
                        issue_title: 'test',
                        status: 'verified',
                        scope_status: 'in_scope',
                        evidence_status: 'plan_only',
                        claim_support: 'direct',
                        reason: 'r',
                        checked_files: [],
                    },
                    {
                        issue_id: 'risk-001',
                        source: 'Risk Reviewer',
                        issue_title: 'test',
                        status: 'verified',
                        scope_status: 'in_scope',
                        evidence_status: 'plan_only',
                        claim_support: 'direct',
                        reason: 'r',
                        checked_files: [],
                    },
                ],
                source_summaries: [],
                limits: [],
            },
        }), 'duplicate fact_check issue_id should be rejected');
        // Read boundary: empty Existing Code Refs exposes no files
        const emptyRefsScope = (0, workspace_review_lib_js_1.buildRoleReadScope)('risk', tempDir, '## Existing Code Refs\nNone\n\n## Tasks\nDo something.', { maxFiles: 10 });
        node_assert_1.default.equal(emptyRefsScope.files.length, 0, 'empty Existing Code Refs should expose no files');
        // Read boundary: missing section exposes no files
        const noRefsScope = (0, workspace_review_lib_js_1.buildRoleReadScope)('risk', tempDir, '## Tasks\nDo something.', { maxFiles: 10 });
        node_assert_1.default.equal(noRefsScope.files.length, 0, 'missing Existing Code Refs section should expose no files');
        const waitConfig = {
            ...directoryConfig,
            workspace_runs_dir: path.join(tempDir, 'wait-runs'),
        };
        const waitRunId = 'wait-run';
        const waitRunDir = path.join(waitConfig.workspace_runs_dir, waitRunId);
        fs.mkdirSync(waitRunDir, { recursive: true });
        writeJson(path.join(waitRunDir, 'state.json'), {
            run_id: waitRunId,
            status: 'running',
            roles: ['risk'],
        });
        (0, workspace_review_lib_js_1.appendExecutionLog)(waitRunDir, 'agent_started', {
            role: 'risk',
            model: 'qwen',
        });
        const progressEvents = [];
        setTimeout(() => {
            (0, workspace_review_lib_js_1.appendExecutionLog)(waitRunDir, 'agent_completed', {
                role: 'risk',
                model: 'qwen',
                elapsed_ms: 25,
            });
            (0, workspace_review_lib_js_1.appendExecutionLog)(waitRunDir, 'synthesis_completed', {
                role: 'synthesis',
                model: 'kimi',
                elapsed_ms: 10,
            });
            writeJson(path.join(waitRunDir, 'report.json'), {
                run_id: waitRunId,
                outcome: {
                    status: 'review_completed_with_infra_errors',
                    message: 'test',
                },
                infra_errors: [
                    {
                        role: 'rebuttal',
                        model: 'glm',
                        type: 'invalid_output',
                    },
                ],
            });
            writeJson(path.join(waitRunDir, 'state.json'), {
                run_id: waitRunId,
                status: 'completed',
                roles: ['risk'],
                infra_errors: [
                    {
                        role: 'rebuttal',
                        model: 'glm',
                        type: 'invalid_output',
                    },
                ],
            });
        }, 25);
        const waitedResult = await (0, plan_review_mcp_js_1.getPlanReview)(waitConfig, {
            run_id: waitRunId,
            include_report: true,
            wait_ms: 1500,
        }, (progress) => progressEvents.push(progress));
        node_assert_1.default.equal(waitedResult.status, 'completed');
        node_assert_1.default.equal(waitedResult.progress.completed_reviewers, 1);
        node_assert_1.default.equal(waitedResult.next_action, null);
        (0, node_assert_1.default)(waitedResult.progress.message.includes('基础设施错误'));
        (0, node_assert_1.default)(progressEvents.length >= 1);
        (0, node_assert_1.default)(progressEvents[0].message.includes('risk/kimi'));
        const reviewerRetry = createRetryRun(directoryConfig, tempDir, 'reviewer-retry', ['risk', 'architecture']);
        writeJson(path.join(reviewerRetry.runDir, 'state.json'), {
            run_id: 'reviewer-retry',
            project_root: reviewerRetry.projectRoot,
            roles: ['risk', 'architecture'],
            status: 'completed',
            infra_errors: [
                {
                    role: 'architecture',
                    model: 'kimi',
                    type: 'invalid_output',
                },
            ],
        });
        writeReviewerAttempt(reviewerRetry.runDir, 'risk', 'qwen');
        writeReviewerAttempt(reviewerRetry.runDir, 'architecture', 'kimi', 'failed');
        writeFactCheckAttempt(reviewerRetry.runDir, 'glm', 'failed');
        writeSynthesisAttempt(reviewerRetry.runDir, 'kimi', 'failed');
        const reviewerCalls = {
            reviewers: [],
            fact_check: 0,
            synthesis: 0,
        };
        const reviewerRetryResult = await (0, run_workspace_review_js_1.retryWorkspaceReviewStage)(reviewerRetry.config, reviewerRetry.runDir, 'reviewers', retryExecutors(reviewerCalls));
        node_assert_1.default.deepEqual(reviewerCalls.reviewers, ['architecture']);
        node_assert_1.default.deepEqual(reviewerCalls.fact_check_reviewers, ['risk', 'architecture']);
        node_assert_1.default.deepEqual(reviewerCalls.synthesis_reviewers, ['risk', 'architecture']);
        node_assert_1.default.equal(reviewerCalls.fact_check, 1);
        node_assert_1.default.equal(reviewerCalls.synthesis, 1);
        node_assert_1.default.equal(reviewerRetryResult.retry_counts.risk, 0);
        node_assert_1.default.equal(reviewerRetryResult.retry_counts.architecture, 1);
        node_assert_1.default.equal(reviewerRetryResult.retry_counts.fact_check, 0);
        node_assert_1.default.equal(reviewerRetryResult.retry_counts.synthesis, 0);
        node_assert_1.default.equal(fs.readdirSync(path.join(reviewerRetry.runDir, 'roles', 'architecture-attempts')).length, 1);
        node_assert_1.default.equal(fs.readdirSync(path.join(reviewerRetry.runDir, 'roles', 'fact_check-attempts')).length, 1);
        node_assert_1.default.equal(fs.readdirSync(path.join(reviewerRetry.runDir, 'roles', 'synthesis-attempts')).length, 1);
        node_assert_1.default.equal(JSON.parse(fs.readFileSync(path.join(reviewerRetry.runDir, 'state.json'), 'utf8')).status, 'completed');
        const reviewerRetryManifest = JSON.parse(fs.readFileSync(path.join(reviewerRetry.runDir, 'run-manifest.json'), 'utf8'));
        const architectureHistory = reviewerRetryManifest.resolved_execution.architecture.attempt_history;
        node_assert_1.default.equal(architectureHistory.length, 2);
        node_assert_1.default.match(architectureHistory[0].metadata_file, /^roles\/architecture-attempts\/[^/]+\/metadata\.json$/);
        node_assert_1.default.equal(architectureHistory[1].metadata_file, 'roles/architecture/metadata.json');
        const factCheckRetry = createRetryRun(directoryConfig, tempDir, 'fact-check-retry', ['risk', 'architecture'], {
            fact_check: 1,
            synthesis: 1,
        });
        writeReviewerAttempt(factCheckRetry.runDir, 'risk', 'qwen');
        writeReviewerAttempt(factCheckRetry.runDir, 'architecture', 'kimi');
        writeFactCheckAttempt(factCheckRetry.runDir, 'glm', 'failed');
        writeSynthesisAttempt(factCheckRetry.runDir, 'kimi', 'failed');
        const factCheckCalls = {
            reviewers: [],
            fact_check: 0,
            synthesis: 0,
        };
        const factCheckRetryResult = await (0, run_workspace_review_js_1.retryWorkspaceReviewStage)(factCheckRetry.config, factCheckRetry.runDir, 'fact_check', retryExecutors(factCheckCalls));
        node_assert_1.default.deepEqual(factCheckCalls.reviewers, []);
        node_assert_1.default.equal(factCheckCalls.fact_check, 1);
        node_assert_1.default.equal(factCheckCalls.synthesis, 1);
        node_assert_1.default.equal(factCheckRetryResult.retry_counts.fact_check, 2);
        node_assert_1.default.equal(factCheckRetryResult.retry_counts.synthesis, 1);
        const synthesisRetry = createRetryRun(directoryConfig, tempDir, 'synthesis-retry', ['risk', 'architecture'], {
            synthesis: 2,
        });
        writeReviewerAttempt(synthesisRetry.runDir, 'risk', 'qwen');
        writeReviewerAttempt(synthesisRetry.runDir, 'architecture', 'kimi');
        writeFactCheckAttempt(synthesisRetry.runDir, 'glm');
        writeSynthesisAttempt(synthesisRetry.runDir, 'kimi', 'failed');
        const synthesisCalls = {
            reviewers: [],
            fact_check: 0,
            synthesis: 0,
        };
        const synthesisRetryResult = await (0, run_workspace_review_js_1.retryWorkspaceReviewStage)(synthesisRetry.config, synthesisRetry.runDir, 'synthesis', retryExecutors(synthesisCalls));
        node_assert_1.default.deepEqual(synthesisCalls.reviewers, []);
        node_assert_1.default.equal(synthesisCalls.fact_check, 0);
        node_assert_1.default.equal(synthesisCalls.synthesis, 1);
        node_assert_1.default.equal(synthesisRetryResult.retry_counts.synthesis, 3);
        const exhaustedRetry = createRetryRun(directoryConfig, tempDir, 'exhausted-retry', ['risk'], {
            fact_check: 3,
        });
        writeReviewerAttempt(exhaustedRetry.runDir, 'risk', 'qwen');
        writeFactCheckAttempt(exhaustedRetry.runDir, 'glm', 'failed');
        writeSynthesisAttempt(exhaustedRetry.runDir, 'kimi', 'failed');
        await node_assert_1.default.rejects((0, run_workspace_review_js_1.retryWorkspaceReviewStage)(exhaustedRetry.config, exhaustedRetry.runDir, 'fact_check', retryExecutors({
            reviewers: [],
            fact_check: 0,
            synthesis: 0,
        })), /Retry limit reached \(3\).*fact_check/);
        (0, node_assert_1.default)(fs.existsSync(path.join(exhaustedRetry.runDir, 'roles', 'fact_check')));
        (0, node_assert_1.default)(!fs.existsSync(path.join(exhaustedRetry.runDir, 'roles', 'fact_check-attempts')));
        const progressRetry = createRetryRun(directoryConfig, tempDir, 'progress-retry', ['risk', 'architecture']);
        (0, workspace_review_lib_js_1.appendExecutionLog)(progressRetry.runDir, 'agent_completed', {
            role: 'risk',
            model: 'qwen',
        });
        (0, workspace_review_lib_js_1.appendExecutionLog)(progressRetry.runDir, 'agent_failed', {
            role: 'architecture',
            model: 'kimi',
        });
        (0, workspace_review_lib_js_1.appendExecutionLog)(progressRetry.runDir, 'fact_check_failed', {
            model: 'glm',
        });
        (0, workspace_review_lib_js_1.appendExecutionLog)(progressRetry.runDir, 'synthesis_failed', {
            model: 'kimi',
        });
        (0, workspace_review_lib_js_1.appendExecutionLog)(progressRetry.runDir, 'stage_retry_queued', {
            stage: 'reviewers',
            retry_roles: ['architecture'],
        });
        (0, workspace_review_lib_js_1.appendExecutionLog)(progressRetry.runDir, 'synthesis_started', {
            model: 'kimi',
        });
        const retryProgress = (0, plan_review_mcp_js_1.progressSnapshot)(progressRetry.config, progressRetry.runDir, {
            status: 'queued',
            roles: ['risk', 'architecture'],
        });
        node_assert_1.default.equal(retryProgress.reviewers.risk.status, 'completed');
        node_assert_1.default.equal(retryProgress.reviewers.architecture.status, 'pending');
        node_assert_1.default.equal(retryProgress.fact_check.status, 'pending');
        node_assert_1.default.equal(retryProgress.synthesis.status, 'running');
        (0, node_assert_1.default)(retryProgress.active.includes('synthesis/kimi'));
        const queuedRetry = createRetryRun({
            ...directoryConfig,
            workspace_runs_dir: path.join(tempDir, 'queued-runs'),
        }, tempDir, 'queued-retry', ['risk']);
        const queuedRunDir = path.join(tempDir, 'queued-runs', 'queued-retry');
        fs.mkdirSync(path.dirname(queuedRunDir), { recursive: true });
        fs.renameSync(queuedRetry.runDir, queuedRunDir);
        writeJson(path.join(queuedRunDir, 'state.json'), {
            run_id: 'queued-retry',
            status: 'queued',
            roles: ['risk'],
        });
        node_assert_1.default.throws(() => (0, plan_review_mcp_js_1.retryPlanReviewStage)({
            ...directoryConfig,
            workspace_runs_dir: path.join(tempDir, 'queued-runs'),
        }, {
            run_id: 'queued-retry',
            stage: 'reviewers',
        }), /still queued or running/);
        let result = (0, node_child_process_1.spawnSync)(process.execPath, [server, '--settings-dir', settingsDir, '--claude-bin', process.execPath, '--validate-only'], {
            encoding: 'utf8',
            env: {
                ...(0, workspace_review_lib_js_1.withoutAnthropicApiKey)(process.env),
                ANTHROPIC_API_KEY: 'must-not-appear',
            },
        });
        node_assert_1.default.equal(result.status, 0, result.stderr);
        (0, node_assert_1.default)(result.stdout.includes('"valid": true'));
        (0, node_assert_1.default)(!result.stdout.includes('test-auth-token'));
        (0, node_assert_1.default)(!result.stdout.includes('must-not-appear'));
        const rpcInput = [
            JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                },
            }),
            JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {},
            }),
            '',
        ].join('\n');
        result = (0, node_child_process_1.spawnSync)(process.execPath, [server, '--settings-dir', settingsDir, '--claude-bin', process.execPath], {
            encoding: 'utf8',
            input: rpcInput,
            timeout: 10000,
            env: {
                ...(0, workspace_review_lib_js_1.withoutAnthropicApiKey)(process.env),
                ANTHROPIC_API_KEY: 'must-not-appear',
            },
        });
        node_assert_1.default.equal(result.status, 0, result.stderr);
        const responses = result.stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        node_assert_1.default.equal(responses.length, 2);
        node_assert_1.default.equal(responses[0].result.serverInfo.name, 'plan-review-harness');
        node_assert_1.default.equal(responses[1].result.tools.length, 4);
        (0, node_assert_1.default)(!result.stdout.includes('must-not-appear'));
        const rpcRunId = 'rpc-wait-run';
        const rpcRunDir = path.join(tempDir, 'runs', rpcRunId);
        fs.mkdirSync(rpcRunDir, { recursive: true });
        writeJson(path.join(rpcRunDir, 'state.json'), {
            run_id: rpcRunId,
            status: 'running',
            roles: ['risk'],
        });
        (0, workspace_review_lib_js_1.appendExecutionLog)(rpcRunDir, 'agent_started', {
            role: 'risk',
            model: 'qwen',
        });
        const progressRpcInput = [
            JSON.stringify({
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: {
                    name: 'get_plan_review',
                    arguments: {
                        run_id: rpcRunId,
                        include_report: false,
                        wait_ms: 20,
                    },
                    _meta: {
                        progressToken: 'progress-test',
                    },
                },
            }),
            '',
        ].join('\n');
        result = (0, node_child_process_1.spawnSync)(process.execPath, [server, '--config', configFile], {
            encoding: 'utf8',
            input: progressRpcInput,
            timeout: 10000,
            env: (0, workspace_review_lib_js_1.withoutAnthropicApiKey)(process.env),
        });
        node_assert_1.default.equal(result.status, 0, result.stderr);
        const progressMessages = result.stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        node_assert_1.default.equal(progressMessages[0].method, 'notifications/progress');
        node_assert_1.default.equal(progressMessages[0].params.progressToken, 'progress-test');
        (0, node_assert_1.default)(progressMessages[0].params.message.includes('risk/qwen'));
        node_assert_1.default.equal(progressMessages[1].id, 3);
        const progressResult = JSON.parse(progressMessages[1].result.content[0].text);
        node_assert_1.default.equal(progressResult.status, 'running');
        node_assert_1.default.equal(progressResult.next_action.tool, 'get_plan_review');
        (0, node_assert_1.default)(progressResult.next_action.instruction.includes('不要调用 Bash'));
        console.log('Plan review MCP tests passed');
    }
    finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
