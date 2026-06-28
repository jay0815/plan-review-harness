# Phase 5 Step 1: 创建目录结构

## 目标

创建子目录结构，不移动任何文件。零风险。

## 操作

```bash
cd model-role-calibration/scripts
mkdir -p lib workspace mcp cli test
```

## 验证

- 5 个子目录存在且为空
- `pnpm calibration:typecheck` 通过
- `pnpm test` 通过

## 风险

无。只创建空目录。
