# 核心契约

## 读者先看

本功能说明 Runtime 阶段之间传递哪些对象。对象契约比流程图更重要：只要这些契约不乱，功能块可以独立演进。

## 功能边界

| 负责 | 不负责 |
| --- | --- |
| 说明核心对象用途 | 定义 TypeScript 全量字段 |
| 说明对象从哪里来、到哪里去 | 替代源码类型 |
| 标明用户可见和内部字段边界 | 解释每个实现分支 |

## 输入与输出

| 对象 | 产生方 | 消费方 |
| --- | --- | --- |
| `ResolvedTurnContext` | resolved-turn builder | AnswerGoal、Preflight、Experience、Knowledge、Worker |
| `AnswerGoal` | answer-goal builder | Knowledge、Worker、Review、Presentation |
| `DiagnosticRequest` | request builder | Worker、event logs |
| `DiagnosticResult` | Experience、Knowledge、Worker | Result Validator、Review Gate |
| `Evidence` | Knowledge、Worker、manual/history | claims、Review、Presentation |
| `DiagnosticClaim` | Experience、Knowledge、Worker | Result Validator、Review Gate |
| `ValidatedDiagnosticResult` | Result Validator | Review Gate、Presentation |
| Presentation output | Presentation model 或 fallback | helper message |
| `DiagnosticLogEvent` | EventRecorder | `/api/logs`、UI log drawer |

## 正常流程

```text
CaseMessage(user)
  -> ResolvedTurnContext
  -> AnswerGoal
  -> DiagnosticRequest
  -> DiagnosticResult
  -> ValidatedDiagnosticResult
  -> Presentation output
  -> CaseMessage(helper)
```

## 关键对象

### ResolvedTurnContext

- `latestUserMessage`：用户原话。
- `resolvedQuery`：当前有效问题，是 Experience、Knowledge Router、Retrieval、Deep Query、`DiagnosticRequest.userGoal` 和 Worker 的共同查询基础。
- `confirmedFacts`：当前 case 中已确认事实。
- `userClaims` / `hypotheses` / `unknowns`：不能被自动提升为事实。

### AnswerGoal

- 用户可见回答目标的唯一权威。
- `mustAnswerItems` 表示最终回答必须覆盖的项目。
- `diagnosticObjective` 只服务内部排查，不进入用户主答或 `directAnswer`。

### DiagnosticRequest

- Worker 的唯一输入契约。
- 包含 case/run/workspace、`answerGoal`、known facts、unknowns、constraints、allowed MCP tools 和 bounded context。
- 首轮和 follow-up 都必须由 `request-builder.ts` 构造。

### DiagnosticResult 与 DiagnosticClaim

- `DiagnosticResult` 是所有答案来源返回给 Review 的统一结果。
- `DiagnosticClaim` 必须有 `type`、`role`、`answers` 和 evidence 引用边界。
- fact claim 必须有证据；无 evidence 的 fact 必须拒绝或降级。

### ValidatedDiagnosticResult

- Result Validator 的冻结输出。
- 包含 accepted/rejected claim IDs、accepted primary answer claim IDs 和 validation issues。
- Review Gate 基于它决定 case status 和用户可见 decision。

### Presentation Output Contract

Presentation model 只能返回：

```json
{
  "answerTarget": "...",
  "directAnswer": "...",
  "reply": "...",
  "claimIds": ["claim_1"],
  "evidenceIds": ["ev_1"],
  "directAnswerClaimIds": ["claim_1"]
}
```

其中 `directAnswerClaimIds` 必须等于冻结的 accepted primary answer claim IDs。`reply` 只能表达 accepted claims/evidence/missingInfo。

## 失败/降级

| 场景 | 行为 |
| --- | --- |
| claim 引用不存在的 evidence | Result Validator 拒绝 |
| fact 证据强度不足 | 降级或拒绝 |
| final_answer 缺 primary answer | 不能 final |
| Presentation 输出不合法 | 使用 fallback presenter |
| helper reply 包含未审核事实 | 校验失败，不能使用模型输出 |

## 代码入口

- `src/domain.ts`
- `src/runtime/resolved-turn.ts`
- `src/runtime/answer-goal.ts`
- `src/runtime/request-builder.ts`
- `src/runtime/result-validator.ts`
- `src/runtime/review-gate.ts`
- `src/runtime/review-presentation.ts`
- `src/runtime/presenter.ts`

## 不负责什么

- 不描述 HTTP response DTO shape。
- 不定义 knowledge artifact shape。
- 不允许 Presentation 修改 Review 冻结结果。
- 不允许 Worker 或 MCP 直接产出用户最终回复。
