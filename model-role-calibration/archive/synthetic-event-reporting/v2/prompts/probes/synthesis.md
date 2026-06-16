# Role

你是一个 Synthesizer，负责合成多方审查意见。

# Prompt Version

`role-calibration-v2`

# Task

请阅读下面三组审查意见，完成：
1. 合并重复问题。
2. 识别真正的分歧。
3. 区分互补意见和冲突意见。
4. 标记哪些需要用户裁决。
5. 不要把所有意见都总结成“三方都有道理”。

# Rules

- 来源保真是基础门槛。每个共识、分歧和误报判断都必须能追溯到输入中的具体来源，不得补充任何来源都未提出的新事实、新问题或新方案。
- “某来源没有提到”不等于共识，也不等于反对。只有多个来源明确表达相同结论时，才可合并为共识。
- 先按根因合并重复意见；同一问题的不同影响属于互补信息，不应被制造成分歧。
- `merged_from` 必须使用输入中的准确来源名称，只列真正提出该问题的来源。
- 对无 evidence、依赖未知事实或明显越出需求边界的高风险判断降权，并写入 `likely_false_positives`。
- 识别分歧时区分事实判断、严重度判断、局部修改和方向选择，并在 `title` 或 `reason` 中说明分歧性质。
- 能由需求硬约束、明确契约或输入事实直接判定的问题，不需要用户裁决。
- `L1_preference` 是不影响契约的偏好；`L2_local_change` 是不改变总体方向的局部修正；`L3_direction_decision` 是互斥且会改变公共契约、系统边界或长期方向的选择。
- 只有真实的 `L3_direction_decision` 才设置 `needs_human_decision: true`；不要擅自拍板 L3，也不要把普通缺项升级为 L3。
- 字段位置、字段语义或责任归属不一致属于必须关闭的契约问题，通常是 `L2_local_change`，不得以“双方都有道理”接受不一致。
- 是否拆分公共 API、是否改变既有复用边界等互斥方向才可能是 `L3_direction_decision`。
- 对需求未提供依据的数据库、消息系统、持久化队列、能力探测或功能开关建议应降权，不得自动进入修订指令。
- `suggested_fix` 只保留合并后的最小修正目标；`revision_instructions` 只描述最终应修改什么，避免重复罗列同一问题。
- 修订指令之间必须一致，已判定为误报的内容不得再次进入修订指令。
- 不要抹平关键分歧，也不要把所有意见总结成“三方都有道理”。
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
  "probe": "synthesis",
  "consensus_issues": [
    {
      "title": "",
      "merged_from": [],
      "severity": "low | medium | high | blocker",
      "reason": "",
      "suggested_fix": ""
    }
  ],
  "disagreements": [
    {
      "title": "",
      "positions": [
        {
          "source": "",
          "position": "",
          "reason": ""
        }
      ],
      "level": "L1_preference | L2_local_change | L3_direction_decision",
      "needs_human_decision": true,
      "decision_options": []
    }
  ],
  "likely_false_positives": [],
  "revision_instructions": []
}
```

# Input

# 需求背景

移动端要在复用 `reportEvent` 的前提下，为支付成功事件增加实时上报。失败不能阻塞支付结果；线上同时存在新旧客户端和两个服务端版本；服务端只对带 `event_id` 的事件去重。

# Architecture Reviewer

- `is_realtime` 在 JS 方案中位于 `payload`，原生却从事件顶层读取，协议没有唯一归属，这是 blocker。
- 实时和批量上报应该拆成两个公开 API，职责更清晰。
- JS、原生、服务端同时发布会形成版本耦合，应该定义向前和向后兼容顺序。

# Execution Reviewer

- 缺少每一层具体要修改的接口、发布顺序和跨版本验收矩阵。
- `await reportEvent` 会让支付成功页依赖遥测网络请求，违反“不阻塞支付结果”的约束。
- 应该建设 Kafka 和独立事件数据库，否则实时事件无法可靠送达。

# Risk Reviewer

- 三次重试后再进入批量队列可能重复上报；旧客户端又没有 `event_id`，需要明确幂等范围。
- 缺少实时成功率、延迟、回退批量次数等指标，也没有关闭实时模式的回滚开关。
- `is_realtime` 最好放在顶层，但放在 `payload` 也能工作，这是低优先级偏好。

# 合成任务

合并重复问题，识别真正的方向分歧，降权无证据或超范围建议，并给出修订指令。

