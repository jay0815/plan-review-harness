#!/usr/bin/env node

import * as fs from 'node:fs'
import * as path from 'node:path'

import { isMainScript, parseArgs, requireArg } from '../lib/lib.js'
import {
  EXISTING_CODE_REFS_HEADING_PATTERN,
  collectPathCandidates,
  createPlanReferenceManifest,
} from '../lib/workspace-review-lib.js'

const LINE_BUDGETS: Record<string, number> = {
  single_file: 50,
  feature: 200,
  cross_feature: 400,
  architecture: 600,
}

const REQUIRED_SECTION_GROUPS: RequiredSectionGroup[] = [
  { name: 'scope_non_goals', patterns: [/\bscope\b/i, /\bnon[- ]?goals?\b/i] },
  { name: 'requirements_mapping', patterns: [/\brequirements?\s+mapping\b/i, /需求映射/] },
  { name: 'existing_code_refs', patterns: [EXISTING_CODE_REFS_HEADING_PATTERN] },
  { name: 'contract_decisions', patterns: [/\bcontract\s+decisions?\b/i, /契约决策/] },
  { name: 'blocking_decisions', patterns: [/\bblocking\s+decisions?\b/i, /阻塞决策/] },
  { name: 'implementation_discretion', patterns: [/\bimplementation\s+discretion\b/i, /实现自由|实现阶段决定/] },
  { name: 'tasks_dependencies', patterns: [/\btasks?\b.*\bdependencies\b/i, /任务.*依赖/] },
  { name: 'tests_acceptance', patterns: [/\btests?\b.*\bacceptance\b/i, /测试.*验收/] },
  { name: 'open_questions_risks', patterns: [/\bopen\s+questions?\b/i, /\brisks?\b/i, /待确认|风险/] },
]

const UNCERTAIN_PATTERN = /(可能|后续|临时|TODO|需与[^，。；\n]*确认|当前按[^，。；\n]*处理)/gi
const UNCERTAINTY_ALLOWED_SECTIONS = [
  /blocking\s+decisions?/i,
  /open\s+questions?/i,
  /risks?/i,
  /non[- ]?blocking\s+questions?/i,
  /阻塞决策/,
  /待确认/,
  /风险/,
  /非阻塞问题/,
]

type PlanComplexityLevel = 'single_file' | 'feature' | 'cross_feature' | 'architecture'
type ComplexitySource = 'explicit' | 'inferred'
type ExistingRefSource = 'structured' | 'inline'

interface RequiredSectionGroup {
  name: string
  patterns: RegExp[]
}

interface LintIssue {
  [key: string]: unknown
  code: string
  message: string
}

interface PlanLine {
  number: number
  text: string
}

interface PlanSection {
  title: string
  level: number
  start_line: number
  end_line: number
  lines: PlanLine[]
}

interface PlanComplexity {
  level: PlanComplexityLevel
  reason: string
  source: ComplexitySource
}

interface ExistingCodeRef {
  path: string
  path_line: number | null
  lines: string | null
  symbol: string | null
  reason: string | null
  source: ExistingRefSource
  original_ref: string
  target_kind?: 'file' | 'directory'
}

interface ManifestCodeRef {
  path: string
  line_ref: string | null
  lines?: string
  original_ref: string
}

interface CodeBlock {
  index: number
  language: string
  code: string
  start_line: number
  line_count: number
  char_count: number
}

interface CodeBlockClassification {
  kind: string
  allowed: boolean
  reliable?: boolean
  limit?: number
}

interface CodeBlockMetric {
  index: number
  line: number
  language: string | null
  line_count: number
  kind: string
  allowed: boolean
}

interface LintPlanOptions {
  plan: unknown
  projectRoot: string
}

interface LintPlanResult {
  complexity: PlanComplexity
  budgets: {
    line_budget: number
    max_code_blocks: number
    allowed_code_block_shapes: {
      interface_signature_lines: number
      data_flow_or_mermaid_lines: number
      file_tree_lines: number
    }
  }
  metrics: {
    total_lines: number
    total_chars: number
    section_count: number
    existing_code_ref_count: number
    structured_existing_code_ref_count: number
    inline_existing_code_ref_count: number
    code_block_count: number
    implementation_code_blocks: number
    implementation_code_lines: number
    line_budget_exceeded: boolean
    code_blocks: CodeBlockMetric[]
  }
  errors: LintIssue[]
  warnings: LintIssue[]
}

function issue(code: string, message: string, details: Record<string, unknown> = {}): LintIssue {
  return {
    code,
    message,
    ...details,
  }
}

function parseComplexityLevel(value: string): PlanComplexityLevel {
  return value.toLowerCase() as PlanComplexityLevel
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

export function parseSections(plan: unknown): PlanSection[] {
  const lines = String(plan).split('\n')
  const sections: PlanSection[] = []
  let current: PlanSection = {
    title: '__root__',
    level: 0,
    start_line: 1,
    end_line: lines.length,
    lines: [],
  }
  sections.push(current)
  lines.forEach((line, index) => {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading) {
      current.end_line = index
      current = {
        title: heading[2].trim(),
        level: heading[1].length,
        start_line: index + 1,
        end_line: lines.length,
        lines: [],
      }
      sections.push(current)
    } else {
      current.lines.push({
        number: index + 1,
        text: line,
      })
    }
  })
  return sections
}

function sectionMatches(section: PlanSection, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(section.title))
}

function explicitSectionMappings(plan: unknown): Set<string> {
  const mappings = new Set<string>()
  const allowed = new Set(REQUIRED_SECTION_GROUPS.map((group) => group.name))
  const pattern = /^\s*([a-z][a-z0-9_]+)\s*:\s*(?:§\s*)?(\d+(?:\.\d+)*)\b.*$/gim
  let match: RegExpExecArray | null
  while ((match = pattern.exec(String(plan))) !== null) {
    const name = match[1]
    if (allowed.has(name)) {
      mappings.add(name)
    }
  }
  return mappings
}

function hasRequiredSection(
  sections: PlanSection[],
  explicitMappings: Set<string>,
  group: RequiredSectionGroup,
): boolean {
  return explicitMappings.has(group.name) || sections.some((section) => sectionMatches(section, group.patterns))
}

function parseExplicitComplexity(plan: unknown, sections: PlanSection[]): PlanComplexity | null {
  const jsonMatch = String(plan).match(
    /"plan_complexity"\s*:\s*\{[\s\S]{0,300}?"level"\s*:\s*"(single_file|feature|cross_feature|architecture)"/i,
  )
  if (jsonMatch) {
    return {
      level: parseComplexityLevel(jsonMatch[1]),
      reason: '计划中的 plan_complexity.level',
      source: 'explicit',
    }
  }
  const section = sections.find((item) => /plan\s+complexity|计划复杂度/i.test(item.title))
  if (section) {
    const body = section.lines.map((item) => item.text).join('\n')
    const match = body.match(/\b(single_file|feature|cross_feature|architecture)\b/i)
    if (match) {
      return {
        level: parseComplexityLevel(match[1]),
        reason: `章节 ${section.title}`,
        source: 'explicit',
      }
    }
  }
  const inlineMatch = String(plan).match(
    /(?:plan[_ ]complexity|complexity|计划复杂度)\s*[:：]\s*(single_file|feature|cross_feature|architecture)\b/i,
  )
  if (inlineMatch) {
    return {
      level: parseComplexityLevel(inlineMatch[1]),
      reason: '计划中的复杂度标记',
      source: 'explicit',
    }
  }
  return null
}

function existingCodeRefsSections(sections: PlanSection[]): PlanSection[] {
  const result: PlanSection[] = []
  const seen = new Set<number>()
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]
    if (!EXISTING_CODE_REFS_HEADING_PATTERN.test(section.title)) {
      continue
    }
    for (let nested = index; nested < sections.length; nested += 1) {
      const candidate = sections[nested]
      if (nested > index && candidate.level <= section.level) {
        break
      }
      if (!seen.has(candidate.start_line)) {
        result.push(candidate)
        seen.add(candidate.start_line)
      }
    }
  }
  return result.sort((a, b) => a.start_line - b.start_line)
}

function existingCodeRefsSection(sections: PlanSection[]): PlanSection | null {
  return existingCodeRefsSections(sections)[0] || null
}

function sectionsToPlan(sections: PlanSection[]): string {
  return sections
    .filter((section) => section.title !== '__root__')
    .sort((a, b) => a.start_line - b.start_line)
    .flatMap((section) => [`${'#'.repeat(section.level)} ${section.title}`, ...section.lines.map((line) => line.text)])
    .join('\n')
}

function collectCandidateLineNumbers(sections: PlanSection[]): Map<string, number> {
  const lineNumbers = new Map<string, number>()
  for (const section of existingCodeRefsSections(sections)) {
    for (const entry of section.lines) {
      const pathMatch = entry.text.match(/^\s*-\s*path\s*:\s*(.+?)\s*$/i)
      const candidates = pathMatch ? [pathMatch[1].trim().replace(/^`|`$/g, '')] : collectPathCandidates(entry.text)
      for (const candidate of candidates) {
        if (!lineNumbers.has(candidate)) {
          lineNumbers.set(candidate, entry.number)
        }
      }
    }
  }
  return lineNumbers
}

function structuredRefKey(ref: ExistingCodeRef): string {
  return `${String(ref.path || '')
    .split(/[\\/]/)
    .join('/')}:${ref.lines || ''}`
}

function structuredRefPathKey(ref: ExistingCodeRef): string {
  return String(ref.path || '')
    .split(/[\\/]/)
    .join('/')
}

function manifestRefKey(ref: ExistingCodeRef | ManifestCodeRef): string {
  const lineRef = 'line_ref' in ref ? ref.line_ref : ref.lines
  return `${String(ref.path || '')
    .split(/[\\/]/)
    .join('/')}:${lineRef || ''}`
}

function parseStructuredExistingCodeRefs(sections: PlanSection[]): ExistingCodeRef[] {
  const refSections = existingCodeRefsSections(sections)
  if (!refSections.length) {
    return []
  }
  const refs: ExistingCodeRef[] = []
  let current: ExistingCodeRef | null = null
  for (const section of refSections) {
    current = null
    for (const entry of section.lines) {
      const pathMatch = entry.text.match(/^\s*-\s*path\s*:\s*(.+?)\s*$/i)
      if (pathMatch) {
        const refPath = pathMatch[1].trim().replace(/^`|`$/g, '')
        current = {
          path: refPath,
          path_line: entry.number,
          lines: null,
          symbol: null,
          reason: null,
          source: 'structured',
          original_ref: refPath,
        }
        refs.push(current)
        continue
      }
      const field = entry.text.match(/^\s*(?:-\s*)?(lines|symbol|reason)\s*:\s*(.*?)\s*$/i)
      if (current && field) {
        const key = field[1].toLowerCase() as 'lines' | 'symbol' | 'reason'
        current[key] = field[2].trim().replace(/^`|`$/g, '')
        continue
      }
      if (entry.text.match(/^\s*(?:-\s*)?(lines|symbol|reason)\s*:/i)) {
        continue
      }
    }
  }
  return refs
}

export function parseExistingCodeRefs(sections: PlanSection[], projectRoot: string = process.cwd()): ExistingCodeRef[] {
  const structuredRefs = parseStructuredExistingCodeRefs(sections)
  const structuredKeys = new Set(structuredRefs.map(structuredRefKey))
  const structuredPathKeys = new Set(structuredRefs.map(structuredRefPathKey))
  const structuredOriginalRefs = new Set(structuredRefs.map((ref) => ref.original_ref || ref.path))
  const candidateLineNumbers = collectCandidateLineNumbers(sections)
  const manifest = createPlanReferenceManifest(projectRoot, sectionsToPlan(sections), [])
  const inlineRefs: ExistingCodeRef[] = [
    ...(manifest.existing_code_refs as ManifestCodeRef[]).map((ref) => ({
      path: ref.path,
      path_line: candidateLineNumbers.get(ref.original_ref) || null,
      lines: ref.line_ref,
      symbol: null,
      reason: null,
      source: 'inline' as const,
      target_kind: 'file' as const,
      original_ref: ref.original_ref,
    })),
    ...(manifest.existing_code_ref_dirs as ManifestCodeRef[]).map((ref) => ({
      path: ref.path,
      path_line: candidateLineNumbers.get(ref.original_ref) || null,
      lines: ref.line_ref,
      symbol: null,
      reason: null,
      source: 'inline' as const,
      target_kind: 'directory' as const,
      original_ref: ref.original_ref,
    })),
  ].filter(
    (ref) =>
      !structuredKeys.has(manifestRefKey(ref)) &&
      !structuredPathKeys.has(structuredRefPathKey(ref)) &&
      !structuredOriginalRefs.has(ref.original_ref),
  )
  return [...structuredRefs, ...inlineRefs]
}

function inferComplexity(plan: unknown, refs: ExistingCodeRef[]): PlanComplexity {
  const refCount = refs.length
  const text = String(plan)
  const sectionCount = (text.match(/^#{1,6}\s+/gm) || []).length
  const mermaidCount = (text.match(/```mermaid/gi) || []).length
  const _codeBlockCount = (text.match(/```[^\n]*\n/g) || []).length
  const totalLines = text.split('\n').length
  const hasMermaid = mermaidCount > 0
  const hasDecisionStructure = /decision|route|分支|决策|状态转换/i.test(text)
  const hasFlowDiagram = hasMermaid || /flowchart|sequenceDiagram|stateDiagram|graph\s+[A-Z]/i.test(text)

  if (
    refCount >= 16 ||
    sectionCount >= 13 ||
    totalLines >= 500 ||
    /system boundary|public contract|architecture decision|系统边界|公共契约|架构决策/i.test(text)
  ) {
    return {
      level: 'architecture',
      reason:
        refCount >= 16
          ? `根据现有代码引用数量（${refCount}）推断`
          : `根据计划结构推断：${sectionCount} 个章节，${totalLines} 行`,
      source: 'inferred',
    }
  }
  if (
    refCount >= 8 ||
    sectionCount >= 12 ||
    (hasFlowDiagram && totalLines >= 200) ||
    /cross[- ]feature|跨功能|跨模块|多个团队|multi[- ]team/i.test(text)
  ) {
    return {
      level: 'cross_feature',
      reason:
        refCount >= 8
          ? `根据现有代码引用数量（${refCount}）推断`
          : `根据计划结构推断：${sectionCount} 个章节，${totalLines} 行，${mermaidCount} 个图表`,
      source: 'inferred',
    }
  }
  if (
    refCount >= 2 ||
    sectionCount >= 3 ||
    hasMermaid ||
    hasDecisionStructure ||
    totalLines >= 100 ||
    /feature|功能/i.test(text)
  ) {
    return {
      level: 'feature',
      reason:
        refCount >= 2
          ? `根据现有代码引用数量（${refCount}）推断`
          : `根据计划结构推断：${sectionCount} 个章节，${totalLines} 行`,
      source: 'inferred',
    }
  }
  return {
    level: 'single_file',
    reason: `计划较短（${totalLines} 行，${sectionCount} 个章节），无跨文件证据`,
    source: 'inferred',
  }
}

export function parseCodeBlocks(plan: unknown): CodeBlock[] {
  const text = String(plan)
  const blocks: CodeBlock[] = []
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const code = match[2]
    blocks.push({
      index: blocks.length + 1,
      language: String(match[1] || '')
        .trim()
        .split(/\s+/)[0]
        .toLowerCase(),
      code,
      start_line: lineNumberAt(text, match.index),
      line_count: code.endsWith('\n') ? code.split('\n').length - 1 : code.split('\n').length,
      char_count: code.length,
    })
  }
  return blocks
}

function precedingHeading(sections: PlanSection[], line: number): string {
  return (
    sections.filter((section) => section.start_line <= line).sort((a, b) => b.start_line - a.start_line)[0]?.title || ''
  )
}

function stringLeafCount(value: unknown): number {
  if (typeof value === 'string') {
    return 1
  }
  if (Array.isArray(value)) {
    return value.reduce((sum: number, item: unknown) => sum + stringLeafCount(item), 0)
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce(
      (sum: number, item: unknown) => sum + stringLeafCount(item),
      0,
    )
  }
  return 0
}

function containsArrowOperator(text: string): boolean {
  let quote: string | null = null
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const next = text[index + 1]
    if (lineComment) {
      if (character === '\n') {
        lineComment = false
      }
      continue
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (character === '\\') {
        index += 1
      } else if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (character === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '=' && next === '>') {
      return true
    }
  }
  return false
}

function hasArrowFunctionAssignment(code: string): boolean {
  const declaration = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*/g
  let _match: RegExpExecArray | null
  while ((_match = declaration.exec(code)) !== null) {
    const remainder = code.slice(declaration.lastIndex)
    let assignmentIndex = -1
    for (let index = 0; index < remainder.length; index += 1) {
      const character = remainder[index]
      if (character === ';') {
        break
      }
      if (character === '=' && remainder[index + 1] !== '>' && !['=', '!', '<', '>'].includes(remainder[index - 1])) {
        assignmentIndex = index
        break
      }
    }
    if (assignmentIndex < 0) {
      continue
    }
    const initializer = remainder.slice(assignmentIndex + 1)
    const nextDeclaration = initializer.search(/\n\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*/)
    const candidate = nextDeclaration >= 0 ? initializer.slice(0, nextDeclaration) : initializer
    if (containsArrowOperator(candidate)) {
      return true
    }
  }
  return false
}

export function classifyCodeBlock(block: CodeBlock, sectionTitle: string): CodeBlockClassification {
  const language = block.language
  const code = block.code
  const lines = block.line_count
  if (language === 'mermaid') {
    return {
      kind: 'mermaid',
      allowed: lines <= 30,
      limit: 30,
    }
  }
  const nonEmpty = code
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const looksLikeTree =
    lines <= 20 &&
    nonEmpty.length > 0 &&
    nonEmpty.every(
      (line) =>
        /^[│├└─\s]+[A-Za-z0-9_.@/-]+$/.test(line) ||
        /^[A-Za-z0-9_.@-]+\/?$/.test(line) ||
        /^[-*]\s+[A-Za-z0-9_.@/-]+$/.test(line),
    )
  if (looksLikeTree) {
    return {
      kind: 'file_tree',
      allowed: true,
      limit: 20,
    }
  }
  const interfaceOnly =
    lines <= 10 && /\b(interface|type)\b/.test(code) && !/\bfunction\b|=>|\breturn\b|<[A-Z][A-Za-z0-9]*/.test(code)
  if (interfaceOnly) {
    return {
      kind: 'interface_signature',
      allowed: true,
      limit: 10,
    }
  }
  if (language === 'json' && /i18n|translation|locale|国际化|文案/i.test(sectionTitle)) {
    try {
      const parsed = JSON.parse(code)
      if (lines >= 6 && stringLeafCount(parsed) >= 4) {
        return {
          kind: 'complete_i18n_json',
          allowed: false,
          reliable: true,
        }
      }
    } catch {
      // JSON syntax is outside this linter's responsibility.
    }
  }
  const hasTestImplementation =
    /\b(describe|test|it)\s*\(|\bexpect\s*\(/.test(code) &&
    (lines > 10 || (code.match(/\bexpect\s*\(/g) || []).length >= 3)
  if (hasTestImplementation) {
    return {
      kind: 'test_implementation',
      allowed: false,
      reliable: true,
    }
  }
  const hasHookOrComponent =
    /\bfunction\s+use[A-Z]\w*\s*\(|\bconst\s+use[A-Z]\w*\s*=/.test(code) ||
    /\bfunction\s+[A-Z]\w*\s*\(|\bconst\s+[A-Z]\w*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.test(code)
  const hasJsx = /return\s*\(\s*</s.test(code) || /<[A-Z][A-Za-z0-9]*(?:\s|>)/.test(code)
  if ((hasHookOrComponent && lines > 10) || (hasJsx && lines > 10)) {
    return {
      kind: hasJsx ? 'jsx_implementation' : 'hook_or_component_implementation',
      allowed: false,
      reliable: true,
    }
  }
  const hasCompleteFunction =
    (/\b(?:async\s+)?function\s+\w*\s*\([^)]*\)\s*(?::\s*\w[^\s{]*)?\s*\{/.test(code) ||
      /\bexport\s+default\s+(?:async\s+)?function\s*\([^)]*\)\s*\{/.test(code)) &&
    /^\}/m.test(code)
  if (hasCompleteFunction) {
    return {
      kind: 'function_implementation',
      allowed: false,
      reliable: true,
    }
  }
  if (hasArrowFunctionAssignment(code)) {
    return {
      kind: 'arrow_function_implementation',
      allowed: false,
      reliable: true,
    }
  }
  return {
    kind: 'unclassified',
    allowed: lines <= 10,
    reliable: false,
    limit: 10,
  }
}

function validateExistingCodeRefs(refs: ExistingCodeRef[], projectRoot: string, errors: LintIssue[]): void {
  const absoluteRoot = path.resolve(projectRoot)
  for (const ref of refs.filter((item) => item.source !== 'inline')) {
    if (!ref.path || !ref.lines || !ref.symbol || !ref.reason) {
      errors.push(
        issue('existing_ref_incomplete', 'Existing Code Ref 必须包含 path、lines、symbol 和 reason', {
          line: ref.path_line,
          path: ref.path || null,
        }),
      )
      continue
    }
    if (path.isAbsolute(ref.path) || ref.path.split(/[\\/]/).includes('..')) {
      errors.push(
        issue('existing_ref_outside_project', 'Existing Code Ref 必须是 project root 内的相对路径', {
          line: ref.path_line,
          path: ref.path,
        }),
      )
      continue
    }
    if (/^proposed-code\//.test(ref.path) || /(?:^|\/)(?:future|proposed|draft)(?:-code)?(?:\/|$)/i.test(ref.path)) {
      errors.push(
        issue('existing_ref_future_path', '未来文件或 proposed-code 不能作为 Existing Code Ref', {
          line: ref.path_line,
          path: ref.path,
        }),
      )
      continue
    }
    const absolute = path.resolve(absoluteRoot, ref.path)
    const relative = path.relative(absoluteRoot, absolute)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      errors.push(
        issue('existing_ref_outside_project', 'Existing Code Ref 超出 project root', {
          line: ref.path_line,
          path: ref.path,
        }),
      )
      continue
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      errors.push(
        issue('existing_ref_file_missing', 'Existing Code Ref 文件不存在', { line: ref.path_line, path: ref.path }),
      )
      continue
    }
    const lineMatch = ref.lines.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!lineMatch) {
      errors.push(
        issue('existing_ref_lines_invalid', 'Existing Code Ref lines 必须是 N 或 N-M', {
          line: ref.path_line,
          path: ref.path,
          lines: ref.lines,
        }),
      )
      continue
    }
    const start = Number(lineMatch[1])
    const end = Number(lineMatch[2] || lineMatch[1])
    const fileLines = fs.readFileSync(absolute, 'utf8').split('\n')
    if (start < 1 || end < start || end > fileLines.length) {
      errors.push(
        issue('existing_ref_lines_out_of_range', 'Existing Code Ref 行号超出文件范围', {
          line: ref.path_line,
          path: ref.path,
          lines: ref.lines,
          file_lines: fileLines.length,
        }),
      )
      continue
    }
    const excerpt = fileLines.slice(start - 1, end).join('\n')
    if (!excerpt.includes(ref.symbol)) {
      errors.push(
        issue('existing_ref_symbol_missing', 'Existing Code Ref 的 symbol 不在指定行号范围内', {
          line: ref.path_line,
          path: ref.path,
          lines: ref.lines,
          symbol: ref.symbol,
        }),
      )
    }
  }
}

export function lintPlan({ plan, projectRoot }: LintPlanOptions): LintPlanResult {
  const text = String(plan)
  const sections = parseSections(text)
  const explicitMappings = explicitSectionMappings(text)
  const refs = parseExistingCodeRefs(sections, projectRoot)
  const complexity = parseExplicitComplexity(text, sections) || inferComplexity(text, refs)
  const totalLines = text.split('\n').length
  const lineBudget = LINE_BUDGETS[complexity.level]
  const codeBlocks = parseCodeBlocks(text)
  const maxCodeBlocks = Math.ceil(totalLines / 100) * 2
  const errors: LintIssue[] = []
  const warnings: LintIssue[] = []

  for (const group of REQUIRED_SECTION_GROUPS) {
    if (!hasRequiredSection(sections, explicitMappings, group)) {
      errors.push(issue('required_section_missing', `缺少计划必备内容：${group.name}`, { section: group.name }))
    }
  }

  let implementationCodeBlocks = 0
  let implementationCodeLines = 0
  const codeBlockMetrics = codeBlocks.map((block): CodeBlockMetric => {
    const sectionTitle = precedingHeading(sections, block.start_line)
    const classification = classifyCodeBlock(block, sectionTitle)
    if (!classification.allowed && classification.reliable) {
      implementationCodeBlocks += 1
      implementationCodeLines += block.line_count
      errors.push(
        issue('implementation_code_block', `Plan 包含可可靠识别的完整实现型代码块：${classification.kind}`, {
          block: block.index,
          line: block.start_line,
          language: block.language || null,
          line_count: block.line_count,
          kind: classification.kind,
        }),
      )
    } else if (!classification.allowed) {
      warnings.push(
        issue('large_unclassified_code_block', '存在较长代码块，无法可靠判断是否为实现草案；请确认其只表达必要契约', {
          block: block.index,
          line: block.start_line,
          language: block.language || null,
          line_count: block.line_count,
        }),
      )
    }
    return {
      index: block.index,
      line: block.start_line,
      language: block.language || null,
      line_count: block.line_count,
      kind: classification.kind,
      allowed: classification.allowed,
    }
  })

  if (codeBlocks.length > maxCodeBlocks) {
    errors.push(
      issue('code_block_budget_exceeded', '代码块数量超过每 100 行最多两个的预算', {
        actual: codeBlocks.length,
        maximum: maxCodeBlocks,
      }),
    )
  }

  const lineBudgetExceeded = totalLines > lineBudget
  if (lineBudgetExceeded) {
    warnings.push(
      issue('line_budget_exceeded', `计划行数超过 ${complexity.level} 预算`, {
        actual: totalLines,
        budget: lineBudget,
        complexity: complexity.level,
      }),
    )
    if (implementationCodeBlocks > 0) {
      errors.push(
        issue('line_budget_with_implementation_bloat', '计划同时超过行数预算并包含完整实现型代码块', {
          actual_lines: totalLines,
          budget: lineBudget,
          implementation_code_blocks: implementationCodeBlocks,
        }),
      )
    }
  }

  for (const section of sections) {
    const allowed = UNCERTAINTY_ALLOWED_SECTIONS.some((pattern) => pattern.test(section.title))
    if (allowed) {
      continue
    }
    for (const line of section.lines) {
      const matches = [...line.text.matchAll(UNCERTAIN_PATTERN)]
      for (const match of matches) {
        warnings.push(
          issue('uncertain_wording_outside_decision_section', `待确认措辞“${match[0]}”不在允许章节中`, {
            line: line.number,
            section: section.title,
          }),
        )
      }
    }
  }

  validateExistingCodeRefs(refs, projectRoot, errors)

  return {
    complexity,
    budgets: {
      line_budget: lineBudget,
      max_code_blocks: maxCodeBlocks,
      allowed_code_block_shapes: {
        interface_signature_lines: 10,
        data_flow_or_mermaid_lines: 30,
        file_tree_lines: 20,
      },
    },
    metrics: {
      total_lines: totalLines,
      total_chars: text.length,
      section_count: Math.max(0, sections.length - 1),
      existing_code_ref_count: refs.length,
      structured_existing_code_ref_count: refs.filter((item) => item.source !== 'inline').length,
      inline_existing_code_ref_count: refs.filter((item) => item.source === 'inline').length,
      code_block_count: codeBlocks.length,
      implementation_code_blocks: implementationCodeBlocks,
      implementation_code_lines: implementationCodeLines,
      line_budget_exceeded: lineBudgetExceeded,
      code_blocks: codeBlockMetrics,
    },
    errors,
    warnings,
  }
}

function main() {
  const args = parseArgs(process.argv)
  const planFile = path.resolve(requireArg(args, 'plan'))
  const projectRoot = path.resolve(requireArg(args, 'project-root'))
  if (!fs.existsSync(planFile) || !fs.statSync(planFile).isFile()) {
    throw new Error(`Plan file does not exist: ${planFile}`)
  }
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root does not exist: ${projectRoot}`)
  }
  const result = lintPlan({
    plan: fs.readFileSync(planFile, 'utf8'),
    projectRoot,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.errors.length) {
    process.exitCode = 1
  }
}

if (isMainScript(__filename)) {
  try {
    main()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exitCode = 2
  }
}

export { LINE_BUDGETS }
