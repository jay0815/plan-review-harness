# Fix-013: schema 一致性验证

## 现状

项目中存在两套独立的 schema：

| 维度     | `src/schemas/`             | `model-role-calibration/schemas/` |
| -------- | -------------------------- | --------------------------------- |
| 格式     | TypeScript + Zod (v4)      | JSON Schema (draft 2020-12)       |
| 用途     | 工作流运行时校验           | LLM 输出结构化约束                |
| 共享概念 | issue、severity、dimension | issue、severity、dimension        |

两套 schema 之间**没有自动生成关系**，**没有交叉引用**。共享的 severity 枚举值在两边独立定义，存在漂移风险。

## 影响

- **概念漂移风险**：severity 枚举值在两边定义可能不一致（当前值相同但顺序不同）
- **无自动验证**：没有机制确保两边的一致性

## 方案

### 核心原则

- `src/schemas/`（core runtime）是权威来源，不反过来受 `model-role-calibration/` 约束
- 共享常量定义在 core 层，calibration 层做一致性校验

### 1. 在 core 层导出共享常量

在 `src/schemas/common.ts` 中，将 severity 枚举值导出为常量数组：

```ts
export const SEVERITY_VALUES = ['blocker', 'high', 'medium', 'low'] as const
export const SeveritySchema = z.enum(SEVERITY_VALUES)
```

这样共享常量的来源是 core runtime，而非 calibration。

### 2. 创建一致性检查脚本

在 `model-role-calibration/scripts/` 中新增 `verify-schema-consistency.ts`：

```ts
// 读取 src/schemas/common.ts 中的 SEVERITY_VALUES
// 读取 model-role-calibration/schemas/ 中各 JSON Schema 的 severity enum
// 比较两者是否一致
// 不一致时打印警告并以非零状态退出
```

将此脚本加入 `calibration:typecheck` 流程。

### 3. JSON Schema 引用 core 常量（可选）

如果需要更强的一致性，可以在 JSON Schema 中通过 `$ref` 引用共享定义。但这会增加 JSON Schema 的复杂度，当前阶段不做。

### 4. 记录 schema 归属

在 `wiki/Architecture.md` 中明确：

> - `src/schemas/`：工作流运行时的 Zod schema，是 severity/dimension/type 等枚举的权威来源
> - `model-role-calibration/schemas/`：LLM 输出的 JSON Schema，用于校准实验中约束模型输出
> - 共享枚举值（severity 等）定义在 `src/schemas/common.ts`，通过一致性检查脚本验证 JSON Schema 与之对齐
> - 修改共享枚举时需先更新 `src/schemas/common.ts`，再运行一致性检查

## 涉及文件

| 文件                                                              | 改动                            |
| ----------------------------------------------------------------- | ------------------------------- |
| `src/schemas/common.ts`                                           | 导出 `SEVERITY_VALUES` 常量数组 |
| `model-role-calibration/scripts/cli/verify-schema-consistency.ts` | 新增一致性检查脚本              |
| `wiki/Architecture.md`                                            | 记录 schema 归属和一致性规则    |

## 验收

- `SEVERITY_VALUES` 在 `src/schemas/common.ts` 中导出
- 一致性检查脚本通过
- `pnpm typecheck` 通过
- `pnpm calibration:typecheck` 通过
