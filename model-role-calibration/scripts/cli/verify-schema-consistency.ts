#!/usr/bin/env node

/**
 * Verify that shared enum values in src/schemas/common.ts are consistent
 * with the JSON Schema files in model-role-calibration/schemas/.
 *
 * Run: node --import tsx model-role-calibration/scripts/cli/verify-schema-consistency.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { ROOT } from '../lib/lib.js'

const SCHEMAS_DIR = path.join(ROOT, 'schemas')

// Source of truth: must match src/schemas/common.ts SEVERITY_VALUES
const EXPECTED_SEVERITY = ['blocker', 'high', 'medium', 'low']

function findSeverityEnums(dir: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.schema.json'))

  for (const file of files) {
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    const enums = extractSeverityEnums(content, '')
    if (enums.length > 0) {
      result.set(file, enums)
    }
  }
  return result
}

function extractSeverityEnums(obj: unknown, _path: string): string[] {
  if (!obj || typeof obj !== 'object') return []

  const record = obj as Record<string, unknown>
  const results: string[] = []

  // Check if this node IS a severity field with an enum
  if (Array.isArray(record.enum) && record.type === 'string') {
    // This might be a severity enum — we'll collect it and filter later
  }

  // Check if this node has a "severity" property with an enum
  if (record.severity && typeof record.severity === 'object') {
    const severity = record.severity as Record<string, unknown>
    if (Array.isArray(severity.enum)) {
      results.push(...severity.enum.map(String))
    }
  }

  // Recurse into ALL object values (not just known keywords)
  for (const [key, value] of Object.entries(record)) {
    if (key === 'severity' || key === 'enum' || key === 'type') continue // already handled
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        for (const item of value) {
          results.push(...extractSeverityEnums(item, _path))
        }
      } else {
        results.push(...extractSeverityEnums(value, _path))
      }
    }
  }

  return results
}

let hasError = false

const severityEnums = findSeverityEnums(SCHEMAS_DIR)
for (const [file, enums] of severityEnums) {
  const sortedActual = [...enums].sort()
  const sortedExpected = [...EXPECTED_SEVERITY].sort()
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    console.error(`[MISMATCH] ${file}: severity enum ${JSON.stringify(enums)} !== ${JSON.stringify(EXPECTED_SEVERITY)}`)
    hasError = true
  } else {
    console.log(`[OK] ${file}: severity enum matches`)
  }
}

if (severityEnums.size === 0) {
  console.log('[WARN] No severity enums found in JSON Schema files')
}

if (hasError) {
  console.error('\nSchema consistency check FAILED. Update JSON Schema severity enums to match src/schemas/common.ts')
  process.exit(1)
} else {
  console.log('\nSchema consistency check passed.')
}
