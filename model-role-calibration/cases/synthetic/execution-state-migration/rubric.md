# 评分口径：Execution 状态模型和迁移边界

## 确定问题

- 单一 `is_synced: boolean` 不足以表达 `pending_upload`、`syncing`、`failed`、`conflict`、`migrated_unknown`、`synced` 等执行生命周期。
- 计划把所有 v1 本地草稿迁移为 `is_synced=true`，会让本地已有但未确认服务端存在的内容跳过同步或核对。
- 缺少基准 revision / last known server revision，无法判断本地编辑是基于哪个服务端版本产生，也无法可靠检测冲突。
- 部分成功或失败重跑后，缺少逐条状态转移，会让已成功记录被重复提交或让失败记录长期卡在错误状态。
- 验收只覆盖新建草稿 happy path，没有覆盖 v1 迁移、冲突、失败恢复和部分成功。

## 高质量输出

- Execution Reviewer 应把状态模型和迁移策略作为执行阻塞 issue，而不是只放入 `missing_questions` 或 `false_positive_risks`。
- Execution Reviewer 应要求计划补充最小状态机、基准 revision、逐条同步结果、迁移未知态和失败恢复语义。
- Architecture Reviewer 应指出本地状态所有权、服务端 revision、迁移标记和同步 worker 之间的结构契约未闭合。
- Risk Reviewer 应指出迁移默认 synced 会造成静默数据丢失或跳过上传风险。
- Rebuttal 应反驳“实现时自然补齐迁移细节”的说法，因为计划已经选择了会改变数据生命周期的迁移默认值。
- Synthesis 应合并状态模型与迁移边界，不应把迁移问题降为普通 missing question。

## 典型误报

- 要求第一版必须实现 CRDT、实时协同、字段级自动合并或多端实时锁。
- 要求引入复杂后台队列、全局事务平台或新服务端存储系统。
- 把 UI 冲突解决的具体组件、文案和布局当成阻塞执行项。
- 把数据库字段命名、枚举字符串具体取值或索引实现当成必须由计划提前指定的内容。

## 五项评分锚点

- `hit_rate`：5 分制，看是否覆盖状态生命周期、v1 迁移未知态、基准 revision、部分成功和失败恢复。
- `contract_closure`：5 分制，看本地状态机、服务端 revision、逐条同步结果和迁移策略是否形成可编码契约。
- `actionability`：5 分制，看输出能否直接转化为 Planner 的最小补充清单，而不是泛泛要求“补充细节”。
- `evidence_discipline`：5 分制，看是否只基于计划已经写出的 `is_synced=true`、缺少 revision 和验收缺口，不编造仓库路径或服务端能力。
- `false_positive_cost`：5 分制，看是否避免 CRDT、实时协同、复杂队列和 UI 细节扩张。分数越高表示误报越少、额外成本越低。

每项 `0` 表示基本失败，`3` 表示能发现部分问题但仍会降级状态/迁移边界，`5` 表示完整命中执行阻塞且保持最小修订范围。总分 25 分。
