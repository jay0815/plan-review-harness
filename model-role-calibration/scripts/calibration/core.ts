import * as fs from 'node:fs'
import * as path from 'node:path'

export type ListOptionValue = string | true | undefined
export type PositiveIntegerValue = string | number | true | undefined

export function parseList(value: ListOptionValue, fallback: string[] | null = null): string[] {
  if (!value || value === true) {
    return fallback ? [...fallback] : []
  }
  return [
    ...new Set(
      String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

export function compactUtcTimestamp(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

export function uniqueRunId(prefix: string, rootDir: string, date = new Date()): string {
  const base = `${prefix}-${compactUtcTimestamp(date)}`
  let run = base
  let suffix = 2
  while (fs.existsSync(path.join(rootDir, 'runs', run))) {
    run = `${base}-${suffix}`
    suffix += 1
  }
  return run
}

export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function consume(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index] as T)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, consume)
  await Promise.all(workers)
  return results
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

export function readText(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

export function parseJsonFile<T = unknown>(file: string): T {
  return JSON.parse(readText(file)) as T
}

export function writeFileNew(file: string, content: string): void {
  if (fs.existsSync(file)) {
    throw new Error(`Refusing to overwrite existing file: ${file}`)
  }
  ensureDir(path.dirname(file))
  const tempFile = temporarySibling(file)
  fs.writeFileSync(tempFile, content, { flag: 'wx' })
  try {
    fs.linkSync(tempFile, file)
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      throw new Error(`Refusing to overwrite existing file: ${file}`)
    }
    throw error
  } finally {
    fs.unlinkSync(tempFile)
  }
}

export function writeGenerated(file: string, content: string): void {
  ensureDir(path.dirname(file))
  const tempFile = temporarySibling(file)
  fs.writeFileSync(tempFile, content, { flag: 'wx' })
  try {
    fs.renameSync(tempFile, file)
  } catch (error) {
    fs.unlinkSync(tempFile)
    throw error
  }
}

export function slug(value: string): string {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function positiveInteger(value: PositiveIntegerValue, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function temporarySibling(file: string): string {
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`,
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
