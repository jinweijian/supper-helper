## Why

异步回合当前只串行执行诊断，却允许后发消息提前进入先发回合的上下文；Presentation 也仍可通过自由文本、业务关键词特判和 supporting claim 泄漏未审核事实。必须先修复这两个核心可信性缺口，否则“证据优先”只停留在结构合同层。

## What Changes

- 使用 `userMessageId` 标识回合，并为每个回合构建截止该消息的上下文快照。
- 将模型 Presentation 改成只选择 accepted claim/evidence 的结构化计划，由 Runtime 确定性渲染完整回复。
- 删除 Q2/业务关键词特判、固定风险句和 Evidence Judge 分数可见路径。
- 明确 Claude session 按 Case 复用，但 CaseRepository 与 DiagnosticRequest 仍是权威上下文。

## Capabilities

### New Capabilities

- `turn-bound-presentation-integrity`: 回合消息边界和完整用户可见回复的确定性证据约束。

### Modified Capabilities

- `resolved-turn-context`: 上下文必须截止到当前 `userMessageId`。
- `deterministic-output-review`: Presentation 不得生成未绑定 accepted claim 的事实文本。
- `diagnostic-agent-runtime`: 同 Case 异步回合通过消息 ID 串行完成。

## Impact

影响 Runtime 回合入口、上下文构建、Presentation 合同、Agent 配置、Claude 会话文档及相关兼容测试；HTTP response shape 和 Case 顶层 JSON shape 保持不变。
