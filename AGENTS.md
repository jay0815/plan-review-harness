# Repository Guidelines

Plan Review Harness 是一个用于编排 plan review workflow 的 TypeScript runtime spike。维护目标是让 workflow、artifact 和状态迁移保持可追溯、可验证，而不是依赖模型凭空补全流程或事实。

## 事实来源

- `package.json` 是包管理器和项目命令的唯一事实来源。运行安装、测试、类型检查或 CLI 前，先读取 `packageManager` 和 `scripts`。
- `tsconfig.json`、`tsconfig.build.json`、`vite.config.ts`、`vitest.config.ts` 定义根 TypeScript、构建和测试行为；`model-role-calibration/tsconfig.json` 定义校准工具链类型检查行为。不要假设存在未声明的命令。
- `src/schemas/` 中的 Zod schema 是 artifact 与状态结构的契约。修改数据结构时必须同步更新 schema 和测试。
- 命令输出、Git 状态、仓库文件和测试结果才是事实。无法确认的内容必须标记为假设、推断或待确认项。

## 架构边界

- `src/cli/`：`plan-review` 命令入口、参数解析和用户可见输出。
- `src/graph/`：LangGraph workflow runtime、节点编排和流程状态推进。
- `src/workers/`：agent worker adapter；mock adapter 只能读取 fixture，不应访问网络或真实 LLM API。
- `src/artifacts/`、`src/state/`：artifact 路径、哈希、状态读写和持久化规则。
- `src/prompt-eval/`：跨项目 prompt 评估契约、确定性评分、文件型 dry-run 和 report 持久化；保持项目无关，后续迁移到 `harness-kit`。
- `fixtures/`：示例需求、计划和 mock worker 输出。
- `tests/unit/`：模块级行为测试；`tests/integration/`：CLI、workflow 和 artifact 合同测试。
- `model-role-calibration/`：校准工具链。源码位于 `scripts/**/*.ts`，package scripts 通过 `node --import tsx` 直接执行 TS；Claude Code 分发包会在打包时临时编译自包含 JS。
- `runs/`：生成的运行产物。除非用户明确要求更新样例输出，不要手动编辑其中 artifact。

## 不可突破的规则

- 不要绕过 Harness runtime 或 schema 手写正式 workflow 数据。
- 修改 workflow、artifact、schema 或状态迁移时，必须保持产物可追溯，并补充或更新集成测试。
- “计划执行”或“建议执行”的命令不能当作已通过验证；只有实际执行并成功的命令可作为验证结果。
- 评估问题或审查结论时区分 Observed（直接事实）、Derived（基于事实的推断）和 Hypothesis（未验证假设）。
- 当实现、测试、fixture 或生成 artifact 互相冲突且影响正确性时，先指出冲突；不能静默选择一边。

## 工作方式

编码前先回答三件事：这是真实问题吗？有没有更简单方案？这个改动会破坏什么？优先实现最小但完整、可测试的方案，不为假设中的未来需求提前扩展。确定性逻辑应放进 TypeScript 实现和 schema 校验，不依赖 prompt 约束。

### 完成后文档更新

- 更新 `docs/backlog.md`（移动到"已完成"，加日期）
- 更新 `docs/roadmap.md`（如有进度变化）
- **强制检查 `docs/context.md`**：
  - "当前状态"是否仍准确？
  - "下一步"是否仍有效？
  - "阻塞项"是否需要更新？

### context.md 维护规则

- 每次迭代开始时：更新"本轮目标"和"当前状态"
- 每次迭代结束时：更新"当前状态"、"下一步"和"阻塞项"
- 发现信息过时时：立即更新，不要等到迭代结束
- "已完成"列表超过 10 条时：归档旧项，只保留最近 5 条

涉及行为变更时，优先按 TDD 推进：先写能失败的测试，再写最小实现，通过后再重构。文档或纯配置修改可不强制 TDD，但仍需说明未运行测试的原因。

## 常用命令

```bash
pnpm build
pnpm test
pnpm calibration:test
pnpm calibration:typecheck
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm plan-review -- start --requirement fixtures/sample-requirement.md --plan fixtures/sample-plan.md
pnpm plan-review -- start --requirement fixtures/sample-requirement.md --plan fixtures/sample-plan.md --run-dir /tmp/plan-runs
pnpm plan-review -- prompt-eval --cases evals/cases --observed-dir evals/observed --output-dir runs/prompt-eval/eval-1
```

- `pnpm build`：使用 Vite 构建 ESM 输出，并用 TypeScript 生成声明文件。
- `pnpm test`：运行核心 TypeScript harness 的 Vitest 测试套件。
- `pnpm calibration:test`：先类型检查校准工具链，再通过 TS runner 运行校准和回归脚本。
- `pnpm calibration:typecheck`：检查 `model-role-calibration/` 的 TypeScript 源码。
- `pnpm typecheck`：执行 `tsc --noEmit`。
- `pnpm lint`：使用根级 `.oxlintrc.json` 检查 `src/`、`tests/` 和配置文件，禁用 nested config lookup。
- `pnpm fmt:check`：使用 oxfmt 检查源文件、文档、fixtures 和配置格式。
- `pnpm plan-review -- start ...`：使用 mock workers 运行 harness 并写入 artifacts。
- `pnpm plan-review -- prompt-eval ...`：从 JSON case 和 observed output 文件运行 prompt eval dry-run，并写入 manifest、results 和 report。

## 编码与命名

使用 strict TypeScript、NodeNext ESM 和显式 `.js` 相对导入。沿用 oxfmt 配置：单引号、无分号、两空格缩进、120 字符宽度。类和 schema 使用 PascalCase，函数与变量使用 camelCase，fixture JSON 使用 kebab-case 或点分命名，例如 `review.architecture.json`。

## Commit 与 Pull Request

Git 历史使用简短祈使句提交标题，例如 `Tighten model runner typing` 或 `Add regression artifact validation`。PR 需说明 workflow 影响、列出已运行验证命令，并标注是否改变 schema、fixtures 或生成 artifact。
