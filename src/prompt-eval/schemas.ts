import { z } from 'zod'

export const PROMPT_EVAL_SUITE_VALUES = ['smoke', 'golden', 'regression', 'adversarial'] as const
export const PROMPT_EVAL_CHECK_CATEGORY_VALUES = ['contract', 'deterministic', 'judge', 'human'] as const
export const PROMPT_EVAL_CHECK_STATUS_VALUES = ['pass', 'fail', 'warn', 'skip'] as const
export const PROMPT_EVAL_CASE_STATUS_VALUES = ['passed', 'failed', 'warning', 'skipped'] as const

const MetadataSchema = z.record(z.string(), z.unknown()).default(() => ({}))

function hasAtLeastOneMatcher(value: { outputId?: string; title?: string; text?: string }): boolean {
  return Boolean(value.outputId || value.title || value.text)
}

export const PromptEvalPromptVersionSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  hash: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
})
export type PromptEvalPromptVersion = z.infer<typeof PromptEvalPromptVersionSchema>

export const PromptEvalInputSchema = z
  .object({
    kind: z.enum(['inline', 'file', 'directory', 'artifact']),
    value: z.unknown().optional(),
    path: z.string().min(1).optional(),
    metadata: MetadataSchema,
  })
  .superRefine((value, ctx) => {
    if ((value.kind === 'file' || value.kind === 'directory' || value.kind === 'artifact') && !value.path) {
      ctx.addIssue({
        code: 'custom',
        message: `input.path is required when input.kind is ${value.kind}`,
        path: ['path'],
      })
    }
    if (value.kind === 'inline' && value.value === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'input.value is required when input.kind is inline',
        path: ['value'],
      })
    }
  })
export type PromptEvalInput = z.infer<typeof PromptEvalInputSchema>

export const PromptEvalEvidenceExpectationSchema = z
  .object({
    id: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    quote: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.path && !value.quote && !value.text) {
      ctx.addIssue({
        code: 'custom',
        message: 'evidence expectation must define at least one of path, quote, or text',
      })
    }
  })
export type PromptEvalEvidenceExpectation = z.infer<typeof PromptEvalEvidenceExpectationSchema>

export const PromptEvalFindingExpectationSchema = z
  .object({
    id: z.string().min(1),
    outputId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    severity: z.string().min(1).optional(),
    evidence: z.array(PromptEvalEvidenceExpectationSchema).default(() => []),
    rationale: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (!hasAtLeastOneMatcher(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'finding expectation must define at least one of outputId, title, or text',
      })
    }
  })
export type PromptEvalFindingExpectation = z.infer<typeof PromptEvalFindingExpectationSchema>

export const PromptEvalNegativeExpectationSchema = z
  .object({
    id: z.string().min(1),
    outputId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (!hasAtLeastOneMatcher(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'negative expectation must define at least one of outputId, title, or text',
      })
    }
  })
export type PromptEvalNegativeExpectation = z.infer<typeof PromptEvalNegativeExpectationSchema>

export const PromptEvalExpectationsSchema = z
  .object({
    allowedOutcomes: z.array(z.string().min(1)).default(() => []),
    mustFind: z.array(PromptEvalFindingExpectationSchema).default(() => []),
    mustNotFind: z.array(PromptEvalNegativeExpectationSchema).default(() => []),
    requiredEvidence: z.array(PromptEvalEvidenceExpectationSchema).default(() => []),
    notes: z.array(z.string().min(1)).default(() => []),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>()
    for (const item of [...value.mustFind, ...value.mustNotFind]) {
      if (ids.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate expectation id: ${item.id}`,
        })
      }
      ids.add(item.id)
    }
  })
export type PromptEvalExpectations = z.infer<typeof PromptEvalExpectationsSchema>

export const PromptEvalScorerConfigSchema = z.object({
  id: z.string().min(1),
  weight: z.number().nonnegative().default(1),
  options: MetadataSchema,
})
export type PromptEvalScorerConfig = z.infer<typeof PromptEvalScorerConfigSchema>

export const PromptEvalCaseSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  suite: z.union([z.enum(PROMPT_EVAL_SUITE_VALUES), z.string().min(1)]),
  domain: z.string().min(1),
  role: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).default([]),
  prompt: PromptEvalPromptVersionSchema.optional(),
  input: PromptEvalInputSchema,
  expectations: PromptEvalExpectationsSchema,
  scorers: z.array(PromptEvalScorerConfigSchema).default(() => [{ id: 'deterministic', weight: 1, options: {} }]),
  metadata: MetadataSchema,
})
export type PromptEvalCase = z.infer<typeof PromptEvalCaseSchema>

export const PromptEvalObservedEvidenceSchema = z
  .object({
    path: z.string().min(1).optional(),
    quote: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    metadata: MetadataSchema,
  })
  .catchall(z.unknown())
export type PromptEvalObservedEvidence = z.infer<typeof PromptEvalObservedEvidenceSchema>

export const PromptEvalObservedFindingSchema = z
  .object({
    id: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    severity: z.string().min(1).optional(),
    evidence: z.array(PromptEvalObservedEvidenceSchema).default(() => []),
    metadata: MetadataSchema,
  })
  .catchall(z.unknown())
export type PromptEvalObservedFinding = z.infer<typeof PromptEvalObservedFindingSchema>

export const PromptEvalObservedOutputSchema = z.object({
  outcome: z.string().min(1).optional(),
  findings: z.array(PromptEvalObservedFindingSchema).default(() => []),
  raw: z.unknown().optional(),
  metadata: MetadataSchema,
})
export type PromptEvalObservedOutput = z.infer<typeof PromptEvalObservedOutputSchema>

export const PromptEvalCheckSchema = z.object({
  id: z.string().min(1),
  category: z.enum(PROMPT_EVAL_CHECK_CATEGORY_VALUES),
  status: z.enum(PROMPT_EVAL_CHECK_STATUS_VALUES),
  message: z.string().min(1),
  score: z.number().min(0).max(1),
  weight: z.number().nonnegative().default(1),
  expectationId: z.string().min(1).optional(),
  details: MetadataSchema,
})
export type PromptEvalCheck = z.infer<typeof PromptEvalCheckSchema>

export const PromptEvalAdapterResultSchema = z.object({
  observed: PromptEvalObservedOutputSchema,
  checks: z.array(PromptEvalCheckSchema).default(() => []),
  artifacts: z.record(z.string(), z.string()).default(() => ({})),
  metadata: MetadataSchema,
})
export type PromptEvalAdapterResult = z.infer<typeof PromptEvalAdapterResultSchema>

export const PromptEvalScoreSummarySchema = z.object({
  contract: z.number().min(0).max(1).optional(),
  deterministic: z.number().min(0).max(1).optional(),
  judge: z.number().min(0).max(1).optional(),
  human: z.number().min(0).max(1).optional(),
  total: z.number().min(0).max(1),
})
export type PromptEvalScoreSummary = z.infer<typeof PromptEvalScoreSummarySchema>

export const PromptEvalCaseResultSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  caseId: z.string().min(1),
  suite: z.string().min(1),
  domain: z.string().min(1),
  role: z.string().min(1),
  prompt: PromptEvalPromptVersionSchema.optional(),
  status: z.enum(PROMPT_EVAL_CASE_STATUS_VALUES),
  scores: PromptEvalScoreSummarySchema,
  checks: z.array(PromptEvalCheckSchema),
  observed: PromptEvalObservedOutputSchema.optional(),
  artifacts: z.record(z.string(), z.string()).default(() => ({})),
  createdAt: z.string().datetime(),
  metadata: MetadataSchema,
})
export type PromptEvalCaseResult = z.infer<typeof PromptEvalCaseResultSchema>

export const PromptEvalResultSetSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  results: z.array(PromptEvalCaseResultSchema),
  metadata: MetadataSchema,
})
export type PromptEvalResultSet = z.infer<typeof PromptEvalResultSetSchema>

export const PromptEvalRunManifestSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  createdAt: z.string().datetime(),
  project: z
    .object({
      name: z.string().min(1),
      root: z.string().min(1).optional(),
      gitHead: z.string().min(1).nullable().optional(),
    })
    .optional(),
  suites: z.array(z.string().min(1)),
  caseIds: z.array(z.string().min(1)),
  promptVersions: z.array(PromptEvalPromptVersionSchema).default(() => []),
  baselineRunId: z.string().min(1).optional(),
  metadata: MetadataSchema,
})
export type PromptEvalRunManifest = z.infer<typeof PromptEvalRunManifestSchema>

export const PromptEvalReportSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  createdAt: z.string().datetime(),
  totals: z.object({
    cases: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    passRate: z.number().min(0).max(1),
    averageScore: z.number().min(0).max(1),
  }),
  bySuite: z.record(
    z.string(),
    z.object({
      cases: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      warning: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      passRate: z.number().min(0).max(1),
      averageScore: z.number().min(0).max(1),
    }),
  ),
  regressions: z.array(z.string().min(1)).default(() => []),
  improvements: z.array(z.string().min(1)).default(() => []),
  metadata: MetadataSchema,
})
export type PromptEvalReport = z.infer<typeof PromptEvalReportSchema>
