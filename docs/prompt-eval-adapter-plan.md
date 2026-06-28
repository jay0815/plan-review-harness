# Prompt Eval Adapter Plan

## 目标

当前仓库先验证 prompt eval 地基；最终把通用核心迁移到 `harness-kit`，再由 plan review 和 `change-assurance` 通过 adapter 接入。核心必须保持项目无关，项目只拥有 case discovery、workflow 执行和输出归一化。

## 目标仓库现状

- `harness-kit`：monorepo，核心包位于 `packages/core`，当前已有 workflow、guardrail、telemetry 等基础能力。它是 prompt eval core 的最终归属。
- `change-assurance`：monorepo，已有 `evals/cases/*/expectations.yaml`、`evals/results/*/eval-result.json` 和 `packages/cli/src/eval-run.ts`。它是首个迁移 adapter 的验证对象。

## 迁移分层

1. **Core 层（迁入 `harness-kit`）**
   - `PromptEvalCase`、`PromptEvalObservedOutput`、`PromptEvalCheck`、`PromptEvalCaseResult`、`PromptEvalRunManifest`、`PromptEvalReport`
   - deterministic scoring、baseline regressions/improvements、result persistence
   - adapter runner：只接受标准 case，返回 observed output 和可选 checks

2. **Project Adapter 层（留在各项目）**
   - 读取项目 case 格式，例如 `change-assurance` 的 `expectations.yaml`
   - 执行项目 workflow，例如 change assurance review run
   - 把项目 artifact 归一化为 `PromptEvalObservedOutput`
   - 把项目特定校验归一化为 `PromptEvalCheck`

3. **CLI 层（按项目保留薄入口）**
   - `harness-kit` 提供通用 `prompt-eval` runner
   - plan review / change-assurance CLI 只负责选择 adapter、case 路径、baseline 和 output dir

## change-assurance Adapter 映射

| 当前字段                                                    | Prompt Eval 映射                                       |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `expected.allowedFinalDecisions`                            | `expectations.allowedOutcomes`                         |
| `expected.mustFind[].id`                                    | `expectations.mustFind[].id`                           |
| `expected.mustFind[].anyTextPatterns`                       | `expectations.mustFind[].text` 或项目 check metadata   |
| `expected.mustFind[].evidencePaths`                         | `expectations.mustFind[].evidence[].path`              |
| `expected.mustFind[].minImpact` / `sourceStage`             | adapter 生成 `PromptEvalCheck`                         |
| `expected.mustNotFind[].mergeBlocking`                      | adapter 生成禁止 unsupported blocker 的 contract check |
| `expected.coverage.requiredAreas`                           | adapter 生成 coverage contract check                   |
| `expected.verification.expectedFailedCommands`              | adapter 生成 verification contract check               |
| `.change-assurance/runs/*/ledgers/issue-ledger.json`        | `observed.findings`                                    |
| `.change-assurance/runs/*/report/review-report.json`        | `observed.outcome` 和 report artifact                  |
| `.change-assurance/runs/*/verification/verification-ledger` | project checks                                         |

## harness-kit 落点

优先迁到 `packages/core/src/prompt-eval/`，并从 `@harness-kit/core` 导出。迁移时需要做一个明确决定：

- 如果 `harness-kit` 接受 Zod，直接搬迁当前 schema。
- 如果 `harness-kit` 继续以 TypeBox 为主，需要先把 schema port 到 TypeBox，再保留相同 TypeScript 类型和 JSON artifact 形状。

不要在同一核心包里长期混用两套 schema 风格，除非有清晰的边界和测试。

## 推荐步骤

1. 在当前仓库稳定 `src/prompt-eval/` 的 artifact 形状和 report 语义。
2. 在 `change-assurance` 新增只读 adapter spike：读取现有 YAML case，输出 `PromptEvalCase`。
3. 用现有 `evals/results/*/eval-result.json` 回填 baseline，验证 regressions/improvements 语义。
4. 将 prompt eval core 迁入 `harness-kit/packages/core`，保留当前测试作为迁移测试。
5. plan review 和 change-assurance 删除重复 scoring 逻辑，只保留 adapter 和 project CLI。

## 不做

- 不把 plan-review runtime 或 `model-role-calibration/` 历史脚本迁入 prompt eval core。
- 不要求所有项目改成同一种 case 文件格式；核心只要求最终转换成 `PromptEvalCase`。
- 不把 judge model 和人工评分混入第一阶段。先稳定 deterministic contract，再扩展 judge/human 类别。
