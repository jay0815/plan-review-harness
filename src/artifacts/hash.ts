import { createHash } from 'node:crypto'

export function stableJsonHash(value: unknown): string {
  const canonicalJson = JSON.stringify(value, sortObjectKeys)
  if (canonicalJson === undefined) throw new Error('Cannot hash a non-JSON-serializable value')
  return createHash('sha256').update(canonicalJson).digest('hex')
}

function sortObjectKeys(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = (value as Record<string, unknown>)[key]
      return sorted
    }, {})
}
