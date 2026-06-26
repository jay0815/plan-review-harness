#!/usr/bin/env node

import assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { lintPlan, parseExistingCodeRefs, parseSections } from './plan-authoring-lint.js'
import { createPlanReferenceManifest } from './workspace-review-lib.js'

function requiredPlan({
  complexity = 'feature',
  existingHeading = 'Existing Code Refs',
  existingRefs = 'None',
  tasks = '- Implement the decided contract.',
  blocking = 'None',
  appendix = '',
} = {}) {
  return [
    '# Plan',
    '',
    '## Plan Complexity',
    `- level: ${complexity}`,
    '- reason: test fixture',
    '',
    '## Scope / Non-goals',
    '- Scope is explicit.',
    '',
    '## Requirements Mapping',
    '- Requirement maps to the task.',
    '',
    `## ${existingHeading}`,
    existingRefs,
    '',
    '## Contract Decisions',
    '- Contract is decided.',
    '',
    '## Blocking Decisions',
    blocking,
    '',
    '## Implementation Discretion',
    '- Local helper naming follows project conventions.',
    '',
    '## Tasks and Dependencies',
    tasks,
    '',
    '## Tests / Acceptance',
    '- Verify the requirement.',
    '',
    '## Open Questions / Risks',
    'None',
    appendix,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function padToLines(plan, targetLines) {
  const lines = plan.split('\n')
  const headingIndex = lines.findIndex((line) => line === '## Tasks and Dependencies')
  const insertAt = headingIndex + 1
  while (lines.length < targetLines) {
    lines.splice(insertAt, 0, `- Decision-preserving task note ${lines.length}.`)
  }
  return lines.join('\n')
}

function codes(result) {
  return {
    errors: result.errors.map((item) => item.code),
    warnings: result.warnings.map((item) => item.code),
  }
}

function main() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-authoring-lint-'))
  try {
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true })
    fs.mkdirSync(path.join(projectRoot, 'src', 'navigation'), { recursive: true })
    fs.mkdirSync(path.join(projectRoot, 'src', 'screens', 'credit', 'ocr'), { recursive: true })
    fs.mkdirSync(path.join(projectRoot, 'src', 'screens', 'main', 'mine'), { recursive: true })
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'example.ts'),
      ['export const first = true;', 'export function targetSymbol() {', '  return true;', '}', ''].join('\n'),
    )
    fs.writeFileSync(path.join(projectRoot, 'src', 'navigation', 'index.tsx'), 'export const Navigation = true;\n')
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'screens', 'credit', 'ocr', 'index.tsx'),
      'export const Ocr = true;\n',
    )
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'screens', 'main', 'mine', 'index.tsx'),
      'export const Mine = true;\n',
    )

    const feature180 = lintPlan({
      plan: padToLines(requiredPlan({ complexity: 'feature' }), 180),
      projectRoot,
    })
    assert.equal(feature180.metrics.total_lines, 180)
    assert.deepEqual(feature180.errors, [])
    assert.deepEqual(feature180.warnings, [])

    const crossFeature450 = lintPlan({
      plan: padToLines(requiredPlan({ complexity: 'cross_feature' }), 450),
      projectRoot,
    })
    assert.equal(crossFeature450.metrics.total_lines, 450)
    assert(codes(crossFeature450).warnings.includes('line_budget_exceeded'))
    assert.deepEqual(crossFeature450.errors, [])

    const hookPlan = requiredPlan({
      tasks: [
        '- Add the feature.',
        '',
        '```tsx',
        'export function UserCard() {',
        '  const [open, setOpen] = useState(false);',
        '  const onPress = () => setOpen(true);',
        '  return (',
        '    <View>',
        '      <Button onPress={onPress}>Open</Button>',
        '      {open ? <Modal><Text>Hello</Text></Modal> : null}',
        '    </View>',
        '  );',
        '}',
        'export function useUserCard() {',
        '  return useMemo(() => ({ open: true }), []);',
        '}',
        '```',
      ].join('\n'),
    })
    const hookResult = lintPlan({ plan: hookPlan, projectRoot })
    assert(codes(hookResult).errors.includes('implementation_code_block'))

    const contractBlocks = requiredPlan({
      appendix: [
        '',
        '## Optional Interface Contract Appendix',
        '```ts',
        'interface Request {',
        '  id: string;',
        '  enabled: boolean;',
        '}',
        '```',
        '```text',
        'src/',
        '├── api.ts',
        '└── types.ts',
        '```',
        '```mermaid',
        'flowchart LR',
        '  A[Caller] --> B[Service]',
        '```',
      ].join('\n'),
    })
    const contractResult = lintPlan({
      plan: padToLines(contractBlocks, 120),
      projectRoot,
    })
    assert.deepEqual(contractResult.errors, [])
    assert.deepEqual(contractResult.warnings, [])

    const i18nPlan = requiredPlan({
      appendix: [
        '',
        '## i18n translations',
        '```json',
        '{',
        '  "title": "Title",',
        '  "subtitle": "Subtitle",',
        '  "confirm": "Confirm",',
        '  "cancel": "Cancel",',
        '  "loading": "Loading",',
        '  "success": "Success",',
        '  "failure": "Failure",',
        '  "retry": "Retry"',
        '}',
        '```',
      ].join('\n'),
    })
    assert(codes(lintPlan({ plan: i18nPlan, projectRoot })).errors.includes('implementation_code_block'))

    const compactI18nPlan = requiredPlan({
      appendix: [
        '',
        '## i18n translations',
        '```json',
        '{',
        '  "title": "Title",',
        '  "confirm": "Confirm",',
        '  "cancel": "Cancel",',
        '  "retry": "Retry"',
        '}',
        '```',
      ].join('\n'),
    })
    assert(codes(lintPlan({ plan: compactI18nPlan, projectRoot })).errors.includes('implementation_code_block'))

    const todoBody = lintPlan({
      plan: requiredPlan({
        tasks: '- TODO confirm the handler while implementing.',
      }),
      projectRoot,
    })
    assert(codes(todoBody).warnings.includes('uncertain_wording_outside_decision_section'))

    const todoBlocking = lintPlan({
      plan: requiredPlan({
        blocking: '- TODO confirm the public contract before coding.',
      }),
      projectRoot,
    })
    assert(!codes(todoBlocking).warnings.includes('uncertain_wording_outside_decision_section'))

    const missingRef = lintPlan({
      plan: requiredPlan({
        existingRefs: ['- path: src/missing.ts', '  lines: 1-2', '  symbol: missingSymbol', '  reason: test'].join(
          '\n',
        ),
      }),
      projectRoot,
    })
    assert(codes(missingRef).errors.includes('existing_ref_file_missing'))

    const outOfRangeRef = lintPlan({
      plan: requiredPlan({
        existingRefs: ['- path: src/example.ts', '  lines: 20-30', '  symbol: targetSymbol', '  reason: test'].join(
          '\n',
        ),
      }),
      projectRoot,
    })
    assert(codes(outOfRangeRef).errors.includes('existing_ref_lines_out_of_range'))

    const symbolMissingRef = lintPlan({
      plan: requiredPlan({
        existingRefs: ['- path: src/example.ts', '  lines: 1-4', '  symbol: missingSymbol', '  reason: test'].join(
          '\n',
        ),
      }),
      projectRoot,
    })
    assert(codes(symbolMissingRef).errors.includes('existing_ref_symbol_missing'))

    const futureRef = lintPlan({
      plan: requiredPlan({
        existingRefs: [
          '- path: proposed-code/new-component.tsx',
          '  lines: 1-20',
          '  symbol: NewComponent',
          '  reason: future implementation',
        ].join('\n'),
      }),
      projectRoot,
    })
    assert(codes(futureRef).errors.includes('existing_ref_future_path'))

    const validRef = lintPlan({
      plan: requiredPlan({
        existingRefs: [
          '- path: src/example.ts',
          '  lines: 2-4',
          '  symbol: targetSymbol',
          '  reason: verified integration point',
        ].join('\n'),
      }),
      projectRoot,
    })
    assert.deepEqual(validRef.errors, [])
    assert.equal(validRef.metrics.existing_code_ref_count, 1)
    assert.equal(validRef.metrics.structured_existing_code_ref_count, 1)
    assert.equal(validRef.metrics.inline_existing_code_ref_count, 0)

    const chineseMappingPlan = requiredPlan({
      existingHeading: '3. 现有代码映射',
      existingRefs: [
        '### 3.1 Mine 页',
        '`screens/main/mine/index.tsx:1`：Mine tab 入口。',
        '`navigation/index.tsx:1`：路由配置。',
        '`ocr/index.tsx:1`：短路径应按 workspace resolver 唯一 suffix 解析。',
        '',
        '### 3.2 其他说明',
        '`src/missing-inline.ts`：不存在的 inline 引用不计入证据。',
      ].join('\n'),
    })
    const chineseMappingRefs = lintPlan({
      plan: chineseMappingPlan,
      projectRoot,
    })
    const parsedChineseRefs = parseExistingCodeRefs(parseSections(chineseMappingPlan), projectRoot)
    const chineseManifest = createPlanReferenceManifest(projectRoot, chineseMappingPlan, [])
    const chineseManifestRefCount =
      chineseManifest.existing_code_refs.length + chineseManifest.existing_code_ref_dirs.length
    assert(!codes(chineseMappingRefs).errors.includes('required_section_missing'))
    assert(!codes(chineseMappingRefs).errors.includes('existing_ref_incomplete'))
    assert.equal(chineseMappingRefs.metrics.existing_code_ref_count, chineseManifestRefCount)
    assert.equal(chineseMappingRefs.metrics.existing_code_ref_count, 3)
    assert.equal(chineseMappingRefs.metrics.inline_existing_code_ref_count, 3)
    assert.equal(chineseMappingRefs.metrics.structured_existing_code_ref_count, 0)
    assert(parsedChineseRefs.some((ref) => ref.path === 'src/screens/main/mine/index.tsx' && ref.lines === '1'))
    assert(parsedChineseRefs.some((ref) => ref.path === 'src/screens/credit/ocr/index.tsx' && ref.lines === '1'))

    const mappedChineseRequiredPlan = [
      '# 中文计划',
      '',
      '<!-- 章节映射（供 linter 识别）',
      'scope_non_goals: §1 需求范围与边界',
      'requirements_mapping: §2 关键假设',
      'existing_code_refs: §3 现有代码映射',
      'contract_decisions: §7 接口契约',
      'blocking_decisions: §14 待确认项',
      'implementation_discretion: §4 OTP 组件复用决策 + §8 关键设计决策',
      'tasks_dependencies: §15 实施顺序',
      'tests_acceptance: §16 验收',
      '-->',
      '',
      '## 1. 需求范围与边界',
      '- 范围明确。',
      '',
      '## 2. 关键假设',
      '- 需求映射到任务。',
      '',
      '## 3. 现有代码映射',
      '`src/example.ts:1`：示例引用。',
      '',
      '## 4. OTP 组件复用决策',
      '- 本地实现细节按既有约定。',
      '',
      '## 7. 接口契约',
      '- 契约已定。',
      '',
      '## 14. 待确认项',
      'None',
      '',
      '## 15. 实施顺序',
      '- Implement the decided contract.',
      '',
      '## 16. 验收',
      '- Verify the requirement.',
      '',
      '## 17. 风险',
      'None',
    ].join('\n')
    const mappedChineseRequired = lintPlan({
      plan: mappedChineseRequiredPlan,
      projectRoot,
    })
    assert(!codes(mappedChineseRequired).errors.includes('required_section_missing'))

    // Complete arrow function (content-based, not length-based) should be rejected
    const arrowPlan = requiredPlan({
      appendix: [
        '',
        '## Implementation Details',
        '```ts',
        'const handleAuth = async (req: Request) => {',
        '  const token = req.headers.authorization;',
        '  if (!token) return unauthorized();',
        '  req.user = await verify(token);',
        '  return next(req);',
        '};',
        '```',
      ].join('\n'),
    })
    const arrowResult = lintPlan({ plan: arrowPlan, projectRoot })
    assert(
      codes(arrowResult).errors.includes('implementation_code_block'),
      'complete arrow function should be flagged regardless of line count',
    )
    assert(
      arrowResult.metrics.code_blocks.some((b) => b.kind === 'arrow_function_implementation'),
      'arrow function should be classified as arrow_function_implementation',
    )

    // Short complete function (5 lines) should also be rejected
    const shortFuncPlan = requiredPlan({
      appendix: [
        '',
        '## Implementation Details',
        '```ts',
        'function greet(name: string) {',
        '  return `Hello ${name}`;',
        '}',
        '```',
      ].join('\n'),
    })
    const shortFuncResult = lintPlan({ plan: shortFuncPlan, projectRoot })
    assert(
      codes(shortFuncResult).errors.includes('implementation_code_block'),
      'short complete function should be flagged regardless of line count',
    )

    // Arrow function with type annotation
    const typedArrowPlan = requiredPlan({
      appendix: [
        '',
        '## Implementation Details',
        '```ts',
        'const add: AddFn = (a: number, b: number) => {',
        '  return a + b;',
        '};',
        '```',
      ].join('\n'),
    })
    const typedArrowResult = lintPlan({ plan: typedArrowPlan, projectRoot })
    assert(
      codes(typedArrowResult).errors.includes('implementation_code_block'),
      'arrow function with type annotation should be flagged',
    )

    // Anonymous default export function
    const anonPlan = requiredPlan({
      appendix: [
        '',
        '## Implementation Details',
        '```ts',
        'export default function(req: Request) {',
        '  return handle(req);',
        '}',
        '```',
      ].join('\n'),
    })
    const anonResult = lintPlan({ plan: anonPlan, projectRoot })
    assert(
      codes(anonResult).errors.includes('implementation_code_block'),
      'anonymous default export function should be flagged',
    )

    // Generic arrow function
    const genericArrowPlan = requiredPlan({
      appendix: [
        '',
        '## Implementation Details',
        '```ts',
        'const identity = <T>(value: T): T => {',
        '  return value;',
        '};',
        '```',
      ].join('\n'),
    })
    const genericArrowResult = lintPlan({ plan: genericArrowPlan, projectRoot })
    assert(
      codes(genericArrowResult).errors.includes('implementation_code_block'),
      'generic arrow function should be flagged',
    )

    // Expression-body arrow function (multi-line)
    const exprArrowPlan = requiredPlan({
      appendix: [
        '',
        '## Implementation Details',
        '```ts',
        'const compute = (x: number) =>',
        '  x * 2 + 1;',
        '```',
      ].join('\n'),
    })
    const exprArrowResult = lintPlan({ plan: exprArrowPlan, projectRoot })
    assert(
      codes(exprArrowResult).errors.includes('implementation_code_block'),
      'multi-line expression-body arrow should be flagged',
    )

    const arrowExpressionCases = [
      {
        name: 'single-line async side-effect arrow',
        code: ['const load = async (id: string) => await api.get(id);'],
      },
      {
        name: 'single-line pure expression arrow',
        code: ['const add = (left: number, right: number) => left + right;'],
      },
      {
        name: 'single-line call arrow',
        code: ['const save = (value: string) => cache.set("key", value);'],
      },
      {
        name: 'typed multi-line expression arrow',
        code: ['const compute: Compute = (x: number) =>', '  x * 2;'],
      },
      {
        name: 'single-parameter multi-line arrow',
        code: ['const double = x =>', '  x * 2;'],
      },
      {
        name: 'parenthesized expression arrow',
        code: ['const render = (value: string) => (', '  <View>{value}</View>', ');'],
      },
      {
        name: 'function-typed assigned arrow',
        code: ['const handle: (value: string) => void =', '  (value) => log(value);'],
      },
    ]
    for (const item of arrowExpressionCases) {
      const result = lintPlan({
        plan: requiredPlan({
          appendix: ['', '## Implementation Details', '```tsx', ...item.code, '```'].join('\n'),
        }),
        projectRoot,
      })
      assert(
        codes(result).errors.includes('implementation_code_block'),
        `${item.name} should be flagged as implementation_code_block`,
      )
      assert(
        result.metrics.code_blocks.some((block) => block.kind === 'arrow_function_implementation'),
        `${item.name} should be classified as arrow_function_implementation`,
      )
    }

    const declarationOnlyPlan = requiredPlan({
      appendix: [
        '',
        '## Optional Interface Contract Appendix',
        '```ts',
        'declare const handle: (value: string) => void;',
        '```',
      ].join('\n'),
    })
    const declarationOnlyResult = lintPlan({
      plan: declarationOnlyPlan,
      projectRoot,
    })
    assert(
      !codes(declarationOnlyResult).errors.includes('implementation_code_block'),
      'function type declaration without an initializer should remain allowed',
    )

    const arrowTextPlan = requiredPlan({
      appendix: [
        '',
        '## Optional Interface Contract Appendix',
        '```ts',
        'const arrowToken = "=>";',
        'const explanation = "callbacks use => syntax";',
        '```',
      ].join('\n'),
    })
    const arrowTextResult = lintPlan({
      plan: arrowTextPlan,
      projectRoot,
    })
    assert(
      !codes(arrowTextResult).errors.includes('implementation_code_block'),
      'arrow tokens inside strings should not be classified as function implementations',
    )

    console.log('plan authoring lint tests passed')
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
}

main()
