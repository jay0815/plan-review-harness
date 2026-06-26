# Workspace Review Regression Notes

本文件记录真实 workspace review 的稳定性样本，用于观察 reviewer 噪音是否被 Fact Check / Synthesis 正确收敛。这里不是评分表，也不是 prompt 设计文档；只记录可复查的 run、已观察到的误判类型和后续判断规则。

## 当前基准样本

### workspace-review-20260625T132529Z

- 日期：2026-06-25
- 目的：验证 lint / manifest / read-scope 证据链修复后的真实 CC review 收敛效果。
- 结果：通过观察，作为当前稳定 checkpoint。

关键观察：

- `plan-authoring-lint.json`
  - `existing_code_ref_count` 已不再为 0。
  - `现有代码映射` 可被识别并计数。
  - inline refs、目录 refs、line refs 与 `review-plan-refs.json` 对齐。
- `review-plan-refs.json`
  - 文件 refs / 目录 refs / skipped refs 已分离。
  - `refs_scoped_to_existing_code_refs_section: true`。
- Fact Check read-scope
  - 可读取 reviewer evidence 明确引用的工程文件。
  - 可补充读取 Plan `Existing Code Refs` / `现有代码映射` 章节列出的工程文件。
  - 不读取 Plan 其他章节路径，也不从 `why_it_matters` 等影响描述扩展证据。
- 最终结论
  - `scene/customParam` 仍被 reviewer 提到，但被 Fact Check / Synthesis 降权，没有进入 `revision_instructions`。
  - Mine 登录态、自动化测试/CI 前提没有污染最终修订结论。
  - reviewer 原始输出仍有噪音，但最终裁决链路能收敛。

## 后续观察规则

每次真实 CC review 后追加一条记录，重点只看最终结果：

- 最终 `revision_instructions` 是否合理。
- Fact Check 是否有足够证据降权或反证 reviewer 问题。
- 是否有新的误判类型进入最终共识或修订指令。
- 如果噪音只停留在 reviewer 原始输出，且被 Fact Check / Synthesis 压住，暂不修 prompt。

建议记录格式：

```text
- YYYY-MM-DD workspace-review-<run-id>: pass/fail；新误判：无/有；是否进入 revision_instructions：否/是；备注：...
```

## 待观察问题

- Fact Check read-scope 是否仍会因为缺少现有工程文件而把可反证问题标为 `unverifiable`。
- Synthesis 是否持续遵守：低证据、已降权或反证的问题不进入 `revision_instructions`。
- Execution Reviewer 是否继续把实现阶段细节标为 blocking；只要最终被降权，暂不处理。
