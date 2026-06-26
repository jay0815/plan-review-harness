# 快速开始

## 前置条件

本项目使用 `pnpm`，`package.json` 中声明的包管理器是 `pnpm@10.26.0`。当前没有声明 `engines` 字段，因此不要从配置中推断更严格的 Node 版本要求。

## 安装依赖

```bash
pnpm install
```

## 运行验证

```bash
pnpm test
pnpm typecheck
```

- `pnpm test`：运行核心 TypeScript harness 的 Vitest 测试套件。
- `pnpm typecheck`：执行 `tsc --noEmit`。

修改 `model-role-calibration/` 时，额外运行 `pnpm calibration:test` 验证历史 JS 校准脚本；新增或迁移 TS 文件时，同时运行 `pnpm calibration:typecheck`，并用 `pnpm calibration:build` 生成兼容 JS。

## 运行 Mock Review

```bash
pnpm plan-review -- start \
  --requirement fixtures/sample-requirement.md \
  --plan fixtures/sample-plan.md
```

CLI 会输出生成的 `runId`、状态和 artifact 目录。默认输出位置是 `runs/<runId>/`。

本地实验建议使用临时目录，避免污染仓库内示例产物：

```bash
pnpm plan-review -- start \
  --requirement fixtures/sample-requirement.md \
  --plan fixtures/sample-plan.md \
  --run-dir /tmp/plan-runs
```

## 查看结果

先查看 run 目录下的 `state.json`，再进入 `round-001/` 查看 worker 输出、ledger、decision queue、revision、regression、convergence 和 final report。完整目录结构见 [Artifact 契约](artifacts.md)。
