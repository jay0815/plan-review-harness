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
 * @property {(opts: {run: string, caseId: string, models: string[], probes: string[]}) => {promptDir: string, prompts: any[]}} generatePrompts
 * @property {(opts: {run: string, caseId: string, models: string[], probes: string[]}) => CalibrationJob[]} buildJobs
 * @property {(job: CalibrationJob) => Promise<object>} runJob
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
 * @param {any} options.config
 * @returns {Promise<object>}
 */
async function runCalibration(executor, options) {
  const { caseId, models, probes, config } = options;
  executor.validateOptions({ caseId, models, probes, config });

  const run = options.run || executor.uniqueRunId(caseId);
  const concurrency = positiveInteger(options.concurrency || 2, "concurrency");

  console.log(`Run ID: ${run}`);
  console.log(`Type: ${executor.type}`);
  console.log(`Case: ${caseId}`);
  console.log(`Models: ${models.join(",")}`);
  if (probes.length) {
    console.log(`Probes: ${probes.join(",")}`);
  }

  const promptInfo = executor.generatePrompts({ run, caseId, models, probes });
  const generated = promptInfo.generated ?? promptInfo.prompts.length;
  const reused = promptInfo.reused ?? 0;
  console.log(`Prompts: ${generated} generated${reused ? `, ${reused} reused` : ""}`);

  const jobs = executor.buildJobs({ run, caseId, models, probes });
  console.log(`Jobs: ${jobs.length} scheduled, concurrency=${concurrency}`);

  const results = await runWithConcurrency(jobs, concurrency, (job) => executor.runJob(job));

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
    skipped: results.filter((item) => item.status === "skipped").length,
    completed,
    failed,
    results,
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
