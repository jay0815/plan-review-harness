# 需求背景

本地 CLI 要把 Markdown、JSON 和模板插件资产安装到用户目录或项目目录，并支持更新、卸载、状态检查、`--scope user|project` 和 `--dry-run`。用户可能修改已安装文件；目标目录还可能有其他来源文件。CLI 只能管理能确认归属的资产，失败后需要恢复。第一版没有在线 marketplace 或后台服务。

# 待审查方案

1. `install` 将 bundled plugin 目录递归复制到目标位置；目标存在时直接覆盖，以保证版本一致。
2. `update` 先删除整个目标目录，再复制当前版本。
3. `uninstall` 删除插件目标目录，避免残留旧文件。
4. `status` 只检查目标目录是否存在。
5. `--dry-run` 打印一句“将执行安装/更新/卸载”，但不列出文件变化。
6. 用户级路径固定为 `~/.tool/plugins/current`，项目级路径固定为 `./.tool/plugins/current`。
7. 任一步骤失败时打印错误并退出，用户重新运行同一命令即可恢复。
8. 验收方式：在空目录中依次执行 install、update、uninstall，命令退出码均为 0。
