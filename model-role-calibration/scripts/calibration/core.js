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
exports.parseList = parseList;
exports.compactUtcTimestamp = compactUtcTimestamp;
exports.uniqueRunId = uniqueRunId;
exports.runWithConcurrency = runWithConcurrency;
exports.ensureDir = ensureDir;
exports.readText = readText;
exports.parseJsonFile = parseJsonFile;
exports.writeFileNew = writeFileNew;
exports.writeGenerated = writeGenerated;
exports.slug = slug;
exports.positiveInteger = positiveInteger;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
function parseList(value, fallback = null) {
    if (!value || value === true) {
        return fallback ? [...fallback] : [];
    }
    return [
        ...new Set(String(value)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)),
    ];
}
function compactUtcTimestamp(date = new Date()) {
    return date
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
}
function uniqueRunId(prefix, rootDir, date = new Date()) {
    const base = `${prefix}-${compactUtcTimestamp(date)}`;
    let run = base;
    let suffix = 2;
    while (fs.existsSync(path.join(rootDir, 'runs', run))) {
        run = `${base}-${suffix}`;
        suffix += 1;
    }
    return run;
}
async function runWithConcurrency(items, concurrency, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function consume() {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await worker(items[index]);
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, consume);
    await Promise.all(workers);
    return results;
}
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
function readText(file) {
    return fs.readFileSync(file, 'utf8');
}
function parseJsonFile(file) {
    return JSON.parse(readText(file));
}
function writeFileNew(file, content) {
    if (fs.existsSync(file)) {
        throw new Error(`Refusing to overwrite existing file: ${file}`);
    }
    ensureDir(path.dirname(file));
    const tempFile = temporarySibling(file);
    fs.writeFileSync(tempFile, content, { flag: 'wx' });
    try {
        fs.linkSync(tempFile, file);
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'EEXIST') {
            throw new Error(`Refusing to overwrite existing file: ${file}`);
        }
        throw error;
    }
    finally {
        fs.unlinkSync(tempFile);
    }
}
function writeGenerated(file, content) {
    ensureDir(path.dirname(file));
    const tempFile = temporarySibling(file);
    fs.writeFileSync(tempFile, content, { flag: 'wx' });
    try {
        fs.renameSync(tempFile, file);
    }
    catch (error) {
        fs.unlinkSync(tempFile);
        throw error;
    }
}
function slug(value) {
    return String(value)
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '');
}
function positiveInteger(value, name) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
}
function temporarySibling(file) {
    return path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}
