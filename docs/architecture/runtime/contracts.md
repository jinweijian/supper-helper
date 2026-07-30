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
| `AnswerGoalCompletenessReview` | 独立 completeness reviewer | Preflight reconcile |
| `AnswerCoverageReview` | 独立 coverage reviewer | Result Validator、Review Gate |
| `SafeFrozenAnswerProjection` | Runtime materializer | Presentation model 与 fallback renderer |
| Presentation plan | Presentation model | safe renderer |
| `DiagnosticLogEvent` | EventRecorder | `/api/logs`、UI log drawer |

## 正常流程

```text
CaseMessage(user)
  -> ResolvedTurnContext
  -> AnswerGoal
  -> DiagnosticRequest
  -> DiagnosticResult
  -> independent coverage review
  -> reviewed ID selection
  -> SafeFrozenAnswerProjection
  -> Presentation plan / deterministic fallback
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
- `mustAnswerItems` 由 Preflight proposer 提出，再由独立
  `answer-goal-completeness` reviewer 审核；不使用“哪里/多久/怎么”等关键词配对。
- 形状、范围或完整性失败时整组回退不可见 sentinel `direct_answer`。
- `diagnosticObjective` 只服务内部排查，不进入用户主答或 `directAnswer`。

### DiagnosticRequest

- Worker 的唯一输入契约。
- 包含 case/run/workspace、`answerGoal`、known facts、unknowns、constraints、allowed MCP tools 和 bounded context。
- 首轮和 follow-up 都必须由 `request-builder.ts` 构造。

### DiagnosticResult 与 DiagnosticClaim

- `DiagnosticResult` 是所有答案来源返回给 Review 的统一结果。
- `DiagnosticClaim` 必须有 `type`、`role`、`answers` 和 evidence 引用边界。
- fact claim 必须有证据；无 evidence 的 fact 必须拒绝或降级。

### ValidatedDiagnosticResult 与 AnswerCoverageReview

- producer 的 `claim.answers` 只是候选声明，不能自证覆盖。
- reviewer 只接收 source-neutral、有界、已清洗的 claim/evidence segments，不接收 raw
  `Evidence.summary/source`、trace、provider payload 或完整 retrieval text。
- 多个 accepted primary claims 可联合覆盖 items；`fullQuestionClaimIds` 指定完整回答中不可省略的条件、限制或时效 claim。
- Review Gate 基于它决定 case status 和用户可见 decision。

### SafeFrozenAnswerProjection

- Runtime 在 Presentation 前完成 selection、freshness、脱敏、bounds 和 prompt-safety review。
- Knowledge 只接受当前 active v4 generation；Workspace/Log 要求 same-run；MCP 要求当前
  allowlisted read-only call；不可重验的 history 不生成 coverage segment。
- Renderer 的函数签名只接受安全投影、persona 与可选 plan，不能回查 raw result。

### Presentation Output Contract（安全 ID Plan）

Presentation model 只能排序已冻结 ID：

```json
{
  "claimIds": ["claim_1"],
  "evidenceIds": ["ev_1"],
  "directAnswerClaimIds": ["claim_1"],
  "actionClaimIds": ["action_1"]
}
```

模型不能返回自由回复、`answerTarget`、outcome 或新事实。`directAnswerClaimIds` 与
`actionClaimIds` 必须等于安全投影的 required 集合；不合法时 deterministic renderer 使用同一投影。

## 失败/降级

| 场景 | 行为 |
| --- | --- |
| claim 引用不存在的 evidence | Result Validator 拒绝 |
| fact 证据强度不足 | 降级或拒绝 |
| final_answer 缺 primary answer | 不能 final |
| Presentation 输出不合法 | 使用 fallback presenter |
| completeness reviewer 不可用 | 整组 items 回退 sentinel |
| coverage reviewer 不可用/缺 binding | 不能 final |
| opaque prompt reviewer 不可用 | 未明确接受的追问不可见 |
| helper reply 包含 secret/path/trace | whole-reply scan 阻断或脱敏 |

## 代码入口

- `src/domain.ts`
- `src/runtime/resolved-turn.ts`
- `src/runtime/answer-goal.ts`
- `src/runtime/request-builder.ts`
- `src/runtime/result-validator.ts`
- `src/runtime/answer-goal-completeness-review-service.ts`
- `src/runtime/answer-coverage-service.ts`
- `src/runtime/safe-answer-projection.ts`
- `src/runtime/safe-answer-renderer.ts`
- `src/runtime/review-gate.ts`
- `src/runtime/review-presentation.ts`

## 不负责什么

- 不描述 HTTP response DTO shape。
- 不定义 knowledge artifact shape。
- 不允许 Presentation 修改 Review 冻结结果。
- 不允许 Worker 或 MCP 直接产出用户最终回复。
