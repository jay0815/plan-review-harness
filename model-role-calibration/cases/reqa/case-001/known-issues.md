# 已知问题

仅供人工评分使用。不要把本文件放进 probe prompt。

本文件只记录已经确认存在的问题；“好模型应该发现什么”放在 `expected-findings.md`。

## 已确认问题

- 旧设计最大问题是范围过大：`reqa` 把文档抽取 CLI、PRD 分析 prompt、PRD analysis agent、eval harness 等能力混在同一个产品方向里。
- PRD analysis agent 不是新版 `reqa` 的核心方向。新版应收敛到“稳定抽取需求文档 + 保留可被后续工程化集成的 reqa skill 资产”。
- 旧设计把“抽取需求文档”和“判断需求是否足够进入开发规划”放在同一个产品边界里，导致职责边界混乱。
- `get-prd prompt --role ...`、`prd-agent analyze ...`、`eval:prd-agent` 这类需求分析 / 规划准入能力容易把 `reqa` 推向“分析框架”，偏离 CLI 工具本身。
- 对于这种从头开始的 CLI 项目，设计阶段就应该准备基础工程 harness，例如 lint、format、typecheck，并引入必要的 unit test framework；旧设计没有把这些基础工程保障作为明确部分。
- 对于 CLI 类型项目，设计中还缺少对 skill 资产本身的明确规划。CLI 可以在命令层面闭环，但面向 LLM / agent 的使用效果很大程度取决于 skill 质量；旧设计没有把“如何让 skill 正确引导 LLM 使用 reqa CLI 和理解产物”作为独立设计点。

## skill 资产的边界

- `reqa` 源码目录中可以保留 skill 相关目录和说明资产，方便后续通过工程手段集成进入自定义 marketplace。
- `reqa` CLI 不应保留 `install`、`install-skill`、`install-agent` 等安装能力；CLI 核心只负责文档抽取和产物生成。
- skill 资产的职责应是声明和引导 agent 正确使用 `reqa` CLI、理解输出目录和产物边界，而不是让 `reqa` 自身拥有完整的 PRD 分析 agent 或规划准入判断能力。
- 不应该期待其他人额外补写 skill 来声明如何使用这个 CLI；`reqa` 可以随源码保留这层面向 agent 的使用资产，但安装和分发应交给 marketplace 或上层工程机制。
- agent installer 不应作为新版 `reqa` 的核心能力。agent 隐含角色、判断流程和任务边界，容易把 `reqa` 再次推回需求分析 / 规划准入系统。
- 如果未来确实需要 agent，应由上层 harness、`sdd-preset` 或其他 workflow 定义；`reqa` 只提供 CLI、产物协议和 skill 资产。
