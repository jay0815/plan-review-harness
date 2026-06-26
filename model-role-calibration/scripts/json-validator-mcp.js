#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSchema = validateSchema;
exports.validateJsonText = validateJsonText;
exports.toolList = toolList;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const lib_js_1 = require("./lib.js");
function readSchema() {
    const file = process.env.MODEL_ROLE_CALIBRATION_SCHEMA_FILE;
    if (!file) {
        return null;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function typeOf(value) {
    if (Array.isArray(value)) {
        return 'array';
    }
    if (value === null) {
        return 'null';
    }
    if (Number.isInteger(value)) {
        return 'integer';
    }
    return typeof value;
}
function typeMatches(value, expected) {
    const actual = typeOf(value);
    if (expected === 'number') {
        return actual === 'number' || actual === 'integer';
    }
    return actual === expected;
}
function resolveRef(ref, rootSchema) {
    if (!ref || typeof ref !== 'string' || !ref.startsWith('#/')) {
        return null;
    }
    const parts = ref.slice(2).split('/');
    let current = rootSchema;
    for (const part of parts) {
        if (!current || typeof current !== 'object') {
            return null;
        }
        current = current[part];
    }
    return current || null;
}
function validateSchema(value, schema, path = '$', errors = [], rootSchema = null) {
    if (!schema || typeof schema !== 'object') {
        return errors;
    }
    if (schema.$ref) {
        const resolved = resolveRef(schema.$ref, rootSchema || schema);
        if (resolved) {
            return validateSchema(value, resolved, path, errors, rootSchema || schema);
        }
    }
    if (schema.const !== undefined && value !== schema.const) {
        errors.push({
            path,
            message: `expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`,
        });
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
        errors.push({
            path,
            message: `expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`,
        });
    }
    if (schema.type && !typeMatches(value, schema.type)) {
        errors.push({
            path,
            message: `expected type ${schema.type}, got ${typeOf(value)}`,
        });
        return errors;
    }
    if (schema.type === 'object' || schema.properties || schema.required) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            errors.push({ path, message: `expected object, got ${typeOf(value)}` });
            return errors;
        }
        for (const key of schema.required || []) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                errors.push({ path: `${path}.${key}`, message: 'missing required property' });
            }
        }
        const properties = schema.properties || {};
        for (const [key, childValue] of Object.entries(value)) {
            if (properties[key]) {
                validateSchema(childValue, properties[key], `${path}.${key}`, errors, rootSchema);
            }
            else if (schema.additionalProperties === false) {
                errors.push({ path: `${path}.${key}`, message: 'additional property is not allowed' });
            }
        }
    }
    if (schema.type === 'array' || schema.items) {
        if (!Array.isArray(value)) {
            errors.push({ path, message: `expected array, got ${typeOf(value)}` });
            return errors;
        }
        if (schema.minItems !== undefined && value.length < schema.minItems) {
            errors.push({ path, message: `expected at least ${schema.minItems} item(s), got ${value.length}` });
        }
        if (schema.maxItems !== undefined && value.length > schema.maxItems) {
            errors.push({ path, message: `expected at most ${schema.maxItems} item(s), got ${value.length}` });
        }
        if (schema.items) {
            value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`, errors, rootSchema));
        }
    }
    if (schema.type === 'string' && typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            errors.push({ path, message: `expected length >= ${schema.minLength}, got ${value.length}` });
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
            errors.push({ path, message: `expected length <= ${schema.maxLength}, got ${value.length}` });
        }
        if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
            errors.push({ path, message: `expected string to match ${schema.pattern}` });
        }
    }
    if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            errors.push({ path, message: `expected >= ${schema.minimum}, got ${value}` });
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            errors.push({ path, message: `expected <= ${schema.maximum}, got ${value}` });
        }
    }
    return errors;
}
function errorContext(text, error) {
    const match = /position (\d+)/.exec(error.message);
    if (!match) {
        return null;
    }
    const position = Number(match[1]);
    return {
        position,
        near: text.slice(Math.max(0, position - 120), position + 120),
    };
}
function validateJsonText(candidateText, schema = readSchema()) {
    if (typeof candidateText !== 'string') {
        return {
            valid: false,
            stage: 'input',
            errors: [{ path: '$.candidate_text', message: 'candidate_text must be a string' }],
        };
    }
    const text = candidateText.trim();
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
        };
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (error) {
        return {
            valid: false,
            stage: 'json_parse',
            errors: [
                {
                    path: '$',
                    message: error.message,
                    context: errorContext(text, error),
                },
            ],
        };
    }
    const schemaErrors = validateSchema(parsed, schema, '$', [], schema);
    if (schemaErrors.length) {
        return {
            valid: false,
            stage: 'schema',
            errors: schemaErrors.slice(0, 20),
        };
    }
    return {
        valid: true,
        stage: 'schema',
        errors: [],
        normalized_length: JSON.stringify(parsed).length,
    };
}
function appendLog(entry) {
    const file = process.env.MODEL_ROLE_CALIBRATION_VALIDATOR_LOG;
    if (!file) {
        return;
    }
    const record = {
        timestamp: new Date().toISOString(),
        pid: process.pid,
        ...entry,
    };
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify(record) + '\n');
    }
    catch (error) {
        console.error(`[json-validator] failed to write log: ${error.message}`);
    }
}
function errorSummary(errors) {
    return (errors || []).slice(0, 5).map((error) => ({
        path: error.path,
        message: error.message,
        context: error.context,
    }));
}
function logValidation(requestId, candidateText, result) {
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
    });
}
function toolList() {
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
    ];
}
function response(id, result) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function errorResponse(id, code, message) {
    process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code, message },
    }) + '\n');
}
function handle(message) {
    if (message.method === 'initialize') {
        appendLog({
            event: 'initialize',
            request_id: message.id,
            protocol_version: message.params?.protocolVersion || null,
            schema_file: process.env.MODEL_ROLE_CALIBRATION_SCHEMA_FILE || null,
            attempt: process.env.MODEL_ROLE_CALIBRATION_ATTEMPT || null,
            model: process.env.MODEL_ROLE_CALIBRATION_MODEL || null,
            probe: process.env.MODEL_ROLE_CALIBRATION_PROBE || null,
        });
        response(message.id, {
            protocolVersion: message.params?.protocolVersion || '2024-11-05',
            capabilities: {
                tools: {},
            },
            serverInfo: {
                name: 'model-role-calibration-json-validator',
                version: '1.0.0',
            },
            instructions: 'Call validate_json_output with your complete raw JSON candidate before your final answer.',
        });
        return;
    }
    if (message.method === 'notifications/initialized') {
        return;
    }
    if (message.method === 'tools/list') {
        appendLog({
            event: 'tools_list',
            request_id: message.id,
            tools: toolList().map((tool) => tool.name),
        });
        response(message.id, { tools: toolList() });
        return;
    }
    if (message.method === 'tools/call') {
        if (message.params?.name !== 'validate_json_output') {
            appendLog({
                event: 'unknown_tool',
                request_id: message.id,
                tool: message.params?.name || null,
            });
            errorResponse(message.id, -32601, `Unknown tool: ${message.params?.name}`);
            return;
        }
        const candidateText = message.params?.arguments?.candidate_text;
        const result = validateJsonText(candidateText);
        logValidation(message.id, candidateText, result);
        response(message.id, {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result),
                },
            ],
            isError: !result.valid,
        });
        return;
    }
    errorResponse(message.id, -32601, `Unknown method: ${message.method}`);
}
function main() {
    appendLog({
        event: 'server_start',
        schema_file: process.env.MODEL_ROLE_CALIBRATION_SCHEMA_FILE || null,
        attempt: process.env.MODEL_ROLE_CALIBRATION_ATTEMPT || null,
        model: process.env.MODEL_ROLE_CALIBRATION_MODEL || null,
        probe: process.env.MODEL_ROLE_CALIBRATION_PROBE || null,
    });
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            if (!line) {
                continue;
            }
            try {
                handle(JSON.parse(line));
            }
            catch (error) {
                appendLog({
                    event: 'rpc_error',
                    message: error.message,
                });
                console.error(error.stack || error.message);
            }
        }
    });
}
if ((0, lib_js_1.isMainScript)(__filename)) {
    main();
}
