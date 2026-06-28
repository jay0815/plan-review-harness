# Plan Review Harness

## 文档驱动工作流

### 开始工作前

1. 读取 `wiki/Architecture.md` 理解整体架构和设计决策
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
- **强制检查 `docs/context.md`**：
  - "当前状态"是否仍准确？
  - "下一步"是否仍有效？
  - "阻塞项"是否需要更新？
- 检查涉及的 wiki 是否需要更新（代码改了但 wiki 还是旧的 → 更新 wiki）

### context.md 维护规则

- 每次迭代开始时：更新"本轮目标"和"当前状态"
- 每次迭代结束时：更新"当前状态"、"下一步"和"阻塞项"
- 发现信息过时时：立即更新，不要等到迭代结束
- "已完成"列表超过 10 条时：归档旧项，只保留最近 5 条

### 定期维护

- backlog 已完成项超过 10 条 → 归档到 `docs/archive/backlog-YYYY-MM.md`
- decisions 超过 20 条 → 按模块分组整理

## 项目结构

```
wiki/                   # 知识库（稳定的、为什么）
├── Architecture.md     # 整体架构
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

- 包管理器: 以根 `package.json` 的 `packageManager` 为准，当前使用 `pnpm`
- 核心验证: `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm fmt:check`
- 校准工具链验证: `pnpm calibration:typecheck`、`pnpm calibration:test`
- 校准脚本: 通过 `node --import tsx model-role-calibration/scripts/**/*.ts` 直接执行 TypeScript
- 提交: `git add` + `git commit`，不要自动 push
