# 上下文

## 本地项目路径

- 旧设计方向：`/Users/guanchengqian/github/reqa`
- 新设计方向：`/Users/guanchengqian/gitlab/tools/reqa`

## Case 设置

原始独立 plan 没有保留下来。`input.md` 中总结的 README 内容被视为原始方案记录。

被测试模型应该审查 README 暗含的方向。除非 prompt 明确包含文件内容，否则不要假设模型可以检查任一本地仓库。
