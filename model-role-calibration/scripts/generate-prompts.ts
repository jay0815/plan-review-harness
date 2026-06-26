#!/usr/bin/env node

import fs = require('node:fs')
import path = require('node:path')

type ArgValue = string | true | undefined
type ParsedArgs = Record<string, ArgValue>

interface GeneratePromptsOptions {
  run: string
  caseId: string
  probes: string[]
  force?: boolean
}

interface GeneratedPrompt {
  probe: string
  file: string
}

interface GeneratePromptsResult {
  promptDir: string
  prompts: GeneratedPrompt[]
}

const {
  ROOT,
  parseArgs,
  requireArg,
  assertSafeCaseId,
  assertProbe,
  ensureDir,
  readText,
  writeFileNew,
  writeGenerated,
  loadCaseInput,
  timestamp,
} = require('./lib') as {
  ROOT: string
  parseArgs(argv: string[]): ParsedArgs
  requireArg(args: ParsedArgs, name: string): string
  assertSafeCaseId(caseId: string): void
  assertProbe(probe: string): void
  ensureDir(dir: string): void
  readText(file: string): string
  writeFileNew(file: string, content: string): void
  writeGenerated(file: string, content: string): void
  loadCaseInput(caseId: string, probe: string): string
  timestamp(): string
}

export function uniqueRunId(base: string): string {
  let run = base
  let index = 2
  while (fs.existsSync(path.join(ROOT, 'runs', run))) {
    run = `${base}-${index}`
    index += 1
  }
  return run
}

export function generatePrompts({ run, caseId, probes, force = false }: GeneratePromptsOptions): GeneratePromptsResult {
  assertSafeCaseId(caseId)
  probes.forEach(assertProbe)

  const promptDir = path.join(ROOT, 'runs', run, caseId, 'prompts')
  ensureDir(promptDir)

  for (const probe of probes) {
    const input = loadCaseInput(caseId, probe)
    const templateFile = path.join(ROOT, 'prompts', `probe-${probe}.md`)
    if (!fs.existsSync(templateFile)) {
      throw new Error(`Missing probe template: ${templateFile}`)
    }
    const template = readText(templateFile)
    const output = template.replace('{{INPUT}}', input)
    const promptFile = path.join(promptDir, `${probe}.md`)
    if (force) {
      writeGenerated(promptFile, output)
    } else {
      writeFileNew(promptFile, output)
    }
  }

  return {
    promptDir,
    prompts: probes.map((probe) => ({
      probe,
      file: path.join(promptDir, `${probe}.md`),
    })),
  }
}

function parseProbes(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function main(): void {
  const args = parseArgs(process.argv)
  const caseId = requireArg(args, 'case')
  const probes = parseProbes(requireArg(args, 'probes'))
  const run = args.run && args.run !== true ? String(args.run) : uniqueRunId(timestamp())
  const generated = generatePrompts({ run, caseId, probes })

  console.log(`Run ID: ${run}`)
  console.log(`Generated prompts: ${path.relative(path.resolve(ROOT, '..'), generated.promptDir)}`)
}

if (require.main === module) {
  main()
}
