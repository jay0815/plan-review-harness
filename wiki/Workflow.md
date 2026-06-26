# Workflow

当前 workflow 顺序：

1. `start`：冻结 requirement 和 initial plan，初始化 state。
2. `blind_review`：运行 architecture、execution、risk 三类 reviewer。
3. `synthesis`：合并 issue，生成 ledger 和 decision queue。
4. `human_gate`：存在 blocker issue 时等待用户决策。
5. `revision`：根据 review/decision 生成 revised plan 和 revision log。
6. `regression`：检查修订后是否仍有 blocker/high issue。
7. `convergence`：决定 done、continue 或 blocked。
8. `final`：写入 final plan 和 final report。

Runtime 支持 resume 等待中的 run，但 CLI 暂未暴露 resume 命令。

详细说明见 [docs/workflow.md](../docs/workflow.md)。
