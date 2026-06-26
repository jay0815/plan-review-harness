# 评分备注

本 case 主要测试模型是否能从方案设计角度识别 `reqa` 的产品边界、能力边界、skill 边界和基础工程保障问题。

评分时不要只看模型提出了多少问题，要看它是否抓住主线：

> `reqa` 应收敛为文档抽取 CLI + 本地产物协议 + 高质量 skill 资产，而不是需求分析 / 规划准入 / agent 系统。

## hit_rate 评分提示

衡量模型是否命中已知问题。

- `0`：基本没有命中产品边界问题。回答没有指出 `reqa` 不应承担需求分析、规划准入、模型评审或 agent 系统职责。
- `1`：命中部分问题。例如只说“范围太大”或“职责不清”，但没有明确说明 `reqa` 应是文档抽取 CLI，也没有区分 skill 与 agent / analysis 能力。
- `2`：明确命中核心问题。回答能说清 `reqa` 应保留文档抽取 CLI、本地产物协议和 skill 资产；同时指出需求分析、规划准入、agent / agent evaluation 不应进入 `reqa` 产品边界。

## novel_value 评分提示

衡量模型是否提出已知问题之外、但仍符合方向的合理增量。

- `0`：没有合理增量，只重复输入内容或泛泛说风险。
- `1`：有少量合理补充，例如指出产物协议、输出目录、错误处理、skill 质量、基础验证链路等额外问题。
- `2`：有明显有价值的新视角，且不偏离主方向。例如提出清晰能力分层、skill 作为 LLM 使用界面的设计要求、CLI 行为可回归验证策略、文档抽取产物契约等。

## actionability 评分提示

衡量模型建议是否能直接转成设计修改项。

- `0`：只说“范围太大”“需要重构”“完善文档”等泛泛判断。
- `1`：能指出方向，但还需要人工二次拆解，例如只说“拆分分析能力”，但没有说明 `reqa` 应留下哪些设计对象。
- `2`：可以直接转成修改任务。例如明确建议：限定 `reqa` 为文档抽取 CLI；定义 HTML / Markdown / LLM Markdown / assets 的产物协议；设计 skill 内容而不是 agent；不设计需求分析 / 规划准入能力；补齐 lint、format、typecheck、unit test framework。

## evidence_discipline 评分提示

衡量模型是否基于 case 输入 evidence，而不是脑补。

- `0`：大量无依据判断。例如断言工具已经读取 credential / storage / header，或假设它是线上服务、爬虫平台、多 agent 系统。
- `1`：部分判断有 evidence，部分判断跳跃。例如能引用文档抽取目标，但对安全风险或 agent 范围有脑补。
- `2`：主要判断都能绑定输入中的 evidence。例如能基于“文档抽取 CLI、显式 URL / selector、本地产物、LLM-friendly Markdown、skill / agent / analysis 描述、非目标约束”等内容做判断。

## false_positive_cost 评分提示

分数越高表示误报越少、噪音越低。

- `0`：严重误报，明显违背 case 约束。例如建议读取 cookie/header，或者把本地 CLI 当成线上平台治理；或者建议把 `reqa` 扩成需求分析 / 多 agent 系统。
- `1`：有少量误报或主次错位。例如过度关注 Chrome、CDP、图片下载、登录态等实现风险，但仍能部分命中产品边界。
- `2`：误报少，风险分级克制。回答能区分核心缺陷、次要风险和偏好；既不扩大 `reqa`，也不全盘否定文档抽取 CLI。

## 高分输出特征

- 明确指出 `reqa` 的产品定位是文档抽取 CLI。
- 明确指出 `reqa` 不应承担需求分析、规划准入、模型评审、多 agent 编排或 agent evaluation。
- 明确说明 skill 是 CLI 面向 LLM / agent 的使用界面，应指导 LLM 正确调用 CLI 和理解产物。
- 区分 skill 资产和 agent 能力：skill 可作为源码资产保留并后续进入 marketplace，agent 不应作为 `reqa` 核心设计对象。
- 指出从头开始的 CLI 项目需要基础工程 harness，例如 lint、format、typecheck、unit test framework。
- 认可文档抽取 CLI 本身的价值，而不是全盘否定。
- 保留安全 / 非目标边界，但不会让安全细节掩盖主要设计问题。

## 低分输出特征

- 把 `reqa` 扩大成需求分析、规划准入、模型评审、多 agent 编排或 agent evaluation 工具。
- 把 skill 设计成分析流程、评审流程或决策流程载体。
- 忽略 skill 质量，只讨论 CLI 命令本身闭环。
- 只围绕 Chrome、CDP、图片下载、登录态等实现风险展开，忽略产品边界。
- 把输入中明确禁止的行为当作已发生事实，例如读取 credential / storage / header。
- 把本地 CLI 当成线上服务治理问题。
- 只提出通用工程建议，没有指出 CLI 项目的基础 harness 和产品边界问题。
