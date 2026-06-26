// @ts-check
/**
 * 通用校准 runner。
 *
 * 负责编排校准流程：参数解析、验证、prompt 生成、job 并发执行、
 * batch.json 写入与汇总。具体 case 解析、prompt 生成、job 执行逻辑由
 * CalibrationExecutor 实现。
 */

const path = require("path");
const {
  parseList,
  uniqueRunId,
  runWithConcurrency,
  writeGenerated,
  positiveInteger
} = require("./core");

/**
 * @typedef {object} CalibrationJob
 * @property {string} run
 * @property {string} caseId
 * @property {string} model
 * @property {string} [probe]
 */

/**
 * @typedef {object} CalibrationExecutor
 * @property {string} type
 * @property {string} root
 * @property {(opts: {caseId: string, models: string[], probes: string[], config: any}) => void} validateOptions
 * @property {(caseId: string) => string} uniqueRunId
 * @property {(opts: {run: string, caseId: string, models: string[], probes: string[], force?: boolean}) => {promptDir: string, prompts: any[]}} generatePrompts
 * @property {(opts: {run: string, caseId: string, models: string[], probes: string[]}) => CalibrationJob[]} buildJobs
 * @property {(opts: {jobs: CalibrationJob[], concurrency: number, config: any}) => {label: string, concurrency: number, jobs: CalibrationJob[]}[]} [planJobStages]
 * @property {(job: CalibrationJob, opts?: {force?: boolean}) => Promise<object>} runJob
 * @property {(run: string) => object | null} summarizeRun
 */

/**
 * 运行一次校准流程。
 * @param {CalibrationExecutor} executor
 * @param {object} options
 * @param {string} options.caseId
 * @param {string[]} options.models
 * @param {string[]} options.probes
 * @param {string} [options.run]
 * @param {number} [options.concurrency]
 * @param {boolean} [options.force]
 * @param {any} options.config
 * @returns {Promise<object>}
 */
async function runCalibration(executor, options) {
  const { caseId, models, probes, config } = options;
  executor.validateOptions({ caseId, models, probes, config });

  const run = options.run || executor.uniqueRunId(caseId);
  const concurrency = positiveInteger(options.concurrency || 2, "concurrency");
  const force = options.force === true;

  console.log(`Run ID: ${run}`);
  console.log(`Type: ${executor.type}`);
  console.log(`Case: ${caseId}`);
  console.log(`Models: ${models.join(",")}`);
  if (probes.length) {
    console.log(`Probes: ${probes.join(",")}`);
  }
  if (force) {
    console.log("Force: enabled (matching prompts and model outputs will be refreshed)");
  }

  const promptInfo = executor.generatePrompts({ run, caseId, models, probes, force });
  const generated = promptInfo.generated ?? promptInfo.prompts.length;
  const reused = promptInfo.reused ?? 0;
  console.log(`Prompts: ${generated} generated${reused ? `, ${reused} reused` : ""}`);

  const jobs = executor.buildJobs({ run, caseId, models, probes });
  console.log(`Jobs: ${jobs.length} scheduled, concurrency=${concurrency}`);

  const stages = typeof executor.planJobStages === "function"
    ? executor.planJobStages({ jobs, concurrency, config })
    : [{ label: "default", concurrency, jobs }];
  for (const stage of stages) {
    if (!Array.isArray(stage.jobs)) {
      throw new Error(`Invalid job stage "${stage.label || "unknown"}": jobs must be an array`);
    }
    positiveInteger(stage.concurrency, `job stage ${stage.label || "unknown"} concurrency`);
  }

  const showStages = stages.length > 1 || stages.some((stage) => stage.concurrency !== concurrency);
  const results = [];
  for (const stage of stages) {
    if (showStages) {
      console.log(`[stage] ${stage.label}: ${stage.jobs.length} job(s), concurrency=${stage.concurrency}`);
    }
    const stageResults = await runWithConcurrency(
      stage.jobs,
      stage.concurrency,
      (job) => executor.runJob(job, { force })
    );
    results.push(...stageResults);
  }

  const completed = results.filter((item) => item.status === "completed" || item.status === "skipped").length;
  const failed = results.filter((item) => item.status === "failed").length;

  const summary = completed > 0 ? executor.summarizeRun(run) : null;

  const batch = {
    run,
    type: executor.type,
    case_id: caseId,
    models,
    probes: probes.length ? probes : undefined,
    requested: jobs.length,
    force,
    skipped: results.filter((item) => item.status === "skipped").length,
    completed,
    failed,
    results,
    job_stages: showStages
      ? stages.map((stage) => ({
        label: stage.label,
        concurrency: stage.concurrency,
        jobs: stage.jobs.length
      }))
      : undefined,
    summary: summary || null
  };

  const batchFile = path.join(executor.root, "runs", run, "batch.json");
  writeGenerated(batchFile, JSON.stringify(batch, null, 2) + "\n");
  console.log(`Batch saved: ${batchFile}`);

  if (failed > 0) {
    process.exitCode = 1;
  }

  return batch;
}

module.exports = {
  runCalibration
};
