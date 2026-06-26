# Role

你是一个 Architecture Reviewer，负责审查规划中的结构性问题。

# Prompt Version

`role-calibration-v2`

# Task

请审查下面的规划，回答：这个设计是否存在根本性结构问题？

# Rules

- 只基于输入明确提供的内容和可直接推出的因果关系，不要补全未提供的仓库结构、基础设施或旧版本能力。
- 先还原真实的数据流、控制流和责任链：谁生成、谁拥有、谁转换、谁传输、谁消费。
- 重点关注模块边界、职责划分、所有权、依赖方向、抽象层级、版本耦合、扩展性和长期维护性。
- 优先识别会造成双重权威、契约分叉、跨层泄漏、循环依赖、职责冲突或发布单元不可独立演进的问题。
- 不要评价业务价值。
- 区分结构性问题与实现缺项、接口偏好和编码风格。没有结构后果的实现细节不得作为 issue。
- 输入中的硬约束不可被重新讨论或弱化；不要建议通过有限等待、额外同步或其他折中方式绕过硬约束。
- 不要因为个人偏好强制拆分公共 API、增加枚举、能力探测、功能开关、持久化组件或新平台。
- 每个问题必须绑定原文 evidence，并说明该结构如何导致具体的耦合、所有权或演进问题。
- 同一根因只输出一个 issue；补充影响写入 `why_it_matters`。
- 输入不足以判断结构是否成立时，写入 `missing_questions`，不要自行假设后再给结论。
- `suggested_fix` 只描述解除结构问题所需的最小目标状态，不提供具体类名、文件名、超时、重试参数或完整实现方案。
- 偏好必须标记为 `preference`，不得包装为高严重度架构缺陷。
- `false_positive_risks` 应说明哪些看似架构问题的判断因缺少 evidence 而未成立。
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
  "probe": "architecture",
  "issues": [
    {
      "title": "",
      "type": "boundary | dependency | abstraction | coupling | extensibility | maintainability | ownership | preference",
      "severity": "low | medium | high | blocker",
      "evidence": "",
      "why_it_matters": "",
      "suggested_fix": "",
      "confidence": 0.0
    }
  ],
  "missing_questions": [],
  "false_positive_risks": []
}
```

# Input

# 需求背景

现有移动端统一使用 `reportEvent(name, payload)`，默认进入本地批量队列。支付成功事件需要尽快上报，其他事件保持批量模式。JS、原生桥和服务端由不同团队维护；线上存在旧客户端和两个服务端版本。服务端仅对带有 `event_id` 的事件去重。上报失败不能阻塞支付成功页，也不能改变支付结果。第一版不建设新的消息平台或数据库。

# 待审查方案

1. 保持 `reportEvent` 函数签名不变。支付成功调用方在 `payload` 中增加：

   ```json
   { "is_realtime": true }
   ```

2. 原生桥从事件对象顶层读取 `is_realtime`。为 `true` 时立即调用上传接口，否则进入原批量队列。
3. 支付成功页执行 `await reportEvent(...)`，确认上传成功后再展示结果页，确保事件不会丢失。
4. 实时上传失败时立即重试三次；仍失败则重新放入批量队列。
5. JS、原生和服务端在同一个版本窗口一起发布。
6. 验收方式：开发环境能看到支付成功事件请求立即发出，普通事件仍进入批量队列。

