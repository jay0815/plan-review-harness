# CLAUDE.md 计划生成提示词

下面内容可以直接写入业务项目的 `CLAUDE.md`，用于约束 Claude Code 在进入 plan / planning 阶段时生成可审查、可回查的计划。

```markdown
## Plan Authoring Contract

当你需要产出实施计划时，必须使用“主计划 + existing code refs + proposed code artifacts”的组合格式。目标是让后续 plan review / fact check 能通过文件路径和行号精确回查事实，避免把长代码块压缩成不可验证摘要。

### 1. 主计划

主计划只写设计意图、流程、任务、风险、验收和执行顺序。不要在主计划里内嵌大段源码。

主计划中引用代码事实时必须使用可定位引用：

- 已存在代码：引用现有工程文件路径和行号，例如 `packages/app/src/foo.ts:12-48`。
- 准备新增或大段修改的代码：引用 proposed artifact 路径和行号，例如 `requirements/123456/proposed-code/foo.ts:1-80`。

禁止用“见上方代码”“如下实现”“某文件附近逻辑”作为事实依据。

### 2. Existing Code Refs

主计划必须包含 `## Existing Code Refs` 小节，列出所有依赖的现有代码事实。

每条引用必须包含：

- `path`: 相对项目根目录的文件路径。
- `lines`: 起止行号。
- `symbol`: 涉及的函数、组件、类型或配置名。
- `reason`: 该引用支撑计划中的哪个事实。

格式示例：

```text
- path: packages/app/src/screens/credit/ocr/actionBar.tsx
  lines: 62-132
  symbol: ActionBar OCR success branches
  reason: OCR 成功后当前直接进入 CreditResult，是新增授权路由的接入点。
```

如果无法确认行号，先读取文件确认行号后再写计划；不要猜测。

### 3. Proposed Code Artifacts

凡是计划中包含准备新增的文件、大段修改片段、关键类型、关键控制流、关键测试用例，都不要直接塞进主计划正文。

必须把这些内容拆到单独 artifact 文件中，例如：

```text
requirements/123456/proposed-code/request-credit-authorization.ts
requirements/123456/proposed-code/screens-credit-ocr-utils-routeDecision.ts
requirements/123456/proposed-code/creditAuthorization.test.ts
```

主计划只引用 artifact 路径和行号：

```text
- Proposed route decision implementation: requirements/123456/proposed-code/screens-credit-ocr-utils-routeDecision.ts:1-58
- Proposed unit tests: requirements/123456/proposed-code/creditAuthorization.test.ts:1-120
```

artifact 文件必须尽量保持可读源码形态，尤其保留：

- import / export
- type / interface 所属文件
- 函数签名
- 控制流分支
- 错误处理
- 测试断言
- 外部依赖调用点

### 4. 审查友好约束

计划中的每个关键结论都应能回溯到以下之一：

- 需求文档的具体章节或行号。
- `Existing Code Refs` 中的现有代码路径和行号。
- `Proposed Code Artifacts` 中的 artifact 路径和行号。

如果某个事实尚未确认，必须写入 `Open Questions` 或 `Assumptions`，不要把它写成已确认事实。

### 5. 推荐计划结构

```text
# Plan

## Goal
## Scope
## Requirements Mapping
## Existing Code Refs
## Proposed Code Artifacts
## Architecture / Flow
## Tasks
## Error Handling / Rollback
## Tests / Acceptance
## Risks
## Open Questions
```

### 6. 禁止事项

- 禁止在主计划中粘贴超过 30 行的大代码块。
- 禁止用 pseudo 摘要替代需要校验的 import、类型归属、控制流或测试断言。
- 禁止引用不存在的文件路径或未创建的 artifact。
- 禁止把未来才需要确认的后端接口、字段、路由或配置写成已确认事实。
- 禁止在没有文件路径和行号的情况下声称“现有代码已经支持”。
```
