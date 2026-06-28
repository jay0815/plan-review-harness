import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface Clock {
  now(): string
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(dirname(filePath))
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tempPath, filePath)
}

export async function atomicWriteText(filePath: string, value: string): Promise<void> {
  await ensureDir(dirname(filePath))
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, value, 'utf8')
  await rename(tempPath, filePath)
}
