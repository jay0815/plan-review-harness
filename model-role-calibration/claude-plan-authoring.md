# CLAUDE.md 计划生成提示词

下面内容可以直接写入业务项目的 `CLAUDE.md`，用于约束 Claude Code 在进入 plan / planning 阶段时生成可审查、可回查、但不过度预实现的计划。

```markdown
## Plan Authoring Contract

实施计划必须做到“决策完备”，不要求“实现完备”。

判断计划是否完成的标准是：

> 实现者能否在不重新做关键业务或架构决策的前提下开始编码。

不是：

> 实现者能否机械复制计划中的代码。

### 1. 主计划职责

主计划必须关闭会造成阻塞、返工或多人理解不一致的关键不确定性：

- 为什么做、做什么、不做什么。
- 现有流程和模块中的接入位置。
- 模块、端、服务和团队之间的责任边界。
- 关键接口语义、数据流、状态转换和失败语义。
- 编码前必须确认的阻塞性决策。
- 实施顺序、依赖关系、验证方式和验收条件。

主计划不需要提前展开实现阶段可按项目惯例决定的局部结构，例如：

- 完整 Hook、组件或函数实现。
- 每个组件的 props、import/export 和 JSX 结构。
- i18n JSON、mock、fixture 或测试源码全文。
- 可直接复制的单元测试和实现代码。
- 不影响公共契约、责任边界或失败语义的局部类型和文件拆分。

这些内容应写入 `Implementation Discretion`，明确交给 coding agent 在实现阶段按现有工程惯例决定。

### 2. Existing Code Refs

主计划必须包含 `## Existing Code Refs` 小节，列出计划依赖的现有代码事实。

每条引用包含：

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

如果无法确认行号，先读取文件确认；不要猜测。

Existing Code Refs 只能证明当前工程事实。计划准备新增的代码、伪代码或示例不能作为“现有代码已经支持”的事实证据。

### 3. Repo-aware 生成顺序

能够读取工程时，必须按以下顺序生成计划：

1. 从需求提取业务、架构、公共契约和失败语义决策点。
2. 逐项读取相关现有代码，不用计划中的未来代码代替工程检查。
3. 建立“已确认事实”和“待确认事项”清单。
4. 关闭能够由需求和现有代码支持的阻塞决策。
5. 编写只保留关键决策、任务依赖和验收边界的 Plan。
6. 执行事实检查、内部一致性检查、未知项归类和篇幅/代码块检查。
7. 输出计划。

如果当前环境不能读取工程，只能把缺失事实列入 `Blocking Decisions` 或 `Open Questions`，不得编造文件、符号、接口或当前行为。

### 4. Blocking Decisions

主计划必须包含 `## Blocking Decisions`。

这里只记录在相关编码开始前必须关闭的问题，例如：

- 会改变公共接口或跨层协议的字段位置。
- 业务状态的唯一权威来源。
- 跨团队责任归属。
- 失败后必须保持的用户可见语义。

如果没有阻塞决策，明确写 `None`。

未关闭的阻塞决策不得被后续任务当作已确认事实。相关任务必须停在该决策之前，不能用完整代码草案掩盖决策缺口。

### 5. Implementation Discretion

主计划必须包含 `## Implementation Discretion`，列出不需要回到计划阶段裁决的局部选择。

典型内容：

- 文件内部辅助函数如何拆分。
- 局部变量和私有类型命名。
- 组件 props 的非公共组织方式。
- mock、fixture 和测试 helper 的具体写法。
- 符合现有项目惯例的 import/export 布局。

这些选择不应被伪装成 blocking decision，也不需要在计划中给出源码。

### 6. 可选契约附录

只有复杂跨层协议、状态机或数据格式无法用简短文字消除歧义时，才可以增加短小的 `Interface Contract Appendix`。

附录应优先使用：

- 字段表。
- 状态转换表。
- 请求/响应 JSON 示例。
- Mermaid 时序图或流程图。
- 不超过表达契约所需范围的伪代码。

附录不是 proposed implementation，不要求 import、完整函数签名、错误处理源码或测试断言。未来代码不能作为事实证据。

### 7. 风险触发原则

兼容矩阵、分阶段发布、灰度、告警、容量和回滚只在需求或工程证据表明存在对应风险时展开。

例如：

- 跨客户端/服务端版本共存时，定义兼容和发布顺序。
- 数据迁移或不可逆写入时，定义回滚边界。
- 用户关键流程可能受阻时，定义失败语义和必要观测。

单模块、可原子回退、无版本共存的局部改动，不需要机械补齐平台化章节。

### 8. 计划膨胀检查

输出前检查：

- 是否存在大段可直接复制的未来实现代码。
- 是否用代码块替代尚未关闭的业务或架构决策。
- 是否因示例代码引入新的闭包状态、异步时序或接口假设。
- 是否能删除实现细节而不损失关键决策。
- 关键决策在全文中的可见性是否被代码草案淹没。

如果删除某段代码不会改变计划的业务、架构、接口或失败语义，该段通常不应出现在计划中。

### 9. 必备内容和推荐结构

Plan 必须包含以下内容，可以合并相近章节，但不得省略其语义：

- Scope / Non-goals
- Requirements Mapping
- Existing Code Refs
- Contract Decisions
- Blocking Decisions
- Implementation Discretion
- Tasks and Dependencies
- Tests / Acceptance
- Open Questions / Risks

```text
# Plan

## Goal
## Scope / Non-goals
## Requirements Mapping
## Existing Code Refs
## Architecture / Flow
## Contract Decisions
## Blocking Decisions
## Implementation Discretion
## Tasks and Dependencies
## Risk-triggered Compatibility / Rollback / Observability
## Tests / Acceptance
## Open Questions / Risks
## Optional Interface Contract Appendix
```

### 10. 禁止事项

- 禁止强制创建 Proposed Code Artifacts。
- 禁止为了让计划“可执行”而编写完整未来源码。
- 禁止在 Plan 中提供完整函数、组件、Hook、JSX、mock、fixture、测试源码或 i18n JSON。
- 禁止用 pseudo 摘要替代尚未关闭的关键契约。
- 禁止引用不存在的文件路径或把未来代码当作现有事实。
- 禁止把实现阶段可按项目惯例决定的细节升级为计划 blocker。
- 禁止在无风险依据时机械增加灰度平台、告警系统、兼容矩阵或回滚基础设施。
```
