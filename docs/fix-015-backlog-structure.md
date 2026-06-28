# Fix-015: backlog 结构化改进

## 现状

`docs/backlog.md` 当前结构：

```markdown
## 待处理

- [ ] inspect-workspace-run.js 增加 --format json 输出
- [ ] 增加 reviewer 失败分支的离线 orchestration 回归测试
- [ ] reviewer 失败时支持按角色部分重试

## 进行中

（暂无）

## 已完成

- [x] 增加 workspace run manifest backfill 脚本 # 2026-06-26
- [x] 改进 reviewer 阶段失败的错误处理（reviewerStageError） # 2026-06-26
- [x] 支持中文计划的显式章节映射 # 2026-06-26
- [x] 区分成功/失败的读取尝试，检测失败的越界读取 # 2026-06-26
```

缺少优先级、工作量估算、依赖关系和模块归属。

## 影响

- **无法排优先级**：三个待处理项没有优先级标记，难以决定先做哪个
- **无法估算工作量**：没有工作量信息，无法规划迭代
- **已完成项堆积**：已完成项没有归档机制，会持续增长

## 方案

### 1. 定义 backlog 条目格式

```markdown
- [ ] <标题> [P<优先级>] [<估算>] @<模块>
  - 原因：<为什么要做>
  - 依赖：<依赖哪些其他项，可选>
```

示例：

```markdown
- [ ] inspect-workspace-run.js 增加 --format json 输出 [P2] [0.5d] @workspace-review
  - 原因：当前输出是人类可读格式，自动化工具无法解析

- [x] 增加 workspace run manifest backfill 脚本 [P1] [1d] @workspace-review # 2026-06-26
```

### 2. 优先级定义

| 级别 | 含义                       | 标记 |
| ---- | -------------------------- | ---- |
| P0   | 阻塞其他工作，必须立即处理 | [P0] |
| P1   | 本轮迭代目标，高优先级     | [P1] |
| P2   | 下轮迭代考虑，中优先级     | [P2] |
| P3   | 有空再做，低优先级         | [P3] |

### 3. 估算定义

使用人天（d）为单位：

- `0.5d`：半天内可完成
- `1d`：一天可完成
- `2d`：需要两天
- `3d+`：需要拆分为更小的任务

### 4. 模块标记

| 标记              | 对应目录                                                             |
| ----------------- | -------------------------------------------------------------------- |
| @core             | `src/`                                                               |
| @cli              | `src/cli/`                                                           |
| @workspace-review | `model-role-calibration/scripts/` 中 workspace/MCP 相关脚本          |
| @calibration      | `model-role-calibration/scripts/` 中 calibration/fact-check 相关脚本 |
| @docs             | `docs/`、`wiki/`                                                     |

### 5. 已完成项归档规则

- 已完成项超过 10 条时，归档到 `docs/archive/backlog-YYYY-MM.md`
- 归档时保留原始格式和日期
- 只保留最近 10 条在 `backlog.md` 中

### 6. 更新当前 backlog.md

```markdown
# Backlog

## 待处理

- [ ] inspect-workspace-run.js 增加 --format json 输出 [P2] [0.5d] @workspace-review
  - 原因：当前输出是人类可读格式，自动化工具无法解析
- [ ] 增加 reviewer 失败分支的离线 orchestration 回归测试 [P1] [2d] @core
  - 原因：验证 reviewer 失败时的错误处理路径
  - 依赖：Fix-008（错误处理统一策略）
- [ ] reviewer 失败时支持按角色部分重试 [P2] [1d] @workspace-review
  - 原因：当前重试整个 reviewers 阶段，粒度太粗
  - 依赖：上一条回归测试完成后

## 进行中

- [ ] 架构修复计划执行（13 项方案，原 15 项中 Fix-009/010/011 已合并） [P0] [10d] @core @workspace-review
  - 原因：见 docs/fix-\*.md

## 已完成

- [x] 增加 workspace run manifest backfill 脚本 [P1] [1d] @workspace-review # 2026-06-26
- [x] 改进 reviewer 阶段失败的错误处理（reviewerStageError） [P1] [1d] @workspace-review # 2026-06-26
- [x] 支持中文计划的显式章节映射 [P1] [0.5d] @workspace-review # 2026-06-26
- [x] 区分成功/失败的读取尝试，检测失败的越界读取 [P1] [0.5d] @workspace-review # 2026-06-26
```

## 涉及文件

| 文件              | 改动                                   |
| ----------------- | -------------------------------------- |
| `docs/backlog.md` | 结构化改造，增加优先级、估算、模块标记 |

## 验收

- 所有待处理项有优先级和估算
- 已完成项保留日期
- `docs/backlog.md` 格式符合新规范
