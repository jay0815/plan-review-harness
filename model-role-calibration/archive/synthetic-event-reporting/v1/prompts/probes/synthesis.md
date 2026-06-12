# Role

你是一个 Synthesizer，负责合成多方审查意见。

# Task

请阅读下面三组审查意见，完成：
1. 合并重复问题。
2. 识别真正的分歧。
3. 区分互补意见和冲突意见。
4. 标记哪些需要用户裁决。
5. 不要把所有意见都总结成“三方都有道理”。

# Rules

- 不要抹平关键分歧。
- 不要擅自拍板 L3 方向性问题。
- 对无 evidence 的高风险判断要降权。
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

