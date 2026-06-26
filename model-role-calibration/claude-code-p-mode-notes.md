# Claude Code `-p` 自动化注意事项

本文记录 `model-role-calibration` 在使用 `claude -p` 驱动不同 Claude Code wrapper 时遇到的问题、原因和对应处理方式。后续实现类似 runner 时，应优先把这些约束放进代码，而不是只依赖 prompt。

## 1. `-p` 模式没有可靠的增量进度

现象：

- `claude -p --output-format stream-json` 会输出逐行 JSON 事件，但模型 API 等待期间仍可能长时间没有新事件。
- 外层命令看起来像卡死，但实际可能仍在等待 API 或模型输出。

原因：

- `-p` 是非交互输出模式；`stream-json` 能暴露已生成的事件，但不能为尚未返回的 API 请求提供进度。
- 模型 API 慢、wrapper 等待、工具调用等待期间，CLI 不一定输出中间状态。

处理方式：

- runner 自己输出 heartbeat。
- heartbeat 至少包含 elapsed time、pid、stdout/stderr byte 数、timeout、临时 cwd。
- 每次结束后保存 raw CLI output 和 metadata，便于事后判断失败原因。

## 2. `--json-schema` 不是自我修复机制

现象：

- 即使传入 `--json-schema`，部分 wrapper 仍可能输出不符合预期的内容。
- CLI 的 schema 约束更接近终态校验，不能保证模型会先检查、修正、再输出。

原因：

- schema 是输出契约，不是可被模型主动调用的校验器。
- 如果模型第一次构造的 JSON 有问题，CLI 不一定有足够流程让它自修复。

处理方式：

- 如果要硬化输出流程，需要给 agent 提供显式 validator tool。
- prompt 中要求最终输出前调用 validator。
- 评测口径要写清楚：这时评测的是 `agent + validator tool`，不是纯模型裸 JSON 能力。

## 3. MCP 工具加载成功不等于可调用

现象：

raw event 中可以看到 MCP server connected，工具也出现在 tools 列表里：

```text
mcp__json_validator__validate_json_output
```

但实际调用时失败：

```text
Claude requested permissions to use mcp__json_validator__validate_json_output, but you haven't granted it yet.
```

原因：

- `-p` 是非交互模式，无法像交互模式一样弹出授权确认。
- `--permission-mode default` 下，MCP tool 调用仍然需要权限。
- 只看到 MCP connected 不能说明权限已经放开。

处理方式：

- validator 模式下显式允许对应 MCP tool：

```bash
--allowed-tools mcp__json_validator__validate_json_output
```

- 不要同时传：

```bash
--disallowed-tools mcp__*
```

- 可以继续保留：

```bash
--tools ""
```

这样仍然禁用 built-in tools，只允许这一个 validator MCP tool。

## 4. 使用工具后 `--max-turns 1` 不够

现象：

- 模型调用 validator 后还没有机会输出最终 JSON，流程就被截断。
- 如果工具权限没放开，模型可能反复尝试调用工具，最后变成 `error_max_turns`。

原因：

- validator 流程至少包含：生成候选 JSON、调用工具、收到 tool result、输出最终 JSON。
- `--max-turns 1` 只适合无工具的一次性输出。

处理方式：

- validator 模式至少使用：

```bash
--max-turns 4
```

- `--max-turns 4` 必须和 `--allowed-tools` 一起配置，否则只是把权限失败重复几次。

## 5. transport 失败要和 JSON 失败分开

现象：

部分 wrapper 失败时，raw output 中出现：

```text
API Error: Unable to connect to API (FailedToOpenSocket)
```

原因：

- 这是 wrapper/API/socket 层失败，不是 prompt、schema 或 validator 失败。
- 这类失败可能 exit code 为 1，但不能说明模型输出质量有问题。

处理方式：

- runner 应按失败类型分类：
  - `FailedToOpenSocket` 或 `api_retry`：transport 问题，直接重跑。
  - permission denied：CLI 权限配置问题。
  - `error_max_turns`：turn budget 或工具流程问题。
  - exit 0 但 runner 判定 invalid：再检查 JSON/schema/parser。

## 6. raw output 需要结构化解析

现象：

- Claude Code 历史 JSON output 可能是单个 envelope 或 event array；当前 runner 使用逐行 `stream-json`。
- 成功结果可能在 `structured_output`，也可能在 result event 的 `result` 字段里。
- 失败信息不一定在 stderr，很多关键信息在 stdout JSON events 中。

原因：

- `claude -p --output-format stream-json` 在不同路径下会输出不同类型的事件，最终结果位于 `result` 事件。
- wrapper/API/tool 失败经常作为 structured event 出现在 stdout。

处理方式：

- 不要靠 stderr 或字符串正则判断整体状态。
- 保存并解析 raw CLI output。
- metadata 至少记录 command args、exit code、signal、timeout、attempt、schema、prompt、session name。

## 推荐参数形态

validator 模式推荐使用以下核心参数：

```bash
--bare \
--setting-sources "" \
--strict-mcp-config \
--disable-slash-commands \
--tools "" \
--allowed-tools mcp__json_validator__validate_json_output \
--no-chrome \
--permission-mode default \
--output-format stream-json \
--json-schema '<schema>' \
--max-turns 4 \
--mcp-config '<validator mcp config>' \
-p
```

非 validator 模式可以继续禁用所有 MCP tools：

```bash
--tools "" \
--disallowed-tools mcp__*
```

## 结论

`claude -p` 适合做自动化 runner，但要把以下能力放在 runner 层显式处理：

- 进度 heartbeat。
- raw output 和 metadata 持久化。
- MCP tool 权限白名单。
- validator 模式的 turn budget。
- transport、permission、max turns、JSON/schema 的失败分类。
- 对 JSON event envelope 的结构化解析。

不要假设 `claude -p` 会像交互模式一样自动展示进度、弹出权限确认、或替模型完成 JSON 自修复。
