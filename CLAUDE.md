# Plan Review Harness

## 文档驱动工作流

### 开始工作前

1. 读取 `wiki/architecture.md` 理解整体架构和设计决策
2. 根据任务读取相关 `wiki/modules/*.md`，定位关键文件和数据流
3. 读取 `docs/backlog.md` 确认待处理项
4. 读取 `docs/roadmap.md` 理解当前阶段目标
5. 读取 `docs/debt.md` 了解已知约束和 workaround
6. 读取 `docs/context.md` 了解当前迭代上下文
7. 结合以上信息，给出本轮工作建议，由用户决策

### 工作中

- 遇到决策：记录到 `docs/decisions.md`，包含决策、原因、替代方案
- 遇到问题：记录到 `docs/errors.md`，包含现象、原因、解决
- 发现债务：记录到 `docs/debt.md`，包含状态、影响、后续
- 有新想法：记录到 `docs/backlog.md` 的"待处理"区

### 完成后

- 更新 `docs/backlog.md`（移动到"已完成"，加日期）
- 更新 `docs/roadmap.md`（如有进度变化）
- 更新 `docs/context.md`（更新当前状态和下一步）
- 检查涉及的 wiki 是否需要更新（代码改了但 wiki 还是旧的 → 更新 wiki）

### 定期维护

- backlog 已完成项超过 10 条 → 归档到 `docs/archive/backlog-YYYY-MM.md`
- decisions 超过 20 条 → 按模块分组整理

## 项目结构

```
wiki/                   # 知识库（稳定的、为什么）
├── architecture.md     # 整体架构
├── conventions.md      # 隐式约定
├── pitfalls.md         # 踩坑记录
└── modules/            # 各模块设计背景

docs/                   # 工作台（动态的、做什么）
├── backlog.md          # 待处理
├── roadmap.md          # 目标和进度
├── debt.md             # 技术债
├── decisions.md        # 决策记录
├── errors.md           # 错误记录
├── context.md          # 当前迭代上下文
├── reviews/            # 审查报告
├── checklists/         # 清单
└── archive/            # 归档
```

## 代码约定

- 测试: `npm test`
- 语法检查: `node --check <file>`
- 提交: `git add` + `git commit`，不要自动 push
