# 输入

## 任务背景

我们正在继续推进新版仓库之前，回看旧版 `reqa` / `doc-extract` 的设计方向。

原始独立 plan 没有保留下来。旧仓库 README 是目前最接近原始设想的记录，因此本 case 把 README 中体现出的设计方向当作原始 plan 来审查。

本次审查对象是 README 暗含的产品方向：一个本地 CLI，用于把已授权访问的 TAPD 需求文档抽取成 Markdown；同时 README 里还加入了 agent/skill 安装能力和 PRD 分析工作流。

## 原始需求

构建一个本地开发自动化工具，用于从浏览器渲染后的 TAPD 页面中抽取已授权的需求文档内容，并保存为本地 Markdown，供后续 Claude Code、Codex 或其他本地 CLI 工作流分析。

工具需要做到：

- 通过本地 Chrome DevTools Protocol 端点打开用户明确提供的 URL。
- 只读取用户明确提供的 CSS selector 匹配到的 DOM 元素。
- 将选中的 HTML 转换为 Markdown。
- 保存本地输出，供 Claude Code、Codex 或其他本地 CLI 工作流后续使用。
- 始终限制在“单个已授权文档抽取”的边界内。

README 中明确写出的非目标：

- 不是 crawler。
- 不是 scraper-at-scale。
- 不是 security testing tool。
- 不是 credential extraction tool。
- 不是 authentication bypass tool。
- 不读取 cookies、localStorage、sessionStorage、IndexedDB、passwords、tokens、request headers 或 browser profiles。
- 不拦截网络流量，不爬链接，不扫描域名，不绕过认证，不做 stealth behavior，也不执行用户提供的 JavaScript。

## 原始方案

README 描述了一个名为 `doc-extract` 的工具，通过 `get-prd` / `pnpm doc-extract` 暴露。

### 核心抽取输出

每次抽取会写出三类相关文档：

- `需求.raw.html`：选中 HTML 的快照，用于内容核验。
- `需求.md`：从 HTML 快照转换出来的 Markdown，复杂表格保留为 raw HTML block。
- `需求.llm.md`：面向 Claude Code、Codex 或其他本地 agent 的 LLM 友好 Markdown。

对于 TAPD story URL，默认 selector 是 `.content-wrap`。输出路径由 story id 的最后 7 位生成：

```text
./requirements/1416998/需求.md
./requirements/1416998/需求.llm.md
./requirements/1416998/需求.raw.html
./requirements/1416998/assets/1.png
./requirements/1416998/assets/2.jpg
```

### TAPD 快捷入口

PRD 快捷命令是：

```bash
get-prd "https://www.tapd.cn/tapd_fe/58741662/story/detail/1158741662001416998"
```

README 说明这个命令内部使用 TAPD 默认参数，例如：

```text
selector: .content-wrap
scroll-selector: .detail-container-left__scroll-wrapper.webkit-scrollbar
timeout: 60000
login-wait-timeout: 5000
wait-after-load: 4000
scroll-to-bottom: true
scroll-step: 700
scroll-delay: 600
scroll-max-steps: 80
wait-for-network-idle: 1500
network-idle-timeout: 10000
image-source: chrome
launch-browser: true
chrome-path: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
chrome-user-data-dir: /tmp/doc-extract-chrome-profile
```

### 通用显式用法

README 也描述了通用的显式抽取方式：

```bash
pnpm doc-extract \
  --url "https://internal.example.com/docs/requirement-123" \
  --selector "[data-doc-root]" \
  --output "./requirements/requirement-123/需求.md" \
  --html-output "./requirements/requirement-123/需求.raw.html"
```

### 浏览器和登录处理

当 `http://127.0.0.1:9222` 不可用时，方案会启动一个独立的本地 Chrome profile，并开启 remote debugging：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/doc-extract-chrome-profile \
  --no-first-run \
  --no-default-browser-check \
  --disable-sync
```

如果需求文档需要登录，用户在这个 Chrome 窗口中手动登录。README 说明 `get-prd` 会等待，直到 PRD 内容出现后继续执行；工具不会通过程序读取浏览器凭据或 storage。

### 图片处理

选中文档区域中 `<img src>` 引用的图片，如果可以直接访问，就下载到本地并改写为相对路径。

工具不会为了下载图片读取 cookies、storage、tokens 或 request headers。无法直接获取的图片会保留原始 URL，并输出 warning。

README 还说明 `--image-source chrome` 会先尝试保存 Chrome DevTools resource tree 中已经加载的图片资源，再 fallback 到直接 `fetch`。

### Agent / Skill 安装

README 增加了安装 bundled `reqa` agent 和 skill 的命令，让 Codex 和/或 Claude Code 可以识别 `reqa [tapd_url]` 工作流：

```bash
get-prd install --target all --scope global
get-prd install --target codex --scope global
get-prd install --target claude --scope global
get-prd install-skill --target codex --scope global
get-prd install-skill --target claude --scope global
get-prd install-agent --target codex --scope global
get-prd install-agent --target claude --scope global
get-prd install --target all --scope project
```

全局安装位置：

```text
~/.agents/skills/reqa
~/.claude/skills/reqa
~/.codex/agents/reqa-prd-analyzer.toml
~/.claude/agents/reqa-prd-analyzer.md
```

项目内安装位置：

```text
./.agents/skills/reqa
./.claude/skills/reqa
./.codex/agents/reqa-prd-analyzer.toml
./.claude/agents/reqa-prd-analyzer.md
```

README 说明 installer 不会修改 browser data、tokens、credentials 或 agent runtime configuration。

### PRD Analysis Agent

README 增加了一个分析工作流：

```bash
cat ./requirements/requirement-123/需求.llm.md \
  | claude -p "$(get-prd prompt --role frontend)" \
  > ./requirements/requirement-123.analysis.json
```

它还描述了用于 planning-entry analysis 的角色：

- `all`：判断 frontend、backend、test 是否都能产出 plan。
- `frontend`：判断前端是否能产出开发计划。
- `backend`：预留的后端分析；产品 PRD 不需要完整 API contract。
- `test`：预留的测试分析；判断 QA 是否能产出测试计划。

README 还描述了用 `eval-cases/` fixture 回归测试 PRD Analysis Agent：

```bash
PRD_AGENT_COMMAND='prd-agent analyze {markdown} --assets {assets} --assets-manifest {assetsManifest} --output json' \
  pnpm eval:prd-agent -- --version prompt-v1.0
```

## 约束条件

- 第一版应该保持本地化、CLI 优先。
- 抽取边界必须始终是显式 URL 加显式 selector。
- 工具不能读取浏览器凭据、browser storage、tokens、request headers 或 profiles。
- 工具不能被包装或扩展成 crawling、scraping-at-scale、security testing 或 bypass automation。
- 生成文件应继续能被 Codex、Claude Code 等本地 CLI agent 使用。
- 新方向希望让 `reqa` 更专注于抽取 CLI 本身，以及提供更好的 `reqa` 使用 skill。

## 已有上下文

本地有两个仓库：

- 旧设计方向：`/Users/guanchengqian/github/reqa`
- 新设计方向：`/Users/guanchengqian/gitlab/tools/reqa`

本 case 用来测试 reviewer 是否能在继续新版仓库之前，从旧方向中识别出设计、架构、执行和风险问题。
