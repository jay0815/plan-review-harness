#!/usr/bin/env node

import * as fs from 'node:fs'
import * as path from 'node:path'

import { isMainScript } from '../lib/lib.js'

type JsonObject = Record<string, unknown>

interface JsonSchema extends JsonObject {
  $ref?: string
  const?: unknown
  enum?: unknown[]
  type?: string
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  items?: unknown
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  minimum?: number
  maximum?: number
}

interface ValidationError {
  path: string
  message: string
  context?: {
    position: number
    near: string
  } | null
  [key: string]: unknown
}

interface ValidationResult {
  valid: boolean
  stage: 'input' | 'json_parse' | 'schema'
  errors: ValidationError[]
  normalized_length?: number
}

type JsonRpcId = string | number | null

interface JsonRpcMessage {
  id?: JsonRpcId
  method?: string
  params?: JsonObject
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorStackOrMessage(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error)
}

function readSchema(): unknown {
  const file = process.env.MODEL_ROLE_CALIBRATION_SCHEMA_FILE
  if (!file) {
    return null
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array'
  }
  if (value === null) {
    return 'null'
  }
  if (Number.isInteger(value)) {
    return 'integer'
  }
  return typeof value
}

function typeMatches(value: unknown, expected: string): boolean {
  const actual = typeOf(value)
  if (expected === 'number') {
    return actual === 'number' || actual === 'integer'
  }
  return actual === expected
}

function resolveRef(ref: unknown, rootSchema: unknown): JsonSchema | null {
  if (!ref || typeof ref !== 'string' || !ref.startsWith('#/')) {
    return null
  }
  const parts = ref.slice(2).split('/')
  let current: unknown = rootSchema
  for (const part of parts) {
    if (!isRecord(current)) {
      return null
    }
    current = current[part]
  }
  return isRecord(current) ? current : null
}

export function validateSchema(
  value: unknown,
  schema: unknown,
  path = '$',
  errors: ValidationError[] = [],
  rootSchema: unknown = null,
): ValidationError[] {
  if (!isRecord(schema)) {
    return errors
  }

  const jsonSchema = schema as JsonSchema

  if (jsonSchema.$ref) {
    const resolved = resolveRef(jsonSchema.$ref, rootSchema || jsonSchema)
    if (resolved) {
      return validateSchema(value, resolved, path, errors, rootSchema || jsonSchema)
    }
  }

  if (jsonSchema.const !== undefined && value !== jsonSchema.const) {
    errors.push({
      path,
      message: `expected const ${JSON.stringify(jsonSchema.const)}, got ${JSON.stringify(value)}`,
    })
  }

  if (Array.isArray(jsonSchema.enum) && !jsonSchema.enum.includes(value)) {
    errors.push({
      path,
      message: `expected one of ${jsonSchema.enum.map((item) => JSON.stringify(item)).join(', ')}`,
    })
  }

  if (typeof jsonSchema.type === 'string' && !typeMatches(value, jsonSchema.type)) {
    errors.push({
      path,
      message: `expected type ${jsonSchema.type}, got ${typeOf(value)}`,
    })
    return errors
  }

  if (jsonSchema.type === 'object' || jsonSchema.properties || jsonSchema.required) {
    if (!isRecord(value)) {
      errors.push({ path, message: `expected object, got ${typeOf(value)}` })
      return errors
    }
    for (const key of jsonSchema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push({ path: `${path}.${key}`, message: 'missing required property' })
      }
    }
    const properties = jsonSchema.properties || {}
    for (const [key, childValue] of Object.entries(value)) {
      if (properties[key]) {
        validateSchema(childValue, properties[key], `${path}.${key}`, errors, rootSchema)
      } else if (jsonSchema.additionalProperties === false) {
        errors.push({ path: `${path}.${key}`, message: 'additional property is not allowed' })
      }
    }
  }

  if (jsonSchema.type === 'array' || jsonSchema.items) {
    if (!Array.isArray(value)) {
      errors.push({ path, message: `expected array, got ${typeOf(value)}` })
      return errors
    }
    if (jsonSchema.minItems !== undefined && value.length < jsonSchema.minItems) {
      errors.push({ path, message: `expected at least ${jsonSchema.minItems} item(s), got ${value.length}` })
    }
    if (jsonSchema.maxItems !== undefined && value.length > jsonSchema.maxItems) {
      errors.push({ path, message: `expected at most ${jsonSchema.maxItems} item(s), got ${value.length}` })
    }
    if (jsonSchema.items) {
      value.forEach((item, index) => validateSchema(item, jsonSchema.items, `${path}[${index}]`, errors, rootSchema))
    }
  }

  if (jsonSchema.type === 'string' && typeof value === 'string') {
    if (jsonSchema.minLength !== undefined && value.length < jsonSchema.minLength) {
      errors.push({ path, message: `expected length >= ${jsonSchema.minLength}, got ${value.length}` })
    }
    if (jsonSchema.maxLength !== undefined && value.length > jsonSchema.maxLength) {
      errors.push({ path, message: `expected length <= ${jsonSchema.maxLength}, got ${value.length}` })
    }
    if (jsonSchema.pattern !== undefined && !new RegExp(jsonSchema.pattern).test(value)) {
      errors.push({ path, message: `expected string to match ${jsonSchema.pattern}` })
    }
  }

  if ((jsonSchema.type === 'number' || jsonSchema.type === 'integer') && typeof value === 'number') {
    if (jsonSchema.minimum !== undefined && value < jsonSchema.minimum) {
      errors.push({ path, message: `expected >= ${jsonSchema.minimum}, got ${value}` })
    }
    if (jsonSchema.maximum !== undefined && value > jsonSchema.maximum) {
      errors.push({ path, message: `expected <= ${jsonSchema.maximum}, got ${value}` })
    }
  }

  return errors
}

function errorContext(text: string, error: unknown): ValidationError['context'] {
  const match = /position (\d+)/.exec(errorMessage(error))
  if (!match) {
    return null
  }
  const position = Number(match[1])
  return {
    position,
    near: text.slice(Math.max(0, position - 120), position + 120),
  }
}

export function validateJsonText(candidateText: unknown, schema: unknown = readSchema()): ValidationResult {
  if (typeof candidateText !== 'string') {
    return {
      valid: false,
      stage: 'input',
      errors: [{ path: '$.candidate_text', message: 'candidate_text must be a string' }],
    }
  }

  const text = candidateText.trim()
  if (/^```/.test(text) || /```$/.test(text)) {
    return {
      valid: false,
      stage: 'json_parse',
      errors: [
        {
          path: '$',
          message: 'candidate_text must be raw JSON only; remove markdown code fences',
        },
      ],
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      valid: false,
      stage: 'json_parse',
      errors: [
        {
          path: '$',
          message: errorMessage(error),
          context: errorContext(text, error),
        },
      ],
    }
  }

  const schemaErrors = validateSchema(parsed, schema, '$', [], schema)
  if (schemaErrors.length) {
    return {
      valid: false,
      stage: 'schema',
      errors: schemaErrors.slice(0, 20),
    }
  }

  return {
    valid: true,
    stage: 'schema',
    errors: [],
    normalized_length: JSON.stringify(parsed).length,
  }
}

function appendLog(entry: Record<string, unknown>): void {
  const file = process.env.MODEL_ROLE_CALIBRATION_VALIDATOR_LOG
  if (!file) {
    return
  }
  const record = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    ...entry,
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(record) + '\n')
  } catch (error) {
    console.error(`[json-validator] failed to write log: ${errorMessage(error)}`)
  }
}

function errorSummary(errors: unknown): ValidationError[] {
  return (Array.isArray(errors) ? errors : [])
    .slice(0, 5)
    .filter(isRecord)
    .map((error) => ({
      path: typeof error.path === 'string' ? error.path : '$',
      message: typeof error.message === 'string' ? error.message : String(error.message || ''),
      context: isRecord(error.context) ? (error.context as ValidationError['context']) : undefined,
    }))
}

function logValidation(requestId: JsonRpcId | undefined, candidateText: unknown, result: ValidationResult): void {
  appendLog({
    event: 'tool_call',
    request_id: requestId,
    schema_file: process.env.MODEL_ROLE_CALIBRATION_SCHEMA_FILE || null,
    attempt: process.env.MODEL_ROLE_CALIBRATION_ATTEMPT || null,
    model: process.env.MODEL_ROLE_CALIBRATION_MODEL || null,
    probe: process.env.MODEL_ROLE_CALIBRATION_PROBE || null,
    candidate_type: typeof candidateText,
    candidate_length: typeof candidateText === 'string' ? candidateText.length : null,
    trimmed_length: typeof candidateText === 'string' ? candidateText.trim().length : null,
    valid: Boolean(result.valid),
    stage: result.stage || null,
    normalized_length: result.normalized_length || null,
    error_count: Array.isArray(result.errors) ? result.errors.length : 0,
    errors: errorSummary(result.errors),
  })
}

export function toolList() {
  return [
    {
      name: 'validate_json_output',
      description: [
        'Validate the exact final JSON text before answering.',
        'Use this after drafting your complete candidate output.',
        'The candidate_text must be raw JSON only, with no markdown fences.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        required: ['candidate_text'],
        properties: {
          candidate_text: {
            type: 'string',
            description: 'The exact raw JSON text you plan to return as the final answer.',
          },
        },
        additionalProperties: false,
      },
      _meta: {
        'anthropic/alwaysLoad': true,
      },
    },
  ]
}

function response(id: JsonRpcId | undefined, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function errorResponse(id: JsonRpcId | undefined, code: number, message: string): void {
  process.stdout.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    }) + '\n',
  )
}

function handle(message: JsonRpcMessage): void {
  const params = isRecord(message.params) ? message.params : {}
  if (message.method === 'initialize') {
    appendLog({
      event: 'initialize',
      request_id: message.id,
      protocol_version: params.protocolVersion || null,
      schema_file: process.env.MODEL_ROLE_CALIBRATION_SCHEMA_FILE || null,
      attempt: process.env.MODEL_ROLE_CALIBRATION_ATTEMPT || null,
      model: process.env.MODEL_ROLE_CALIBRATION_MODEL || null,
      probe: process.env.MODEL_ROLE_CALIBRATION_PROBE || null,
    })
    response(message.id, {
      protocolVersion: params.protocolVersion || '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'model-role-calibration-json-validator',
        version: '1.0.0',
      },
      instructions: 'Call validate_json_output with your complete raw JSON candidate before your final answer.',
    })
    return
  }

  if (message.method === 'notifications/initialized') {
    return
  }

  if (message.method === 'tools/list') {
    appendLog({
      event: 'tools_list',
      request_id: message.id,
      tools: toolList().map((tool) => tool.name),
    })
    response(message.id, { tools: toolList() })
    return
  }

  if (message.method === 'tools/call') {
    const toolName = typeof params.name === 'string' ? params.name : null
    if (toolName !== 'validate_json_output') {
      appendLog({
        event: 'unknown_tool',
        request_id: message.id,
        tool: toolName,
      })
      errorResponse(message.id, -32601, `Unknown tool: ${toolName}`)
      return
    }
    const args = isRecord(params.arguments) ? params.arguments : {}
    const candidateText = args.candidate_text
    const result = validateJsonText(candidateText)
    logValidation(message.id, candidateText, result)
    response(message.id, {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result),
        },
      ],
      isError: !result.valid,
    })
    return
  }

  errorResponse(message.id, -32601, `Unknown method: ${message.method}`)
}

function main() {
  appendLog({
    event: 'server_start',
    schema_file: process.env.MODEL_ROLE_CALIBRATION_SCHEMA_FILE || null,
    attempt: process.env.MODEL_ROLE_CALIBRATION_ATTEMPT || null,
    model: process.env.MODEL_ROLE_CALIBRATION_MODEL || null,
    probe: process.env.MODEL_ROLE_CALIBRATION_PROBE || null,
  })
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) {
        continue
      }
      try {
        const message = JSON.parse(line) as unknown
        if (!isRecord(message)) {
          throw new Error('JSON-RPC message must be an object')
        }
        handle(message)
      } catch (error) {
        appendLog({
          event: 'rpc_error',
          message: errorMessage(error),
        })
        console.error(errorStackOrMessage(error))
      }
    }
  })
}

if (isMainScript(__filename)) {
  main()
}
