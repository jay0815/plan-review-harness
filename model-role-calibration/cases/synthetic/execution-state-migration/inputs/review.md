# 需求背景

移动端笔记应用已有 v1 本地草稿表：

- `draft_id`
- `body`
- `updated_at`

v1 没有同步状态字段，也没有保存服务端 revision。部分用户长期离线，设备内可能存在只保存在本地、从未上传服务端的草稿。v2 要增加自动同步：

- 服务端记录包含 `draft_id`、`server_revision` 和 `body`。
- 上传接口支持客户端传入幂等键。
- 同步失败不能丢失本地编辑，用户仍可继续离线编辑。
- 两台设备可能编辑同一草稿。
- 第一版不做 CRDT、实时协同或字段级自动合并。
- 无法自动解决的冲突必须进入用户处理流程。

# 待审查计划

## Plan Complexity

- level: multi_step
- reason: 需要本地 schema 迁移、同步 worker、上传接口调用和基础验收。

## Scope / Non-goals

- Scope: 为本地草稿增加 v2 自动同步。
- Non-goals: 不做 CRDT、实时协同、字段级自动合并或复杂后台队列平台。

## Contract Decisions

- 本地表新增 `is_synced: boolean` 和 `last_sync_error: string | null`。
- 用户编辑草稿时保存正文并设置 `is_synced=false`。
- 网络恢复后，同步 worker 查询所有 `is_synced=false` 的草稿并逐条上传。
- 上传成功后将该草稿设置为 `is_synced=true`，并清空 `last_sync_error`。
- 上传失败时保持 `is_synced=false`，记录 `last_sync_error`，下次网络恢复后重试。
- 如果服务端返回 revision 冲突，客户端记录 `last_sync_error="conflict"`，后续由 UI 展示。

## v1 到 v2 迁移

- 为所有 v1 草稿新增 `is_synced=true`。
- `last_sync_error` 默认设为 `null`。
- 不回查服务端，也不触发迁移后的首次同步。
- 理由：避免升级后一次性上传大量旧草稿。

## 幂等

- 每次上传前用 `draft_id + Date.now()` 生成幂等键。
- 上传失败重试时重新生成幂等键。

## Tasks and Dependencies

1. 执行本地数据库迁移，增加 `is_synced` 和 `last_sync_error`。
2. 在编辑保存逻辑中设置 `is_synced=false`。
3. 实现网络恢复后的同步 worker。
4. 上传成功后设置 `is_synced=true`。
5. 上传失败后记录 `last_sync_error`。
6. 在 UI 中展示冲突错误。

## Tests / Acceptance

- 新建一条离线草稿，联网后服务端能看到相同正文。
- 上传接口返回错误时，本地草稿仍保留。
- 再次联网后会重试失败草稿。
- v1 升级到 v2 后，已有草稿仍能在列表中显示。

## Open Questions / Risks

- 冲突 UI 的具体交互样式由产品后续确认。
