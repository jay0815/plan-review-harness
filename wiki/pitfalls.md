# 踩坑记录

## retry 时状态残留

**问题**: retry 时未重置 `finished_at`、`report_file`、`infra_errors`，导致验证逻辑误判 run 已完成。

**原因**: retry 复用了 state 对象，但没有清除上一次运行的终态字段。

**解决**: retry 开始时显式重置这些字段为 `undefined`/`null`/`[]`。

**教训**: 状态机转换时，必须显式重置所有相关字段，不能依赖"没设置就是初始值"。

---

## reviewer 越界读取

**问题**: reviewer 有时会尝试读取 `exposed_root` 之外的文件。

**原因**: reviewer prompt 未严格约束读取范围，模型可能探索性地读取。

**当前状态**: 已知，产生 warning 但不阻塞。

**后续考虑**: 在 prompt 中增加 `read_boundary` 说明，或在 tool 层面拦截越界请求。

---

## 旧版 run 缺少 manifest

**问题**: 旧版 workspace-review runner 生成的 run 没有 `run-manifest.json`。

**原因**: manifest 功能是后加的，旧版 runner 不生成。

**解决**: 提供 `backfill-workspace-run-manifest.js` 脚本，从现有产物推断并补写 manifest。
