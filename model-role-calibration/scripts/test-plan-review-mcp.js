#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  loadWorkspaceReviewConfig,
  loadWorkspaceReviewSettingsDirectory,
  configSummary,
  buildRoleReadScope,
  buildFactCheckReadScope,
  copyScopedWorkspace,
  buildWorkspacePrompt,
  buildClaudeWorkspaceArgs,
  compactPlanForReview,
  createPlanReferenceManifest,
  executionLogPath,
  appendExecutionLog,
  withoutAnthropicApiKey
} = require("./workspace-review-lib");
const {
  summarizeReviewOutcome
} = require("./run-workspace-review");
const {
  toolList,
  resolvePlanInput,
  getPlanReview
} = require("./plan-review-mcp");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function settings(baseUrl, model) {
  return {
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ...(model ? { ANTHROPIC_MODEL: model } : {}),
      ANTHROPIC_AUTH_TOKEN: "test-auth-token"
    }
  };
}

function configFixture(tempDir) {
  const settingsDir = path.join(tempDir, "settings");
  writeJson(path.join(settingsDir, "kimi.json"), settings("https://kimi.example"));
  writeJson(path.join(settingsDir, "deepseek.json"), settings("https://gateway.example", "deepseek"));
  writeJson(path.join(settingsDir, "glm.json"), settings("https://gateway.example", "glm"));
  writeJson(path.join(settingsDir, "qwen.json"), settings("https://gateway.example", "qwen"));
  const configFile = path.join(tempDir, "workspace-review.json");
  writeJson(configFile, {
    version: 1,
    claude_bin: process.execPath,
    workspace_runs_dir: "./runs",
    models: {
      kimi: {
        settings_file: "./settings/kimi.json",
        required_env: ["ANTHROPIC_BASE_URL"]
      },
      deepseek: {
        settings_file: "./settings/deepseek.json",
        required_env: ["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"]
      },
      glm: {
        settings_file: "./settings/glm.json",
        required_env: ["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"]
      },
      qwen: {
        settings_file: "./settings/qwen.json",
        required_env: ["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"]
      }
    },
    roles: {
      risk: "qwen",
      architecture: "kimi",
      execution: "kimi",
      rebuttal: "glm",
      synthesis: "kimi",
      planner: "deepseek"
    },
    execution: {
      max_concurrency: 3,
      timeout_ms: 10000,
      max_buffer_bytes: 1048576,
      max_turns: 12
    }
  });
  return { configFile, settingsDir };
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-review-mcp-test-"));
  const server = path.join(__dirname, "plan-review-mcp.js");
  try {
    const { configFile, settingsDir } = configFixture(tempDir);
    const config = loadWorkspaceReviewConfig(configFile);
    assert.equal(config.roles.risk, "qwen");
    assert.equal(config.models.kimi.summary.auth_env, "ANTHROPIC_AUTH_TOKEN");
    assert.equal(configSummary(config).models.qwen.model, "qwen");

    const directoryConfig = loadWorkspaceReviewSettingsDirectory(settingsDir, {
      validateClaudeBin: false
    });
    assert.equal(directoryConfig.config_file, null);
    assert.equal(directoryConfig.settings_dir, settingsDir);
    assert.deepEqual(directoryConfig.loader_args, ["--settings-dir", settingsDir]);
    assert.equal(directoryConfig.roles.risk, "qwen");
    assert.equal(directoryConfig.roles.fact_check, "glm");
    assert.equal(directoryConfig.roles.synthesis, "kimi");
    assert.equal(directoryConfig.execution.max_concurrency, 4);
    assert.equal(directoryConfig.execution.isolate_reviewers, true);
    assert.equal(directoryConfig.execution.read_scope_max_files, 80);
    assert.equal(directoryConfig.models.glm.settings_file, path.join(settingsDir, "glm.json"));

    const logRunDir = path.join(tempDir, "log-run");
    fs.mkdirSync(logRunDir);
    appendExecutionLog(logRunDir, "agent_started", {
      role: "risk",
      model: "qwen"
    });
    const executionLog = fs.readFileSync(executionLogPath(logRunDir), "utf8");
    assert(executionLog.includes("agent_started"));
    assert(executionLog.includes("role=\"risk\""));
    assert(executionLog.includes("model=\"qwen\""));
    assert(!executionLog.includes("test-auth-token"));

    const prompt = buildWorkspacePrompt(
      "risk",
      tempDir,
      "检查当前计划",
      "只允许只读访问"
    );
    assert(prompt.includes("检查当前计划"));
    assert(prompt.includes("现有工程文件的相对路径和行号"));
    assert(prompt.includes("proposed-code/..."));

    const projectRoot = path.join(tempDir, "project");
    fs.mkdirSync(path.join(projectRoot, "src", "cdp"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "package.json"), "{\"scripts\":{}}\n");
    fs.writeFileSync(path.join(projectRoot, "tsconfig.json"), "{}\n");
    fs.writeFileSync(path.join(projectRoot, "src", "cli.ts"), "export const cli = true;\n");
    fs.writeFileSync(path.join(projectRoot, "src", "cdp", "extract.ts"), "export const extract = true;\n");
    fs.writeFileSync(path.join(projectRoot, "secret.txt"), "do not copy\n");
    const readScope = buildRoleReadScope(
      "risk",
      projectRoot,
      [
        "修改 `src/cli.ts` 和 `src/cdp/extract.ts`。",
        `不要读取 ${path.join(tempDir, "outside.ts")}。`
      ].join("\n"),
      {
        maxFiles: 10
      }
    );
    assert(readScope.files.includes("package.json"));
    assert(readScope.files.includes("tsconfig.json"));
    assert(readScope.files.includes("src/cli.ts"));
    assert(readScope.files.includes("src/cdp/extract.ts"));
    assert(!readScope.files.includes("secret.txt"));
    assert(readScope.blocked_refs.some((item) => item.endsWith("outside.ts")));
    const mirrorParent = fs.mkdtempSync(path.join(tempDir, "mirror-"));
    const boundary = copyScopedWorkspace(projectRoot, readScope, mirrorParent);
    assert(fs.existsSync(path.join(boundary.exposed_root, "src", "cli.ts")));
    assert(!fs.existsSync(path.join(boundary.exposed_root, "secret.txt")));
    fs.rmSync(mirrorParent, { recursive: true, force: true });

    const factScope = buildFactCheckReadScope(projectRoot, {
      "Risk Reviewer": {
        issues: [{
          evidence: "src/cli.ts:1 shows cli",
          why_it_matters: "package.json scripts consume it"
        }]
      }
    }, {
      maxFiles: 10
    });
    assert(factScope.files.includes("src/cli.ts"));
    assert(factScope.files.includes("package.json"));

    const factCheckPrompt = buildWorkspacePrompt(
      "fact_check",
      tempDir,
      "检查当前计划",
      "",
      {
        "Risk Reviewer": {
          probe: "risk",
          issues: [{
            title: "配置值不一致",
            type: "risk",
            severity: "high",
            evidence: "packages/example.ts:1 rounds: 30",
            why_it_matters: "计划要求 15",
            confidence: 0.9
          }],
          missing_questions: [],
          false_positive_risks: []
        }
      },
      null,
      {
        mode: "scoped_mirror",
        files: ["packages/example.ts"],
        blocked_refs: [],
        skipped_refs: []
      }
    );
    assert(factCheckPrompt.includes("Fact Judge"));
    assert(factCheckPrompt.includes("只能使用 Read"));
    assert(factCheckPrompt.includes("\"probe\": \"fact_check\""));
    assert(factCheckPrompt.includes("# Reviewer Issue IDs"));
    assert(factCheckPrompt.includes("\"issue_id\": \"Risk-Reviewer-001\""));
    assert(factCheckPrompt.includes("## Risk Reviewer"));
    assert(factCheckPrompt.includes("读取边界"));
    assert(factCheckPrompt.includes("packages/example.ts"));

    const longPlan = [
      "# 实施计划",
      "",
      "```ts",
      "import { test, expect } from 'bun:test';",
      "export async function clearStaticCacheWithPage(page: PageLike) {",
      "  const client = await page.target().createCDPSession();",
      "  await client.send('Network.clearBrowserCache');",
      "  return { ok: true };",
      "}",
      "test('clearStaticCacheWithPage clears cache', async () => {",
      "  expect(await clearStaticCacheWithPage(page)).toEqual({ ok: true });",
      "});",
      "export async function clearHostResolverCache(browser: BrowserLike) {",
      "  const context = await browser.createBrowserContext();",
      "  const page = await context.newPage();",
      "  await page.goto('chrome://net-internals/#dns');",
      "  await page.evaluate(() => document.querySelector('#dns-view-clear-cache')?.click());",
      "  await page.close();",
      "  await context.close();",
      "  return { ok: true };",
      "}",
      ...Array.from({ length: 30 }, (_, index) => [
        `const step${index} = await runDetailedImplementationStep(${index});`,
        `expect(step${index}.ok).toBe(true);`
      ]).flat(),
      "```",
      "",
      "```bash",
      "bun test test/dns-cache.test.ts",
      "```"
    ].join("\n");
    const compactedPlan = compactPlanForReview(longPlan);
    assert(compactedPlan.text.includes("```pseudo"));
    assert(compactedPlan.text.includes("源码 artifact：proposed-code/block-001.ts:1-"));
    assert(compactedPlan.text.includes("声明/入口"));
    assert(compactedPlan.text.includes("测试意图"));
    assert(compactedPlan.text.includes("```bash"));
    assert.equal(compactedPlan.stats.code_blocks, 2);
    assert.equal(compactedPlan.stats.compacted_blocks, 1);
    assert.equal(compactedPlan.stats.proposed_artifact_count, 1);
    assert.equal(compactedPlan.artifacts.length, 1);
    assert.equal(compactedPlan.artifacts[0].relative_path, "proposed-code/block-001.ts");
    assert(compactedPlan.artifacts[0].content.includes("clearHostResolverCache"));
    assert(compactedPlan.stats.saved_chars > 0);

    const proposedArtifactDir = path.join(tempDir, "artifact-source");
    const proposedArtifacts = compactedPlan.artifacts.map((artifact) => {
      const sourceFile = path.join(proposedArtifactDir, artifact.relative_path);
      fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
      fs.writeFileSync(sourceFile, artifact.content, "utf8");
      return {
        ...artifact,
        source_file: sourceFile,
        content: null
      };
    });
    const artifactScope = buildRoleReadScope(
      "risk",
      projectRoot,
      compactedPlan.text,
      {
        maxFiles: 10,
        proposedArtifacts
      }
    );
    assert(artifactScope.files.includes("proposed-code/block-001.ts"));
    assert.equal(artifactScope.proposed_artifacts.length, 1);
    const artifactMirrorParent = fs.mkdtempSync(path.join(tempDir, "artifact-mirror-"));
    const artifactBoundary = copyScopedWorkspace(projectRoot, artifactScope, artifactMirrorParent);
    assert(fs.existsSync(path.join(artifactBoundary.exposed_root, "proposed-code", "block-001.ts")));
    assert(fs.readFileSync(
      path.join(artifactBoundary.exposed_root, "proposed-code", "block-001.ts"),
      "utf8"
    ).includes("clearHostResolverCache"));
    fs.rmSync(artifactMirrorParent, { recursive: true, force: true });

    const refs = createPlanReferenceManifest(
      projectRoot,
      [
        "## Existing Code Refs",
        "- `src/cli.ts:1-1`",
        "- `/outside/project.ts:10`",
        "## Proposed Code Artifacts",
        "- `proposed-code/block-001.ts:1-10`"
      ].join("\n"),
      proposedArtifacts
    );
    assert.equal(refs.format_status.has_existing_code_refs_section, true);
    assert.equal(refs.format_status.has_proposed_code_artifacts_section, true);
    assert(refs.existing_code_refs.some((item) => item.path === "src/cli.ts" && item.line_ref === "1-1"));
    assert(refs.proposed_code_artifacts.some((item) => item.path === "proposed-code/block-001.ts"));
    assert(refs.blocked_refs.includes("/outside/project.ts"));

    const args = buildClaudeWorkspaceArgs(config, "qwen", "risk", tempDir);
    assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
    assert.equal(args[args.indexOf("--allowed-tools") + 1], "Read,Glob,Grep");
    assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
    assert.equal(args[args.indexOf("--add-dir") + 1], tempDir);
    assert(!args.includes("Bash"));
    assert(!args.includes("Edit"));
    assert(!args.includes("Write"));
    assert(!args.includes("--no-session-persistence"));
    const factCheckArgs = buildClaudeWorkspaceArgs(config, "glm", "fact_check", tempDir, {
      tools: "Read",
      allowProjectRead: true
    });
    assert.equal(factCheckArgs[factCheckArgs.indexOf("--tools") + 1], "Read");
    assert.equal(factCheckArgs[factCheckArgs.indexOf("--allowed-tools") + 1], "Read");
    assert.equal(factCheckArgs[factCheckArgs.indexOf("--add-dir") + 1], tempDir);
    assert(!factCheckArgs.includes("--no-session-persistence"));
    const synthesisArgs = buildClaudeWorkspaceArgs(config, "kimi", "synthesis", tempDir, {
      tools: "",
      allowProjectRead: false
    });
    assert.equal(synthesisArgs[synthesisArgs.indexOf("--tools") + 1], "");
    assert.equal(synthesisArgs[synthesisArgs.indexOf("--allowed-tools") + 1], "");
    assert(!synthesisArgs.includes("--add-dir"));
    assert(!synthesisArgs.includes("--no-session-persistence"));
    assert(args[args.indexOf("--system-prompt") + 1].includes("Return only one raw JSON object"));

    const readyOutcome = summarizeReviewOutcome(
      [{
        role: "risk",
        output: {
          issues: []
        }
      }],
      {
        summary: {
          total_checked: 0,
          challenged_count: 0
        }
      },
      {
        output: {
          consensus_issues: [],
          disagreements: [],
          revision_instructions: []
        }
      },
      []
    );
    assert.equal(readyOutcome.status, "plan_ready");

    const infraOutcome = summarizeReviewOutcome(
      [{
        role: "risk",
        output: {
          issues: []
        }
      }],
      {
        summary: {
          total_checked: 0,
          challenged_count: 0
        }
      },
      {
        output: {
          consensus_issues: [],
          disagreements: [],
          revision_instructions: []
        }
      },
      [{
        role: "rebuttal",
        model: "glm",
        type: "invalid_output"
      }]
    );
    assert.equal(infraOutcome.status, "review_completed_with_infra_errors");

    let apiKeyRead = false;
    const inheritedEnv = {
      SAFE_VALUE: "safe"
    };
    Object.defineProperty(inheritedEnv, "ANTHROPIC_API_KEY", {
      enumerable: true,
      get() {
        apiKeyRead = true;
        throw new Error("ANTHROPIC_API_KEY must not be read");
      }
    });
    assert.deepEqual(withoutAnthropicApiKey(inheritedEnv), {
      SAFE_VALUE: "safe"
    });
    assert.equal(apiKeyRead, false);

    const forbiddenFile = path.join(settingsDir, "qwen.json");
    fs.writeFileSync(forbiddenFile, JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: "https://gateway.example",
        ANTHROPIC_MODEL: "qwen",
        ANTHROPIC_API_KEY: "must-not-be-read"
      }
    }));
    assert.throws(
      () => loadWorkspaceReviewConfig(configFile, { validateClaudeBin: false }),
      /forbidden ANTHROPIC_API_KEY/
    );
    writeJson(forbiddenFile, settings("https://gateway.example", "qwen"));

    fs.unlinkSync(path.join(settingsDir, "glm.json"));
    assert.throws(
      () => loadWorkspaceReviewSettingsDirectory(settingsDir, { validateClaudeBin: false }),
      /Missing settings file for model "glm"/
    );
    writeJson(path.join(settingsDir, "glm.json"), settings("https://gateway.example", "glm"));

    assert.deepEqual(
      toolList().map((tool) => tool.name),
      ["configuration_status", "start_plan_review", "retry_plan_review_stage", "get_plan_review"]
    );
    const startTool = toolList().find((tool) => tool.name === "start_plan_review");
    const retryTool = toolList().find((tool) => tool.name === "retry_plan_review_stage");
    const getTool = toolList().find((tool) => tool.name === "get_plan_review");
    assert(startTool.description.includes("同一计划只调用一次"));
    assert.equal(startTool.inputSchema.oneOf.length, 2);
    assert(startTool.inputSchema.properties.plan_file.description.includes("优先使用"));
    assert(startTool.inputSchema.properties.project_root.description.includes("CLAUDE_PROJECT_DIR"));
    assert(retryTool.description.includes("stage=synthesis"));
    assert.deepEqual(retryTool.inputSchema.properties.stage.enum, ["synthesis"]);
    assert(getTool.description.includes("progress notification"));
    assert(getTool.description.includes("禁止使用 Bash"));
    assert.equal(getTool.inputSchema.properties.wait_ms.default, undefined);
    assert.equal(getTool.annotations.readOnlyHint, true);

    const planFile = path.join(tempDir, "plan.md");
    fs.writeFileSync(planFile, "# 实施计划\n\n1. 更新配置。\n", "utf8");
    assert.deepEqual(resolvePlanInput({
      plan_file: planFile
    }), {
      plan: "# 实施计划\n\n1. 更新配置。\n",
      plan_file: planFile
    });
    assert.deepEqual(resolvePlanInput({
      plan: "# 内联计划"
    }), {
      plan: "# 内联计划",
      plan_file: null
    });
    assert.throws(
      () => resolvePlanInput({}),
      /exactly one of plan or plan_file/
    );
    assert.throws(
      () => resolvePlanInput({
        plan: "# 内联计划",
        plan_file: planFile
      }),
      /exactly one of plan or plan_file/
    );
    assert.throws(
      () => resolvePlanInput({
        plan_file: "relative-plan.md"
      }),
      /absolute path/
    );

    const synthesisSchema = JSON.parse(fs.readFileSync(
      path.join(__dirname, "..", "schemas", "synthesis-output.schema.json"),
      "utf8"
    ));
    const factCheckSchema = JSON.parse(fs.readFileSync(
      path.join(__dirname, "..", "schemas", "fact-check-output.schema.json"),
      "utf8"
    ));
    assert.equal(factCheckSchema.properties.probe.const, "fact_check");
    assert(
      factCheckSchema.properties.checked_issues.items.required.includes("issue_id")
    );
    assert(synthesisSchema.required.includes("process_map"));
    assert(
      synthesisSchema.properties.consensus_issues.items.required.includes("affected_nodes")
    );
    const synthesisPrompt = buildWorkspacePrompt(
      "synthesis",
      tempDir,
      "检查当前计划",
      "",
      {
        "Risk Reviewer": {
          probe: "risk",
          issues: [],
          missing_questions: [],
          false_positive_risks: []
        }
      },
      {
        probe: "fact_check",
        checked_issues: [],
        source_summaries: [],
        limits: []
      }
    );
    assert(synthesisPrompt.includes("\"process_map\""));
    assert(synthesisPrompt.includes("\"affected_nodes\""));
    assert(synthesisPrompt.includes("Fact Check 报告"));
    assert(synthesisPrompt.includes("不得读取工程目录"));

    const waitConfig = {
      ...directoryConfig,
      workspace_runs_dir: path.join(tempDir, "wait-runs")
    };
    const waitRunId = "wait-run";
    const waitRunDir = path.join(waitConfig.workspace_runs_dir, waitRunId);
    fs.mkdirSync(waitRunDir, { recursive: true });
    writeJson(path.join(waitRunDir, "state.json"), {
      run_id: waitRunId,
      status: "running",
      roles: ["risk"]
    });
    appendExecutionLog(waitRunDir, "agent_started", {
      role: "risk",
      model: "qwen"
    });
    const progressEvents = [];
    setTimeout(() => {
      appendExecutionLog(waitRunDir, "agent_completed", {
        role: "risk",
        model: "qwen",
        elapsed_ms: 25
      });
      appendExecutionLog(waitRunDir, "synthesis_completed", {
        role: "synthesis",
        model: "kimi",
        elapsed_ms: 10
      });
      writeJson(path.join(waitRunDir, "report.json"), {
        run_id: waitRunId,
        outcome: {
          status: "review_completed_with_infra_errors",
          message: "test"
        },
        infra_errors: [{
          role: "rebuttal",
          model: "glm",
          type: "invalid_output"
        }]
      });
      writeJson(path.join(waitRunDir, "state.json"), {
        run_id: waitRunId,
        status: "completed",
        roles: ["risk"],
        infra_errors: [{
          role: "rebuttal",
          model: "glm",
          type: "invalid_output"
        }]
      });
    }, 25);
    const waitedResult = await getPlanReview(
      waitConfig,
      {
        run_id: waitRunId,
        include_report: true,
        wait_ms: 1500
      },
      (progress) => progressEvents.push(progress)
    );
    assert.equal(waitedResult.status, "completed");
    assert.equal(waitedResult.progress.completed_reviewers, 1);
    assert.equal(waitedResult.next_action, null);
    assert(waitedResult.progress.message.includes("基础设施错误"));
    assert(progressEvents.length >= 1);
    assert(progressEvents[0].message.includes("risk/qwen"));

    let result = spawnSync(process.execPath, [
      server,
      "--settings-dir",
      settingsDir,
      "--claude-bin",
      process.execPath,
      "--validate-only"
    ], {
      encoding: "utf8",
      env: {
        ...withoutAnthropicApiKey(process.env),
        ANTHROPIC_API_KEY: "must-not-appear"
      }
    });
    assert.equal(result.status, 0, result.stderr);
    assert(result.stdout.includes("\"valid\": true"));
    assert(!result.stdout.includes("test-auth-token"));
    assert(!result.stdout.includes("must-not-appear"));

    const rpcInput = [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05"
        }
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      }),
      ""
    ].join("\n");
    result = spawnSync(process.execPath, [
      server,
      "--settings-dir",
      settingsDir,
      "--claude-bin",
      process.execPath
    ], {
      encoding: "utf8",
      input: rpcInput,
      timeout: 10000,
      env: {
        ...withoutAnthropicApiKey(process.env),
        ANTHROPIC_API_KEY: "must-not-appear"
      }
    });
    assert.equal(result.status, 0, result.stderr);
    const responses = result.stdout.trim().split("\n").map(JSON.parse);
    assert.equal(responses.length, 2);
    assert.equal(responses[0].result.serverInfo.name, "plan-review-harness");
    assert.equal(responses[1].result.tools.length, 4);
    assert(!result.stdout.includes("must-not-appear"));

    const rpcRunId = "rpc-wait-run";
    const rpcRunDir = path.join(tempDir, "runs", rpcRunId);
    fs.mkdirSync(rpcRunDir, { recursive: true });
    writeJson(path.join(rpcRunDir, "state.json"), {
      run_id: rpcRunId,
      status: "running",
      roles: ["risk"]
    });
    appendExecutionLog(rpcRunDir, "agent_started", {
      role: "risk",
      model: "qwen"
    });
    const progressRpcInput = [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "get_plan_review",
          arguments: {
            run_id: rpcRunId,
            include_report: false,
            wait_ms: 20
          },
          _meta: {
            progressToken: "progress-test"
          }
        }
      }),
      ""
    ].join("\n");
    result = spawnSync(process.execPath, [
      server,
      "--config",
      configFile
    ], {
      encoding: "utf8",
      input: progressRpcInput,
      timeout: 10000,
      env: withoutAnthropicApiKey(process.env)
    });
    assert.equal(result.status, 0, result.stderr);
    const progressMessages = result.stdout.trim().split("\n").map(JSON.parse);
    assert.equal(progressMessages[0].method, "notifications/progress");
    assert.equal(progressMessages[0].params.progressToken, "progress-test");
    assert(progressMessages[0].params.message.includes("risk/qwen"));
    assert.equal(progressMessages[1].id, 3);
    const progressResult = JSON.parse(progressMessages[1].result.content[0].text);
    assert.equal(progressResult.status, "running");
    assert.equal(progressResult.next_action.tool, "get_plan_review");
    assert(progressResult.next_action.instruction.includes("不要调用 Bash"));

    console.log("Plan review MCP tests passed");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
