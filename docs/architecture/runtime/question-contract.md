# 问题契约

## 读者先看

本功能负责把用户自然语言变成当前回合的共同契约：`ResolvedTurnContext` 和 `AnswerGoal`。后续 Experience、Knowledge、Worker、Review、Presentation 都必须围绕同一个契约工作。

## 功能边界

| 负责 | 不负责 |
| --- | --- |
| 保留用户原话和来源消息 | 直接查代码 |
| 生成有效问题 `resolvedQuery` | 直接查 MCP |
| 区分 fact / user claim / hypothesis / unknown | 生成最终回答 |
| 构建 `AnswerGoal.mustAnswerItems` | 选择 evidence |
| Preflight 追问或放行 | 审核 Worker 结果 |

## 输入与输出

| 输入 | 输出 |
| --- | --- |
| 当前 user message | `ResolvedTurnContext` |
| 当前 case recent messages | `AnswerGoal` |
| workspace 和权限配置 | `PreflightDecision` |
| model-assisted preflight 可选结果 | 可派发的 `DiagnosticRequest` 草稿 |

## 正常流程

```text
用户原话
  -> buildResolvedTurnContext
  -> buildAnswerGoal
  -> Preflight Gate
     -> ask_user
     -> dispatch
```

Preflight 的判断标准不是“信息是否完整”，而是“是否能在当前 workspace 和权限边界内形成一个安全、具体、可验证的下一步”。

## 失败/降级

| 场景 | 行为 |
| --- | --- |
| 用户输入太宽泛 | 只追问一个最高价值问题 |
| 用户回答“不清楚” | 记录为 unknown，不编造事实 |
| 模型 Preflight 失败 | 记录失败并降级到 deterministic local preflight |
| 模型把假设升为事实 | 本地 reconciler 不允许提升 |
| 缺少 workspace 或权限不清 | 追问或升级人工，不派发 Worker |

## 代码入口

- `src/runtime/resolved-turn.ts`
- `src/runtime/answer-goal.ts`
- `src/runtime/preflight-gate.ts`
- `src/runtime/preflight-decision.ts`
- `src/runtime/preflight-service.ts`
- `src/runtime/request-builder.ts`
- `src/sessions/context-builder.ts`

## 不负责什么

- 不决定知识证据是否足够直答。
- 不调用 Claude Code 或 MCP。
- 不把 `answerGoal.diagnosticObjective` 暴露给用户。
- 不用自然语言问法列表选择主结论。
