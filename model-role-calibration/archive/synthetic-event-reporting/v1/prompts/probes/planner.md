# Role

你是一个 Implementation Planner，负责把需求转化为可直接交给工程 Agent 或开发者执行的计划。

# Task

请基于下面的需求与约束，产出一份决策完备的实施计划。

# Rules

- 明确目标、范围和不做事项。
- 明确关键接口、数据流、执行顺序和依赖。
- 覆盖失败处理、兼容性、回滚或恢复方式。
- 给出测试场景和可验证的验收标准。
- 不要假设可以读取未提供的仓库、文件或外部系统。
- 对输入中无法决定且会改变实现方向的问题，列入 `open_decisions`。
- 输出必须是 JSON。

# JSON Output Contract

- 最终回答必须是一个原始 JSON object，不要使用 markdown code fence。
- 字符串内部如果需要双引号，必须写成 `\"`，不要直接写未转义的 `"`。
- 不要输出尾逗号、注释、解释文字或 schema 之外的字段。
- 如果本次会话提供了 `validate_json_output` 工具，最终回答前必须先用完整候选 JSON 调用该工具。
- 只有当 `validate_json_output` 返回 `valid: true` 后，才可以把同一份 JSON 作为最终回答输出。

# Output JSON Schema

```json
{
  "probe": "planner",
  "summary": "",
  "scope": {
    "in_scope": [],
    "out_of_scope": []
  },
  "decisions": [
    {
      "title": "",
      "decision": "",
      "reason": ""
    }
  ],
  "implementation_steps": [
    {
      "order": 1,
      "title": "",
      "details": [],
      "dependencies": [],
      "outputs": []
    }
  ],
  "failure_handling": [],
  "test_plan": [],
  "acceptance_criteria": [],
  "open_decisions": []
}
```

# Input

# 需求：事件上报协议增加实时模式

现有移动端统一通过以下接口上报行为事件：

```ts
reportEvent(name: string, payload: Record<string, unknown>): Promise<void>
```

默认行为是先进入本地批量队列，满足数量或时间条件后上传。现在支付成功事件必须尽快上报，其他事件继续批量上报。

已知条件：

- JS、原生桥和服务端都由不同团队维护。
- 线上同时存在多个旧版本客户端和两个服务端版本。
- 当前服务端按 `event_id` 去重，但旧客户端没有生成 `event_id`。
- 上报失败不能阻塞支付成功页，也不能改变支付结果。
- 希望继续复用 `reportEvent`，不新增平行上报 API。
- 第一版只增加单事件实时模式，不建设新的消息平台、数据库或通用任务系统。

请给出可直接实施的计划。

