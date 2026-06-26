# workspace-review 模块

## 设计背景

Workspace Review 负责评审产物的管理、验证和诊断。

## 核心文件

| 文件 | 职责 | 设计原因 |
|------|------|---------|
| workspace-review-manifest.js | manifest 读写、backfill | 需要统一的产物管理接口 |
| verify-workspace-review-run.js | 验证 run 完整性 | 自动化检查，减少人工排查 |
| inspect-workspace-run.js | 检查 run 详情 | 调试和分析用 |
| doctor-workspace-review-run.js | 诊断问题并给建议 | 降低排查门槛 |
| backfill-workspace-run-manifest.js | 为旧版 run 补写 manifest | 兼容历史产物 |

## 验证流程

```
verifyRun(runDir)
  ├── 检查 manifest 存在且 run_id 匹配
  ├── 检查 state.json 状态
  ├── 检查各 role 产物完整性
  │   ├── metadata.json 存在
  │   ├── stdout.jsonl 存在
  │   ├── 越界读取检查（warning）
  │   └── 失败越界读取检查（warning）
  ├── 检查 fact_check 产物
  └── 检查 report.json
```

## 诊断流程

```
doctorWorkspaceReviewRun(runDir)
  ├── 调用 verifyRun 获取检查结果
  ├── 分析失败原因
  │   ├── manifest 缺失 → 建议 backfill
  │   ├── infra_errors → 建议 retry
  │   └── 验证失败 → 给出具体修复建议
  └── 按优先级排序建议
```
