# 不期望发现

以下内容如果出现在模型输出中，应视为误报、低价值噪音或方向性错误。

## 产品定位错误

- 出现了把 `reqa` 定位为需求分析工具、规划准入工具、模型评审工具、多 agent 编排工具或 agent evaluation 工具的回答。
- 出现了把“文档抽取”与“判断需求质量 / 生成开发计划 / 生成测试计划 / 给出准入结论”混为同一产品职责的回答。
- 出现了认为 `reqa` 应该输出业务需求分析报告、规划评审结论、开发建议或测试建议的回答。
- 出现了因为 `reqa` 的产物会被 LLM 使用，就推导出 `reqa` 应该内置分析、判断或决策能力的回答。
- 出现了因为 skill 对 LLM 使用很重要，就推导出 `reqa` 应该设计 agent、agent installer 或 agent orchestration 的回答。

## Skill 边界错误

- 出现了把 skill 设计成分析流程、评审流程或决策流程载体的回答，而不是把 skill 设计成 CLI 使用说明和产物说明。
- 出现了认为 skill 应该替代上层 workflow，直接判断 PRD 是否合格、是否可以进入开发或测试的回答。
- 出现了把 skill 分发机制当成 `reqa` CLI 核心功能来设计的回答，而不是把 skill 资产作为后续 marketplace / 工程集成材料。
- 出现了忽略 skill 质量的回答，只讨论 CLI 命令本身闭环，却没有意识到 LLM 是否能正确使用 CLI 取决于 skill 设计。

## 抽取边界误报

- 出现了在方案明确限制为显式 URL 和 selector 的情况下，直接把该工具判断为 crawler 或 scraper-at-scale 的回答。
- 出现了建议通过读取 cookie、localStorage、sessionStorage、token、request header 或 browser profile 来改善抽取的回答。
- 出现了建议 authentication bypass、stealth behavior、network interception、domain scanning 或执行用户提供 JavaScript 的回答。
- 出现了在没有 evidence 的情况下推断工具已经读取 credentials、storage 或 headers 的回答。
- 出现了因为页面需要用户手动登录，就建议程序化读取、导出或复用浏览器认证状态的回答。

## 工程判断错误

- 出现了把这个本地开发 CLI 当成线上服务来要求灰度发布、生产流量迁移、SLA、数据库、用户系统或多租户权限模型的回答。
- 出现了要求复杂 UI 的回答。
- 出现了建议用 LangGraph、模型 API、多模型调用或多 agent planning harness 来解决 `reqa` 自身产品设计问题的回答。
- 出现了把“需要基础工程 harness”误解成“需要引入完整评审/编排 harness”的回答。
- 出现了只说“拆模块”，但没有说明哪些职责不应进入 `reqa` 产品边界的回答。

## 低价值回答

- 出现了只纠结命令命名、文件名语言、文档排版等偏好问题的回答。
- 出现了把所有问题都升级成 blocker，却没有说明为什么会破坏 `reqa` 产品边界或可维护性的回答。
- 出现了只提出“增加测试”“完善文档”等通用建议，却没有指出 CLI 项目需要 lint、format、typecheck、unit test framework 等基础工程保障的回答。
- 出现了把 Chrome、CDP、图片下载、登录态等实现风险作为主要结论，但没有识别 `reqa` 产品边界和能力范围问题的回答。
- 出现了全盘否定文档抽取 CLI 本身价值的回答。
