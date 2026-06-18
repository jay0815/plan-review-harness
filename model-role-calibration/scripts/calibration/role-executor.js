// @ts-check
/**
 * 普通角色校准执行者。
 *
 * 保留现有 prompt 与 run-model.js 产物协议，把普通角色差异收敛为
 * CalibrationExecutor，由通用 runner 负责并发和 batch 写入。
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  ROOT,
  assertProbe,
  assertSafeCaseId,
  agentOutputPaths,
  parseJsonFile
} = require("../lib");
const { generatePrompts: generateRolePrompts } = require("../generate-prompts");
const {
  slug,
  uniqueRunId
} = require("./core");

const DEFAULT_CONCURRENCY = 3;

function jobKey(job) {
  return `${job.model}/${job.caseId}/${job.probe}`;
}

function latestAttemptMetadata(run, job) {
  const paths = agentOutputPaths(run, job.caseId, job.model, job.probe);
  if (!fs.existsSync(paths.attemptsDir)) {
    return null;
  }
  const attempts = fs.readdirSync(paths.attemptsDir)
    .map((name) => {
      const match = /^attempt-(\d+)\.meta\.json$/.exec(name);
      return match ? { name, number: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.number - a.number);
  for (const attempt of attempts) {
    const file = path.join(paths.attemptsDir, attempt.name);
    try {
      return {
        file,
        metadata: parseJsonFile(file)
      };
    } catch {
      // Try the preceding attempt if the newest metadata is incomplete.
    }
  }
  return null;
}

function failureSummary(metadata, exitCode, signal, spawnError) {
  const compactMessage = (message) => {
    const compact = String(message).replace(/\s+/g, " ").trim();
    return compact.length > 300 ? `${compact.slice(0, 297)}...` : compact;
  };
  if (spawnError) {
    return `Unable to start model runner: ${spawnError}`;
  }
  if (metadata?.timed_out) {
    return `Model command timed out after ${metadata.timeout_ms}ms`;
  }
  if (metadata?.error) {
    const position = /position (\d+)/i.exec(metadata.error);
    if (position && /valid JSON object|JSON parse/i.test(metadata.error)) {
      return `Invalid model output: JSON parse error at position ${position[1]}`;
    }
    const prefix = metadata.exit_code === 0 ? "Invalid model output" : "Model command failed";
    return `${prefix}: ${compactMessage(metadata.error)}`;
  }
  if (exitCode !== null) {
    return `Model runner exited with status ${exitCode}`;
  }
  if (signal) {
    return `Model runner terminated by signal ${signal}`;
  }
  return "Model runner failed without a recorded error";
}

function runModelJob(job) {
  return new Promise((resolve) => {
    const runner = process.env.MODEL_ROLE_CALIBRATION_RUNNER
      || path.join(ROOT, "scripts", "run-model.js");
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, [
      runner,
      "--run", job.run,
      "--case", job.caseId,
      "--model", job.model,
      "--probe", job.probe,
      "--with-json-validator"
    ], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let spawnError = null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", (code, signal) => {
      const paths = agentOutputPaths(job.run, job.caseId, job.model, job.probe);
      const base = {
        caseId: job.caseId,
        model: job.model,
        probe: job.probe,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        exit_code: code,
        signal,
        stdout,
        stderr
      };
      if (code === 0 && !spawnError && fs.existsSync(paths.resultFile)) {
        resolve({
          ...base,
          status: "completed",
          error: null
        });
        return;
      }
      if (code === 0 && !spawnError) {
        resolve({
          ...base,
          status: "failed",
          error: `Model runner exited successfully without output: ${path.relative(ROOT, paths.resultFile)}`,
          attempt_file: null
        });
        return;
      }
      const attempt = latestAttemptMetadata(job.run, job);
      resolve({
        ...base,
        status: "failed",
        error: failureSummary(attempt?.metadata, code, signal, spawnError),
        attempt_file: attempt?.file ? path.relative(ROOT, attempt.file) : null
      });
    });
  });
}

class RoleCalibrationExecutor {
  get type() {
    return "role";
  }

  get root() {
    return ROOT;
  }

  validateOptions({ caseId, models, probes, config }) {
    assertSafeCaseId(caseId);
    if (!models.length) {
      throw new Error("At least one model is required");
    }
    for (const model of models) {
      if (!config.models.includes(model)) {
        throw new Error(`Invalid model "${model}". Expected one of: ${config.models.join(", ")}`);
      }
    }
    if (!probes.length) {
      throw new Error("At least one probe is required");
    }
    probes.forEach(assertProbe);
  }

  uniqueRunId(caseId) {
    return uniqueRunId(slug(caseId), ROOT);
  }

  generatePrompts({ run, caseId, probes }) {
    const promptDir = path.join(ROOT, "runs", run, caseId, "prompts");
    const missing = probes.filter((probe) => !fs.existsSync(path.join(promptDir, `${probe}.md`)));
    if (missing.length) {
      generateRolePrompts({ run, caseId, probes: missing });
    }
    return {
      promptDir,
      generated: missing.length,
      reused: probes.length - missing.length,
      prompts: probes.map((probe) => ({
        probe,
        file: path.join(promptDir, `${probe}.md`)
      }))
    };
  }

  buildJobs({ run, caseId, models, probes }) {
    const jobs = [];
    for (const probe of probes) {
      for (const model of models) {
        jobs.push({ run, caseId, model, probe });
      }
    }
    return jobs;
  }

  async runJob(job) {
    const paths = agentOutputPaths(job.run, job.caseId, job.model, job.probe);
    const label = jobKey(job);
    if (fs.existsSync(paths.resultFile)) {
      console.log(`[skip] ${label}: completed output exists`);
      return {
        caseId: job.caseId,
        model: job.model,
        probe: job.probe,
        status: "skipped",
        reason: "completed_output_exists",
        result_file: path.relative(ROOT, paths.resultFile)
      };
    }

    console.log(`[start] ${label}`);
    const result = await runModelJob(job);
    if (result.status === "completed") {
      console.log(`[done] ${label}`);
    } else {
      console.error(`[fail] ${label}`);
      console.error(`  ${result.error}`);
      if (result.attempt_file) {
        console.error(`  attempt: ${result.attempt_file}`);
      }
    }
    return result;
  }

  summarizeRun(run) {
    return {
      run,
      automated_evaluation: false
    };
  }
}

module.exports = {
  RoleCalibrationExecutor,
  DEFAULT_CONCURRENCY,
  failureSummary,
  latestAttemptMetadata,
  runModelJob
};
