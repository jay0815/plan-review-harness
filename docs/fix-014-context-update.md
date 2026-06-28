# Fix-014: context.md 更新流程

## 现状

`docs/context.md` 当前内容：

```markdown
## 本轮目标

建立文档驱动工作流，规范迭代过程中的知识沉淀。

## 当前状态

- 已完成：manifest backfill、reviewer 错误处理改进、中文计划章节映射、读取边界检测
- 进行中：文档工作流搭建
- 待处理：inspect json 输出、按角色粒度重试
```

"进行中：文档工作流搭建"已经完成（文档已存在），但 `context.md` 未更新。`backlog.md` 中的已完成项已超过 `context.md` 中记录的范围。

## 影响

- **信息过时**：新会话读取 `context.md` 会获得错误的项目状态
- **决策误导**：基于过时信息做出的工作建议可能不准确

## 方案

### 1. 立即更新 context.md

将 `context.md` 更新为当前真实状态：

```markdown
# 当前迭代上下文

## 本轮目标

完成架构梳理，制定并执行 15 项修复计划。

## 当前状态

- 已完成：manifest backfill、reviewer 错误处理改进、中文计划章节映射、读取边界检测、文档工作流搭建
- 进行中：架构修复计划设计（15 项 fix）
- 待执行：15 项 fix 的实现

## 下一步

1. 按 Phase 顺序执行 13 项方案（原 Fix-009/010/011 已合并）
2. 每完成一项更新 backlog.md

## 阻塞项

（暂无）
```

### 2. 建立更新检查机制

在 `CLAUDE.md` 和 `AGENTS.md` 的"完成后"或等价工作规则部分增加强制检查：

```markdown
### 完成后

- 更新 `docs/backlog.md`（移动到"已完成"，加日期）
- 更新 `docs/roadmap.md`（如有进度变化）
- **强制检查 `docs/context.md`**：
  - "进行中"是否仍准确？
  - "下一步"是否仍有效？
  - "阻塞项"是否需要更新？
- 检查涉及的 wiki 是否需要更新
```

### 3. 在 CLAUDE.md 和 AGENTS.md 中增加 context.md 的维护规则

本仓库同时有 `CLAUDE.md`（Claude Code）和 `AGENTS.md`（Codex）两份 agent 指南。context 维护规则必须同步写入两份文件，否则两套 agent 的行为会漂移。

在两份文件中都增加：

```markdown
### context.md 维护规则

- 每次迭代开始时：更新"本轮目标"和"当前状态"
- 每次迭代结束时：更新"当前状态"、"下一步"和"阻塞项"
- 发现信息过时时：立即更新，不要等到迭代结束
- "已完成"列表超过 10 条时：归档旧项，只保留最近 5 条
```

## 涉及文件

| 文件              | 改动                               |
| ----------------- | ---------------------------------- |
| `docs/context.md` | 更新为当前真实状态                 |
| `CLAUDE.md`       | 增加 context.md 维护规则和强制检查 |
| `AGENTS.md`       | 同步增加 context.md 维护规则       |

## 验收

- `docs/context.md` 反映当前真实状态
- `CLAUDE.md` 包含 context.md 维护规则
- `AGENTS.md` 包含相同的 context.md 维护规则
- 后续迭代中 context.md 不再过时
