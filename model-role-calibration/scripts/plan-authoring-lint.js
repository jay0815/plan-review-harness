#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  parseArgs,
  requireArg
} = require("./lib");

const LINE_BUDGETS = {
  single_file: 50,
  feature: 200,
  cross_feature: 400,
  architecture: 600
};

const REQUIRED_SECTION_GROUPS = [
  { name: "scope_non_goals", patterns: [/\bscope\b/i, /\bnon[- ]?goals?\b/i] },
  { name: "requirements_mapping", patterns: [/\brequirements?\s+mapping\b/i, /需求映射/] },
  { name: "existing_code_refs", patterns: [/\bexisting\s+code\s+refs?\b/i, /现有代码引用/] },
  { name: "contract_decisions", patterns: [/\bcontract\s+decisions?\b/i, /契约决策/] },
  { name: "blocking_decisions", patterns: [/\bblocking\s+decisions?\b/i, /阻塞决策/] },
  { name: "implementation_discretion", patterns: [/\bimplementation\s+discretion\b/i, /实现自由|实现阶段决定/] },
  { name: "tasks_dependencies", patterns: [/\btasks?\b.*\bdependencies\b/i, /任务.*依赖/] },
  { name: "tests_acceptance", patterns: [/\btests?\b.*\bacceptance\b/i, /测试.*验收/] },
  { name: "open_questions_risks", patterns: [/\bopen\s+questions?\b/i, /\brisks?\b/i, /待确认|风险/] }
];

const UNCERTAIN_PATTERN = /(可能|后续|临时|TODO|需与[^，。；\n]*确认|当前按[^，。；\n]*处理)/gi;
const UNCERTAINTY_ALLOWED_SECTIONS = [
  /blocking\s+decisions?/i,
  /open\s+questions?/i,
  /risks?/i,
  /non[- ]?blocking\s+questions?/i,
  /阻塞决策/,
  /待确认/,
  /风险/,
  /非阻塞问题/
];

function issue(code, message, details = {}) {
  return {
    code,
    message,
    ...details
  };
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function parseSections(plan) {
  const lines = String(plan).split("\n");
  const sections = [];
  let current = {
    title: "__root__",
    level: 0,
    start_line: 1,
    end_line: lines.length,
    lines: []
  };
  sections.push(current);
  lines.forEach((line, index) => {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      current.end_line = index;
      current = {
        title: heading[2].trim(),
        level: heading[1].length,
        start_line: index + 1,
        end_line: lines.length,
        lines: []
      };
      sections.push(current);
    } else {
      current.lines.push({
        number: index + 1,
        text: line
      });
    }
  });
  return sections;
}

function sectionMatches(section, patterns) {
  return patterns.some((pattern) => pattern.test(section.title));
}

function parseExplicitComplexity(plan, sections) {
  const jsonMatch = String(plan).match(
    /"plan_complexity"\s*:\s*\{[\s\S]{0,300}?"level"\s*:\s*"(single_file|feature|cross_feature|architecture)"/i
  );
  if (jsonMatch) {
    return {
      level: jsonMatch[1].toLowerCase(),
      reason: "计划中的 plan_complexity.level",
      source: "explicit"
    };
  }
  const section = sections.find((item) => /plan\s+complexity|计划复杂度/i.test(item.title));
  if (section) {
    const body = section.lines.map((item) => item.text).join("\n");
    const match = body.match(/\b(single_file|feature|cross_feature|architecture)\b/i);
    if (match) {
      return {
        level: match[1].toLowerCase(),
        reason: `章节 ${section.title}`,
        source: "explicit"
      };
    }
  }
  const inlineMatch = String(plan).match(
    /(?:plan[_ ]complexity|complexity|计划复杂度)\s*[:：]\s*(single_file|feature|cross_feature|architecture)\b/i
  );
  if (inlineMatch) {
    return {
      level: inlineMatch[1].toLowerCase(),
      reason: "计划中的复杂度标记",
      source: "explicit"
    };
  }
  return null;
}

function existingCodeRefsSection(sections) {
  return sections.find((section) => (
    /existing\s+code\s+refs?|现有代码引用/i.test(section.title)
  ));
}

function parseExistingCodeRefs(sections) {
  const section = existingCodeRefsSection(sections);
  if (!section) {
    return [];
  }
  const refs = [];
  let current = null;
  for (const entry of section.lines) {
    const pathMatch = entry.text.match(/^\s*-\s*path\s*:\s*(.+?)\s*$/i);
    if (pathMatch) {
      current = {
        path: pathMatch[1].trim().replace(/^`|`$/g, ""),
        path_line: entry.number,
        lines: null,
        symbol: null,
        reason: null
      };
      refs.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    const field = entry.text.match(/^\s*(?:-\s*)?(lines|symbol|reason)\s*:\s*(.*?)\s*$/i);
    if (field) {
      current[field[1].toLowerCase()] = field[2].trim().replace(/^`|`$/g, "");
    }
  }
  return refs;
}

function inferComplexity(plan, refs) {
  const refCount = refs.length;
  const text = String(plan);
  const sectionCount = (text.match(/^#{1,6}\s+/gm) || []).length;
  const mermaidCount = (text.match(/```mermaid/gi) || []).length;
  const codeBlockCount = (text.match(/```[^\n]*\n/g) || []).length;
  const totalLines = text.split("\n").length;
  const hasMermaid = mermaidCount > 0;
  const hasDecisionStructure = /decision|route|分支|决策|状态转换/i.test(text);
  const hasFlowDiagram = hasMermaid || /flowchart|sequenceDiagram|stateDiagram|graph\s+[A-Z]/i.test(text);

  if (
    refCount >= 16 ||
    sectionCount >= 13 ||
    totalLines >= 500 ||
    /system boundary|public contract|architecture decision|系统边界|公共契约|架构决策/i.test(text)
  ) {
    return {
      level: "architecture",
      reason: refCount >= 16
        ? `根据现有代码引用数量（${refCount}）推断`
        : `根据计划结构推断：${sectionCount} 个章节，${totalLines} 行`,
      source: "inferred"
    };
  }
  if (
    refCount >= 8 ||
    sectionCount >= 12 ||
    (hasFlowDiagram && totalLines >= 200) ||
    /cross[- ]feature|跨功能|跨模块|多个团队|multi[- ]team/i.test(text)
  ) {
    return {
      level: "cross_feature",
      reason: refCount >= 8
        ? `根据现有代码引用数量（${refCount}）推断`
        : `根据计划结构推断：${sectionCount} 个章节，${totalLines} 行，${mermaidCount} 个图表`,
      source: "inferred"
    };
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
      level: "feature",
      reason: refCount >= 2
        ? `根据现有代码引用数量（${refCount}）推断`
        : `根据计划结构推断：${sectionCount} 个章节，${totalLines} 行`,
      source: "inferred"
    };
  }
  return {
    level: "single_file",
    reason: `计划较短（${totalLines} 行，${sectionCount} 个章节），无跨文件证据`,
    source: "inferred"
  };
}

function parseCodeBlocks(plan) {
  const blocks = [];
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(String(plan))) !== null) {
    const code = match[2];
    blocks.push({
      index: blocks.length + 1,
      language: String(match[1] || "").trim().split(/\s+/)[0].toLowerCase(),
      code,
      start_line: lineNumberAt(plan, match.index),
      line_count: code.endsWith("\n")
        ? code.split("\n").length - 1
        : code.split("\n").length,
      char_count: code.length
    });
  }
  return blocks;
}

function precedingHeading(sections, line) {
  return sections
    .filter((section) => section.start_line <= line)
    .sort((a, b) => b.start_line - a.start_line)[0]?.title || "";
}

function stringLeafCount(value) {
  if (typeof value === "string") {
    return 1;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + stringLeafCount(item), 0);
  }
  if (value && typeof value === "object") {
    return Object.values(value).reduce((sum, item) => sum + stringLeafCount(item), 0);
  }
  return 0;
}

function classifyCodeBlock(block, sectionTitle) {
  const language = block.language;
  const code = block.code;
  const lines = block.line_count;
  if (language === "mermaid") {
    return {
      kind: "mermaid",
      allowed: lines <= 30,
      limit: 30
    };
  }
  const nonEmpty = code.split("\n").map((line) => line.trim()).filter(Boolean);
  const looksLikeTree =
    lines <= 20 &&
    nonEmpty.length > 0 &&
    nonEmpty.every((line) => (
      /^[│├└─\s]+[A-Za-z0-9_.@/-]+$/.test(line) ||
      /^[A-Za-z0-9_.@-]+\/?$/.test(line) ||
      /^[-*]\s+[A-Za-z0-9_.@/-]+$/.test(line)
    ));
  if (looksLikeTree) {
    return {
      kind: "file_tree",
      allowed: true,
      limit: 20
    };
  }
  const interfaceOnly =
    lines <= 10 &&
    /\b(interface|type)\b/.test(code) &&
    !/\bfunction\b|=>|\breturn\b|<[A-Z][A-Za-z0-9]*/.test(code);
  if (interfaceOnly) {
    return {
      kind: "interface_signature",
      allowed: true,
      limit: 10
    };
  }
  if (language === "json" && /i18n|translation|locale|国际化|文案/i.test(sectionTitle)) {
    try {
      const parsed = JSON.parse(code);
      if (lines >= 6 && stringLeafCount(parsed) >= 4) {
        return {
          kind: "complete_i18n_json",
          allowed: false,
          reliable: true
        };
      }
    } catch {
      // JSON syntax is outside this linter's responsibility.
    }
  }
  const hasTestImplementation =
    /\b(describe|test|it)\s*\(|\bexpect\s*\(/.test(code) &&
    (lines > 10 || (code.match(/\bexpect\s*\(/g) || []).length >= 3);
  if (hasTestImplementation) {
    return {
      kind: "test_implementation",
      allowed: false,
      reliable: true
    };
  }
  const hasHookOrComponent =
    /\bfunction\s+use[A-Z]\w*\s*\(|\bconst\s+use[A-Z]\w*\s*=/.test(code) ||
    /\bfunction\s+[A-Z]\w*\s*\(|\bconst\s+[A-Z]\w*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.test(code);
  const hasJsx = /return\s*\(\s*</s.test(code) || /<[A-Z][A-Za-z0-9]*(?:\s|>)/.test(code);
  if ((hasHookOrComponent && lines > 10) || (hasJsx && lines > 10)) {
    return {
      kind: hasJsx ? "jsx_implementation" : "hook_or_component_implementation",
      allowed: false,
      reliable: true
    };
  }
  const hasCompleteFunction =
    (
      /\b(?:async\s+)?function\s+\w*\s*\([^)]*\)\s*(?::\s*\w[^\s{]*)?\s*\{/.test(code) ||
      /\bexport\s+default\s+(?:async\s+)?function\s*\([^)]*\)\s*\{/.test(code)
    ) &&
    /^\}/m.test(code);
  if (hasCompleteFunction) {
    return {
      kind: "function_implementation",
      allowed: false,
      reliable: true
    };
  }
  const arrowSignature = /(?:const|let|var)\s+\w+(?:\s*:\s*\w[^\s=]*)?\s*=\s*(?:async\s*)?/;
  const arrowGeneric = /<[^>]*>\s*\([^)]*\)\s*(?::\s*\w[^\s{]*)?\s*=>\s*\{/;
  const arrowPlain = /\([^)]*\)\s*(?::\s*\w[^\s{]*)?\s*=>\s*\{/;
  const arrowSingleParam = /\w+\s*=>\s*\{/;
  const hasArrowBlockBody =
    arrowSignature.source &&
    (
      new RegExp(arrowSignature.source + arrowGeneric.source).test(code) ||
      new RegExp(arrowSignature.source + arrowPlain.source).test(code) ||
      new RegExp(arrowSignature.source + arrowSingleParam.source).test(code)
    ) &&
    /^\};?\s*$/m.test(code);
  const hasArrowExpressionBody =
    /(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:<[^>]*>)?\([^)]*\)\s*=>\s*\n/.test(code) &&
    /;\s*$/m.test(code);
  if (hasArrowBlockBody || hasArrowExpressionBody) {
    return {
      kind: "arrow_function_implementation",
      allowed: false,
      reliable: true
    };
  }
  return {
    kind: "unclassified",
    allowed: lines <= 10,
    reliable: false,
    limit: 10
  };
}

function validateExistingCodeRefs(refs, projectRoot, errors) {
  const absoluteRoot = path.resolve(projectRoot);
  for (const ref of refs) {
    if (!ref.path || !ref.lines || !ref.symbol || !ref.reason) {
      errors.push(issue(
        "existing_ref_incomplete",
        "Existing Code Ref 必须包含 path、lines、symbol 和 reason",
        { line: ref.path_line, path: ref.path || null }
      ));
      continue;
    }
    if (
      path.isAbsolute(ref.path) ||
      ref.path.split(/[\\/]/).includes("..")
    ) {
      errors.push(issue(
        "existing_ref_outside_project",
        "Existing Code Ref 必须是 project root 内的相对路径",
        { line: ref.path_line, path: ref.path }
      ));
      continue;
    }
    if (
      /^proposed-code\//.test(ref.path) ||
      /(?:^|\/)(?:future|proposed|draft)(?:-code)?(?:\/|$)/i.test(ref.path)
    ) {
      errors.push(issue(
        "existing_ref_future_path",
        "未来文件或 proposed-code 不能作为 Existing Code Ref",
        { line: ref.path_line, path: ref.path }
      ));
      continue;
    }
    const absolute = path.resolve(absoluteRoot, ref.path);
    const relative = path.relative(absoluteRoot, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      errors.push(issue(
        "existing_ref_outside_project",
        "Existing Code Ref 超出 project root",
        { line: ref.path_line, path: ref.path }
      ));
      continue;
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      errors.push(issue(
        "existing_ref_file_missing",
        "Existing Code Ref 文件不存在",
        { line: ref.path_line, path: ref.path }
      ));
      continue;
    }
    const lineMatch = ref.lines.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!lineMatch) {
      errors.push(issue(
        "existing_ref_lines_invalid",
        "Existing Code Ref lines 必须是 N 或 N-M",
        { line: ref.path_line, path: ref.path, lines: ref.lines }
      ));
      continue;
    }
    const start = Number(lineMatch[1]);
    const end = Number(lineMatch[2] || lineMatch[1]);
    const fileLines = fs.readFileSync(absolute, "utf8").split("\n");
    if (start < 1 || end < start || end > fileLines.length) {
      errors.push(issue(
        "existing_ref_lines_out_of_range",
        "Existing Code Ref 行号超出文件范围",
        {
          line: ref.path_line,
          path: ref.path,
          lines: ref.lines,
          file_lines: fileLines.length
        }
      ));
      continue;
    }
    const excerpt = fileLines.slice(start - 1, end).join("\n");
    if (!excerpt.includes(ref.symbol)) {
      errors.push(issue(
        "existing_ref_symbol_missing",
        "Existing Code Ref 的 symbol 不在指定行号范围内",
        {
          line: ref.path_line,
          path: ref.path,
          lines: ref.lines,
          symbol: ref.symbol
        }
      ));
    }
  }
}

function lintPlan({ plan, projectRoot }) {
  const text = String(plan);
  const sections = parseSections(text);
  const refs = parseExistingCodeRefs(sections);
  const complexity = parseExplicitComplexity(text, sections) || inferComplexity(text, refs);
  const totalLines = text.split("\n").length;
  const lineBudget = LINE_BUDGETS[complexity.level];
  const codeBlocks = parseCodeBlocks(text);
  const maxCodeBlocks = Math.ceil(totalLines / 100) * 2;
  const errors = [];
  const warnings = [];

  for (const group of REQUIRED_SECTION_GROUPS) {
    if (!sections.some((section) => sectionMatches(section, group.patterns))) {
      errors.push(issue(
        "required_section_missing",
        `缺少计划必备内容：${group.name}`,
        { section: group.name }
      ));
    }
  }

  let implementationCodeBlocks = 0;
  let implementationCodeLines = 0;
  const codeBlockMetrics = codeBlocks.map((block) => {
    const sectionTitle = precedingHeading(sections, block.start_line);
    const classification = classifyCodeBlock(block, sectionTitle);
    if (!classification.allowed && classification.reliable) {
      implementationCodeBlocks += 1;
      implementationCodeLines += block.line_count;
      errors.push(issue(
        "implementation_code_block",
        `Plan 包含可可靠识别的完整实现型代码块：${classification.kind}`,
        {
          block: block.index,
          line: block.start_line,
          language: block.language || null,
          line_count: block.line_count,
          kind: classification.kind
        }
      ));
    } else if (!classification.allowed) {
      warnings.push(issue(
        "large_unclassified_code_block",
        "存在较长代码块，无法可靠判断是否为实现草案；请确认其只表达必要契约",
        {
          block: block.index,
          line: block.start_line,
          language: block.language || null,
          line_count: block.line_count
        }
      ));
    }
    return {
      index: block.index,
      line: block.start_line,
      language: block.language || null,
      line_count: block.line_count,
      kind: classification.kind,
      allowed: classification.allowed
    };
  });

  if (codeBlocks.length > maxCodeBlocks) {
    errors.push(issue(
      "code_block_budget_exceeded",
      "代码块数量超过每 100 行最多两个的预算",
      {
        actual: codeBlocks.length,
        maximum: maxCodeBlocks
      }
    ));
  }

  const lineBudgetExceeded = totalLines > lineBudget;
  if (lineBudgetExceeded) {
    warnings.push(issue(
      "line_budget_exceeded",
      `计划行数超过 ${complexity.level} 预算`,
      {
        actual: totalLines,
        budget: lineBudget,
        complexity: complexity.level
      }
    ));
    if (implementationCodeBlocks > 0) {
      errors.push(issue(
        "line_budget_with_implementation_bloat",
        "计划同时超过行数预算并包含完整实现型代码块",
        {
          actual_lines: totalLines,
          budget: lineBudget,
          implementation_code_blocks: implementationCodeBlocks
        }
      ));
    }
  }

  for (const section of sections) {
    const allowed = UNCERTAINTY_ALLOWED_SECTIONS.some((pattern) => pattern.test(section.title));
    if (allowed) {
      continue;
    }
    for (const line of section.lines) {
      const matches = [...line.text.matchAll(UNCERTAIN_PATTERN)];
      for (const match of matches) {
        warnings.push(issue(
          "uncertain_wording_outside_decision_section",
          `待确认措辞“${match[0]}”不在允许章节中`,
          {
            line: line.number,
            section: section.title
          }
        ));
      }
    }
  }

  validateExistingCodeRefs(refs, projectRoot, errors);

  return {
    complexity,
    budgets: {
      line_budget: lineBudget,
      max_code_blocks: maxCodeBlocks,
      allowed_code_block_shapes: {
        interface_signature_lines: 10,
        data_flow_or_mermaid_lines: 30,
        file_tree_lines: 20
      }
    },
    metrics: {
      total_lines: totalLines,
      total_chars: text.length,
      section_count: Math.max(0, sections.length - 1),
      existing_code_ref_count: refs.length,
      code_block_count: codeBlocks.length,
      implementation_code_blocks: implementationCodeBlocks,
      implementation_code_lines: implementationCodeLines,
      line_budget_exceeded: lineBudgetExceeded,
      code_blocks: codeBlockMetrics
    },
    errors,
    warnings
  };
}

function main() {
  const args = parseArgs(process.argv);
  const planFile = path.resolve(requireArg(args, "plan"));
  const projectRoot = path.resolve(requireArg(args, "project-root"));
  if (!fs.existsSync(planFile) || !fs.statSync(planFile).isFile()) {
    throw new Error(`Plan file does not exist: ${planFile}`);
  }
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root does not exist: ${projectRoot}`);
  }
  const result = lintPlan({
    plan: fs.readFileSync(planFile, "utf8"),
    projectRoot
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.errors.length) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 2;
  }
}

module.exports = {
  LINE_BUDGETS,
  lintPlan,
  parseSections,
  parseExistingCodeRefs,
  parseCodeBlocks,
  classifyCodeBlock
};
