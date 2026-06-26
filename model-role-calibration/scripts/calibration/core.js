// @ts-check
/**
 * 通用校准框架内核。
 *
 * 提供校准流程无关的工具函数：参数解析、run id 生成、并发执行、IO 安全写入等。
 */

const fs = require("fs");
const path = require("path");

/**
 * 解析逗号分隔列表，去重并过滤空值。
 * @param {string | true | undefined} value
 * @param {string[] | null} fallback
 * @returns {string[]}
 */
function parseList(value, fallback = null) {
  if (!value || value === true) {
    return fallback ? [...fallback] : [];
  }
  return [...new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean))];
}

/**
 * 紧凑 UTC 时间戳，用于 run id。
 * @param {Date} [date]
 * @returns {string}
 */
function compactUtcTimestamp(date = new Date()) {
  return date.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * 生成唯一 run id，若目录已存在则追加序号。
 * @param {string} prefix
 * @param {string} rootDir - 输出根目录
 * @param {Date} [date]
 * @returns {string}
 */
function uniqueRunId(prefix, rootDir, date = new Date()) {
  const base = `${prefix}-${compactUtcTimestamp(date)}`;
  let run = base;
  let suffix = 2;
  while (fs.existsSync(path.join(rootDir, "runs", run))) {
    run = `${base}-${suffix}`;
    suffix += 1;
  }
  return run;
}

/**
 * 并发执行 worker，控制最大并发数。
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function runWithConcurrency(items, concurrency, worker) {
  const results = /** @type {R[]} */ (new Array(items.length));
  let next = 0;

  async function consume() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length || 1) },
    consume
  );
  await Promise.all(workers);
  return results;
}

/**
 * 安全地创建目录。
 * @param {string} dir
 */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 读取文本文件。
 * @param {string} file
 * @returns {string}
 */
function readText(file) {
  return fs.readFileSync(file, "utf8");
}

/**
 * 解析 JSON 文件。
 * @param {string} file
 * @returns {any}
 */
function parseJsonFile(file) {
  return JSON.parse(readText(file));
}

/**
 * 原子写入新文件，若已存在则抛出错误。
 * @param {string} file
 * @param {string} content
 */
function writeFileNew(file, content) {
  if (fs.existsSync(file)) {
    throw new Error(`Refusing to overwrite existing file: ${file}`);
  }
  ensureDir(path.dirname(file));
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  );
  fs.writeFileSync(tempFile, content, { flag: "wx" });
  try {
    fs.linkSync(tempFile, file);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing file: ${file}`);
    }
    throw error;
  } finally {
    fs.unlinkSync(tempFile);
  }
}

/**
 * 原子写入生成文件，允许覆盖。
 * @param {string} file
 * @param {string} content
 */
function writeGenerated(file, content) {
  ensureDir(path.dirname(file));
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  );
  fs.writeFileSync(tempFile, content, { flag: "wx" });
  try {
    fs.renameSync(tempFile, file);
  } catch (error) {
    fs.unlinkSync(tempFile);
    throw error;
  }
}

/**
 * 将字符串转换为可用作文件名的 slug。
 * @param {string} value
 * @returns {string}
 */
function slug(value) {
  return String(value).trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * 验证正整数参数。
 * @param {string | number | true | undefined} value
 * @param {string} name
 * @returns {number}
 */
function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

module.exports = {
  parseList,
  compactUtcTimestamp,
  uniqueRunId,
  runWithConcurrency,
  ensureDir,
  readText,
  parseJsonFile,
  writeFileNew,
  writeGenerated,
  slug,
  positiveInteger
};
