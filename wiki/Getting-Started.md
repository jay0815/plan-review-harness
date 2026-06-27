# 快速开始

1. 安装依赖：

   ```bash
   pnpm install
   ```

2. 运行验证：

   ```bash
   pnpm test
   pnpm typecheck
   ```

   修改 `model-role-calibration/` 时，额外运行 `pnpm calibration:typecheck` 和 `pnpm calibration:test`。

3. 运行 mock review：

   ```bash
   pnpm plan-review -- start --requirement fixtures/sample-requirement.md --plan fixtures/sample-plan.md
   ```

默认 artifact 输出到 `runs/<runId>/`。本地实验可添加 `--run-dir /tmp/plan-runs`，避免污染仓库内生成产物。

详细说明见 [docs/getting-started.md](../docs/getting-started.md)。
