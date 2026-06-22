#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { lintPlan } = require("./plan-authoring-lint");

function requiredPlan({
  complexity = "feature",
  existingRefs = "None",
  tasks = "- Implement the decided contract.",
  blocking = "None",
  appendix = ""
} = {}) {
  return [
    "# Plan",
    "",
    "## Plan Complexity",
    `- level: ${complexity}`,
    "- reason: test fixture",
    "",
    "## Scope / Non-goals",
    "- Scope is explicit.",
    "",
    "## Requirements Mapping",
    "- Requirement maps to the task.",
    "",
    "## Existing Code Refs",
    existingRefs,
    "",
    "## Contract Decisions",
    "- Contract is decided.",
    "",
    "## Blocking Decisions",
    blocking,
    "",
    "## Implementation Discretion",
    "- Local helper naming follows project conventions.",
    "",
    "## Tasks and Dependencies",
    tasks,
    "",
    "## Tests / Acceptance",
    "- Verify the requirement.",
    "",
    "## Open Questions / Risks",
    "None",
    appendix
  ].filter((line) => line !== "").join("\n");
}

function padToLines(plan, targetLines) {
  const lines = plan.split("\n");
  const headingIndex = lines.findIndex((line) => line === "## Tasks and Dependencies");
  const insertAt = headingIndex + 1;
  while (lines.length < targetLines) {
    lines.splice(insertAt, 0, `- Decision-preserving task note ${lines.length}.`);
  }
  return lines.join("\n");
}

function codes(result) {
  return {
    errors: result.errors.map((item) => item.code),
    warnings: result.warnings.map((item) => item.code)
  };
}

function main() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "plan-authoring-lint-"));
  try {
    fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "src", "example.ts"), [
      "export const first = true;",
      "export function targetSymbol() {",
      "  return true;",
      "}",
      ""
    ].join("\n"));

    const feature180 = lintPlan({
      plan: padToLines(requiredPlan({ complexity: "feature" }), 180),
      projectRoot
    });
    assert.equal(feature180.metrics.total_lines, 180);
    assert.deepEqual(feature180.errors, []);
    assert.deepEqual(feature180.warnings, []);

    const crossFeature450 = lintPlan({
      plan: padToLines(requiredPlan({ complexity: "cross_feature" }), 450),
      projectRoot
    });
    assert.equal(crossFeature450.metrics.total_lines, 450);
    assert(codes(crossFeature450).warnings.includes("line_budget_exceeded"));
    assert.deepEqual(crossFeature450.errors, []);

    const hookPlan = requiredPlan({
      tasks: [
        "- Add the feature.",
        "",
        "```tsx",
        "export function UserCard() {",
        "  const [open, setOpen] = useState(false);",
        "  const onPress = () => setOpen(true);",
        "  return (",
        "    <View>",
        "      <Button onPress={onPress}>Open</Button>",
        "      {open ? <Modal><Text>Hello</Text></Modal> : null}",
        "    </View>",
        "  );",
        "}",
        "export function useUserCard() {",
        "  return useMemo(() => ({ open: true }), []);",
        "}",
        "```"
      ].join("\n")
    });
    const hookResult = lintPlan({ plan: hookPlan, projectRoot });
    assert(codes(hookResult).errors.includes("implementation_code_block"));

    const contractBlocks = requiredPlan({
      appendix: [
        "",
        "## Optional Interface Contract Appendix",
        "```ts",
        "interface Request {",
        "  id: string;",
        "  enabled: boolean;",
        "}",
        "```",
        "```text",
        "src/",
        "├── api.ts",
        "└── types.ts",
        "```",
        "```mermaid",
        "flowchart LR",
        "  A[Caller] --> B[Service]",
        "```"
      ].join("\n")
    });
    const contractResult = lintPlan({
      plan: padToLines(contractBlocks, 120),
      projectRoot
    });
    assert.deepEqual(contractResult.errors, []);
    assert.deepEqual(contractResult.warnings, []);

    const i18nPlan = requiredPlan({
      appendix: [
        "",
        "## i18n translations",
        "```json",
        "{",
        "  \"title\": \"Title\",",
        "  \"subtitle\": \"Subtitle\",",
        "  \"confirm\": \"Confirm\",",
        "  \"cancel\": \"Cancel\",",
        "  \"loading\": \"Loading\",",
        "  \"success\": \"Success\",",
        "  \"failure\": \"Failure\",",
        "  \"retry\": \"Retry\"",
        "}",
        "```"
      ].join("\n")
    });
    assert(codes(lintPlan({ plan: i18nPlan, projectRoot })).errors.includes(
      "implementation_code_block"
    ));

    const compactI18nPlan = requiredPlan({
      appendix: [
        "",
        "## i18n translations",
        "```json",
        "{",
        "  \"title\": \"Title\",",
        "  \"confirm\": \"Confirm\",",
        "  \"cancel\": \"Cancel\",",
        "  \"retry\": \"Retry\"",
        "}",
        "```"
      ].join("\n")
    });
    assert(codes(lintPlan({ plan: compactI18nPlan, projectRoot })).errors.includes(
      "implementation_code_block"
    ));

    const todoBody = lintPlan({
      plan: requiredPlan({
        tasks: "- TODO confirm the handler while implementing."
      }),
      projectRoot
    });
    assert(codes(todoBody).warnings.includes("uncertain_wording_outside_decision_section"));

    const todoBlocking = lintPlan({
      plan: requiredPlan({
        blocking: "- TODO confirm the public contract before coding."
      }),
      projectRoot
    });
    assert(!codes(todoBlocking).warnings.includes("uncertain_wording_outside_decision_section"));

    const missingRef = lintPlan({
      plan: requiredPlan({
        existingRefs: [
          "- path: src/missing.ts",
          "  lines: 1-2",
          "  symbol: missingSymbol",
          "  reason: test"
        ].join("\n")
      }),
      projectRoot
    });
    assert(codes(missingRef).errors.includes("existing_ref_file_missing"));

    const outOfRangeRef = lintPlan({
      plan: requiredPlan({
        existingRefs: [
          "- path: src/example.ts",
          "  lines: 20-30",
          "  symbol: targetSymbol",
          "  reason: test"
        ].join("\n")
      }),
      projectRoot
    });
    assert(codes(outOfRangeRef).errors.includes("existing_ref_lines_out_of_range"));

    const symbolMissingRef = lintPlan({
      plan: requiredPlan({
        existingRefs: [
          "- path: src/example.ts",
          "  lines: 1-4",
          "  symbol: missingSymbol",
          "  reason: test"
        ].join("\n")
      }),
      projectRoot
    });
    assert(codes(symbolMissingRef).errors.includes("existing_ref_symbol_missing"));

    const futureRef = lintPlan({
      plan: requiredPlan({
        existingRefs: [
          "- path: proposed-code/new-component.tsx",
          "  lines: 1-20",
          "  symbol: NewComponent",
          "  reason: future implementation"
        ].join("\n")
      }),
      projectRoot
    });
    assert(codes(futureRef).errors.includes("existing_ref_future_path"));

    const validRef = lintPlan({
      plan: requiredPlan({
        existingRefs: [
          "- path: src/example.ts",
          "  lines: 2-4",
          "  symbol: targetSymbol",
          "  reason: verified integration point"
        ].join("\n")
      }),
      projectRoot
    });
    assert.deepEqual(validRef.errors, []);

    // Complete arrow function (content-based, not length-based) should be rejected
    const arrowPlan = requiredPlan({
      appendix: [
        "",
        "## Implementation Details",
        "```ts",
        "const handleAuth = async (req: Request) => {",
        "  const token = req.headers.authorization;",
        "  if (!token) return unauthorized();",
        "  req.user = await verify(token);",
        "  return next(req);",
        "};",
        "```"
      ].join("\n")
    });
    const arrowResult = lintPlan({ plan: arrowPlan, projectRoot });
    assert(
      codes(arrowResult).errors.includes("implementation_code_block"),
      "complete arrow function should be flagged regardless of line count"
    );
    assert(
      arrowResult.metrics.code_blocks.some((b) => b.kind === "arrow_function_implementation"),
      "arrow function should be classified as arrow_function_implementation"
    );

    // Short complete function (5 lines) should also be rejected
    const shortFuncPlan = requiredPlan({
      appendix: [
        "",
        "## Implementation Details",
        "```ts",
        "function greet(name: string) {",
        "  return `Hello ${name}`;",
        "}",
        "```"
      ].join("\n")
    });
    const shortFuncResult = lintPlan({ plan: shortFuncPlan, projectRoot });
    assert(
      codes(shortFuncResult).errors.includes("implementation_code_block"),
      "short complete function should be flagged regardless of line count"
    );

    // Arrow function with type annotation
    const typedArrowPlan = requiredPlan({
      appendix: [
        "",
        "## Implementation Details",
        "```ts",
        "const add: AddFn = (a: number, b: number) => {",
        "  return a + b;",
        "};",
        "```"
      ].join("\n")
    });
    const typedArrowResult = lintPlan({ plan: typedArrowPlan, projectRoot });
    assert(
      codes(typedArrowResult).errors.includes("implementation_code_block"),
      "arrow function with type annotation should be flagged"
    );

    // Anonymous default export function
    const anonPlan = requiredPlan({
      appendix: [
        "",
        "## Implementation Details",
        "```ts",
        "export default function(req: Request) {",
        "  return handle(req);",
        "}",
        "```"
      ].join("\n")
    });
    const anonResult = lintPlan({ plan: anonPlan, projectRoot });
    assert(
      codes(anonResult).errors.includes("implementation_code_block"),
      "anonymous default export function should be flagged"
    );

    console.log("plan authoring lint tests passed");
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

main();
