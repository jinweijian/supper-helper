# Implementation Evidence

## Task Evidence

### Task 1.1 — AcceptedUserTurn 与消息 ID completion

**红灯命令：** `pnpm build && node --test test/turn-presentation-integrity.test.mjs`
**红灯失败断言：**
- `startUserTurn returns AcceptedUserTurn exposing userMessageId` — `turn.userMessageId` 为 `undefined`（现有 `startUserTurn` 返回 `StoredCase`，无 `userMessageId` 字段），`typeof undefined !== 'string'` 失败。
- `completeUserTurn consumes message ID and binds replyToMessageId` — `turn.caseSession` 为 `undefined`（`StoredCase` 无 `caseSession` 属性），`Cannot read properties of undefined (reading 'id')`。
- 其余两个测试同理因 `AcceptedUserTurn` 接口缺失而 TypeError。

**实现改动：**
- `src/runtime/contracts.ts`：新增 `AcceptedUserTurn { caseSession: StoredCase; userMessageId: string }`。
- `src/runtime/session-lifecycle.ts`：`startUserTurn` 捕获 `store.addMessage` 返回值并返回 `{ caseSession, userMessageId: userMessage.id }`；删除 `pendingUserMessageId`（按正文匹配），新增 `userMessageBody(caseSession, userMessageId)` 按 ID 查正文，找不到则抛错。
- `src/runtime/diagnostic-runtime.ts`：`startUserTurn` 返回 `AcceptedUserTurn`；`completeUserTurn(caseId, userMessageId)` 改为按 ID 完成；`completeUserTurnNow` 通过 `userMessageBody` 读取正文、`replyToMessageId = userMessageId`。
- `src/gateway/routes/chat-routes.ts`：async 路径改用 `turn.caseSession` / `turn.userMessageId`，不再从 `caseSession.messages.at(-1)?.id` 提取。

**绿灯命令：** `pnpm build && node --test test/turn-presentation-integrity.test.mjs`
**绿灯结果：** 4/4 通过。

**既有 sync/async shape 测试不变：**
- `test/supper-helper.test.mjs`：`sync and async chat flows use the same runtime pipeline`、`async same-case turns receive ordered reply-to helper messages`、`async turn failures can reply to the accepted user message` 调用迁移到新接口，shape 断言不变。
- `test/conversation-evidence-lifecycle.test.mjs`：`accepted.updatedAt` → `accepted.caseSession.updatedAt`，`completeUserTurn(accepted.id, body)` → `completeUserTurn(accepted.caseSession.id, accepted.userMessageId)`。
- 全量 `node --test test/*.test.mjs`：342 pass / 0 fail（原 338 + 新 4）。
- `pnpm lint` 通过；`pnpm typecheck` 通过。

**生产调用链：**
- sync: `Gateway /api/chat` → `DiagnosticRuntime.handleUserMessage` → `startUserTurn`（返回 `AcceptedUserTurn`）→ `completeUserTurn(caseId, userMessageId)` → `completeUserTurnNow` → `userMessageBody` 读取正文 → preflight/experience/knowledge/worker → `addMessage(replyToMessageId = userMessageId)`。
- async: `Gateway /api/chat { async: true }` → `startUserTurn` → 202 返回 `userMessageId` → 后台 `completeUserTurn(caseId, userMessageId)`。

### Task 1.2 — TurnContextSnapshot 与阶段上下文隔离

**红灯命令：** `pnpm build && node --test test/turn-presentation-integrity.test.mjs`
**红灯失败断言：**
- `first turn context excludes the second accepted message` — `recentMessageBodies` 包含第二条消息正文 `'请检查项目的配置加载是否可诊断。'`（现有 `completeUserTurnNow` 使用 live caseSession，`buildResolvedTurnContext`/`buildDiagnosticRequestContext` 读取全部 messages）。
- `second turn context excludes later runs` — `recentMessageBodies` 包含第一轮 helper reply 正文（第一轮 reply 在第二轮 cutoff 之前已被追加到 live case）。

**实现改动：**
- `src/sessions/turn-context-snapshot.ts`（新建）：`WeakMap<CaseSession, string>` 绑定 cutoff userMessageId；`turnMessages`/`turnUserMessages`/`turnUserMessageCount` 返回 cutoff 之前的 messages；`turnRuns` 按 `run.request.answerGoal.sourceMessageIds` 是否全在 cutoff 之前过滤 runs。无 cutoff 时返回全量（兼容旧调用与直接测试）。
- `src/runtime/diagnostic-runtime.ts`：`completeUserTurnNow` 在决策管线前 `bindTurnContextCutoff(caseSession, userMessageId)`，`finally` 中 `clearTurnContextCutoff`；持久化（addMessage/saveCase）仍写 live case。
- `src/runtime/resolved-turn.ts`：`buildResolvedTurnContext` 用 `turnUserMessages` 取用户消息，`turnRuns` 判断 `isFollowUp`。
- `src/sessions/context-builder.ts`：`buildDiagnosticRequestContext` 用 `turnMessages`/`turnRuns`/`turnUserMessageCount`。
- `src/runtime/preflight-decision.ts`：`preflight` 用 `turnMessages` 取 contextText 与 pending helper question。
- `src/runtime/preflight-service.ts`：model preflight `messages` 用 `turnMessages(caseSession).slice(-8)`。
- `src/runtime/request-builder.ts`：`buildDiagnosticRequestFromResolvedTurn` 的 `recentMessages` 用 `turnMessages`。
- `src/runtime/case-curator.ts`：`latestRunWithResult`/`originalUserQuestion`/`latestHelperReply`/`restrictedCase` 用 `turnRuns`/`turnMessages`。

**模块边界：** `turn-context-snapshot.ts` 放在 `src/sessions/`（操作 StoredCase 消息/runs 过滤），runtime 单向依赖 sessions，sessions 不反向依赖 runtime。

**绿灯命令：** `pnpm build && node --test test/turn-presentation-integrity.test.mjs test/supper-helper.test.mjs`
**绿灯结果：** turn-presentation-integrity 6/6 通过；supper-helper 108/108 通过；全量 `node --test test/*.test.mjs` 344/344 pass / 0 fail；`pnpm lint` 通过；`pnpm typecheck` 通过。

**两条 request 摘要（不保存原始敏感正文）：**
- 第一轮 request：`recentMessages` = [msg_A_body]，`sourceMessageIds` = [msg_A_id]，`currentUserMessage` = msg_A_body。
- 第二轮 request：`recentMessages` = [msg_A_body, msg_B_body]（不含 helper reply），`sourceMessageIds` = [msg_A_id, msg_B_id]，`previousRuns` 含 `run_01`。

### Task 2.1 / 2.2 — ID-only PresentationPlan 与确定性渲染

**红灯命令：** `pnpm build && node --test test/turn-presentation-integrity.test.mjs`
**红灯失败断言（4 条 focused tests）：**
- `deterministic presentation blocks extra facts` — 模型返回合法 IDs 但 reply 含 "Redis 缓存"（现有 validator 不检查新增事实），`doesNotMatch /Redis/` 失败。
- `Q2 keyword does not trigger fixed template` — `ruleBasedReviewAndFormat` 中 Q2 正则触发 `formatQ2Result`，输出 `# Q2 分析结果`，`doesNotMatch` 失败。
- `process_note never enters visible reply` — 模型选择 process_note claim 并在 reply 含 "内部路由分数为 0.85"，`doesNotMatch` 失败。
- `judge score does not leak` — 模型 reply 含 "Evidence Judge 分数：0.92"，`doesNotMatch` 失败。

**实现改动：**
- `src/runtime/presenter.ts`：新增 `PresentationPlan` 接口与 `renderPresentationPlan`（从 selected claim 原文确定性渲染，过滤 process_note，非 developer 脱敏 src/）；`ruleBasedReviewAndFormat` 删除 Q2 正则分支；`selectGroundedPrimaryClaim` 过滤 process_note；删除 `formatQ2Result`。
- `src/runtime/review-presentation.ts`：`modelDrivenPresentation` prompt 改为 `PresentationPlan`（禁止 `reply`/process_note）；`validateModelPresentation` 删除所有 reply 文本校验，保留 ID 校验 + process_note 拒绝；返回 `renderPresentationPlan` 而非 `validated.reply`。

**被阻止字符串：** "Redis 缓存"（新增事实）、"# Q2 分析结果"（固定模板）、"内部路由分数"（process_note）、"Evidence Judge 分数"（内部评分）。

**绿灯结果：** 36/36 通过；`pnpm typecheck` 通过；全量 348/348 pass / 0 fail；`pnpm lint` 通过。既有 model presentation 测试断言适配 claim 原文（`课程管理、学员管理`）。

记录真实模型是否执行；未执行时写明缺少的凭证、未覆盖行为和风险。

### Task 3.1 — Case-scoped Claude session 文档统一

**红灯：** `agent docs describe Case-scoped Claude session, not per-run disposable` — `main.md` 含 "per run and disposable" 和 `per_run_session: true`、`worker_session_persistence: false`，断言 `doesNotMatch /per run and disposable/` 和 `Case-scoped` 缺失失败。

**删除的冲突陈述：**
- `main.md:535` "Claude Code worker sessions are per run and disposable." → 替换为 "Claude Code worker sessions are Case-scoped: the first run creates a session with `--session-id`, and follow-up runs in the same Case reuse it with `--resume`. Each run still receives the complete authoritative `DiagnosticRequest`; session memory is subordinate to the current request. Different Cases never share a session."
- `main.md:594` `per_run_session: true` → `case_scoped_session: true`
- `main.md:605` `worker_session_persistence: false` → `worker_session_scope: case` / `worker_session_persistence: case_scoped_reuse`

**保留的权威记忆规则：**
- `claude-prompts.ts:15` "Reuse the current Claude session context, but trust the DiagnosticRequest.answerGoal" — 保留。
- `claude-prompts.ts:22` "If current userGoal conflicts with previous session memory, prefer current userGoal and the explicit DiagnosticRequest.context" — 保留。
- `claude-code-worker.ts:117-120` `sessionArgs`：`run_01` → `--session-id`，后续 → `--resume` — 代码已正确，无需改动。
- 既有测试 `Claude Code worker reuses the per-case Claude session` / `resumes an existing Claude session on follow-up runs` — 断言不变且通过。

**绿灯结果：** doc consistency tests 2/2 通过；`pnpm lint` 通过；全量 350/350 pass / 0 fail。

### Task 3.2 — 生产路径与全量回归

**命令：** `pnpm lint && pnpm typecheck && pnpm build && pnpm test`
**退出码：** 0（全部通过）
- `pnpm lint` → Docs lint passed（退出码 0）
- `pnpm typecheck` → tsc --noEmit 无错误（退出码 0）
- `pnpm build` → rm -rf dist && tsc -p tsconfig.build.json 无错误（退出码 0）
- `pnpm test` → 350 tests / 350 pass / 0 fail（退出码 0）

**公开 shape 保持验证（关键测试名）：**
- `/api/chat` sync：`sync first turn and async unknown follow-up share one resolved query across runtime stages`
- `/api/chat` async：`async chat accepts immediately, stores progress, and exposes context usage`、`async same-case turns receive ordered reply-to helper messages`、`async turn failures can reply to the accepted user message`
- session history：`session API exposes knowledge health for the current workspace`、`session lifecycle supports title refresh, pin, archive, reject, and delete`、`session API recovers stale in-progress runs`
- knowledge：`knowledge bind API initializes a service knowledge workspace shared by sessions`、`knowledge reindex API initializes the service workspace before rebuilding indexes`
- worker/review/presentation：`model presentation reply is used and preserves multiple reviewed claims`、`unsafe model presentation reply falls back to reviewed local formatting`、`presentation cannot promote partial outcome or render nonexistent evidence claims`、`worker failure fallback never copies raw stdout stderr or secrets into main reply`

**外部显式验收状态：** 未执行。缺少真实模型 API 凭证（测试使用 `https://api.example.test/v1` mock）。影响：确定性 `renderPresentationPlan` 路径通过 HTTP stub 验证（mock `globalThis.fetch` 返回 `PresentationPlan` JSON），但未在真实模型（MiniMax/OpenAI-compatible）端到端验证模型是否稳定返回 `PresentationPlan` 而非自由 `reply`。风险：真实模型可能返回不合规 JSON（无 claimIds），此时 `validateModelPresentation` 返回 `undefined`，fallback 到 `ruleBasedReviewAndFormat`——此降级路径已由 `malformed JSON` 测试覆盖。

## Anti-Fake-Complete Review

### 逐项追踪（从真实 `/api/chat` 到最终回复）

**消息 ID 流：** `Gateway /api/chat` async → `DiagnosticRuntime.startUserTurn` 返回 `AcceptedUserTurn { caseSession, userMessageId }`（`session-lifecycle.ts` 捕获 `addMessage` 返回值）→ 202 返回 `userMessageId` → 后台 `completeUserTurn(caseId, userMessageId)` → `completeUserTurnNow` 调用 `userMessageBody(caseSession, userMessageId)` 按 ID 读取正文 → `replyToMessageId = userMessageId`。已验证 `pendingUserMessageId`（按正文匹配）从 src 和 dist 中完全删除（`grep` 零结果）。

**Snapshot 流：** `completeUserTurnNow` → `bindTurnContextCutoff(caseSession, userMessageId)` → `runTurnPipeline` → Preflight/Experience/Knowledge/Worker 各阶段通过 `turnMessages`/`turnRuns`/`turnUserMessageCount` 读取 cutoff 之前的消息/runs → 持久化（`addMessage`/`addRun`/`saveCase`）仍写 live case（store 方法直接操作 `caseSession.messages`/`.runs` 数组，不受 cutoff 影响）→ `finally` 中 `clearTurnContextCutoff`。已验证 `bindTurnContextCutoff` 在 `dist/diagnostic-runtime.js:66` 生产代码中被调用。

**AnswerGoal：** `buildAnswerGoal` 从 `buildResolvedTurnContext` 获取 `resolvedTurn`，后者使用 `turnUserMessages`（cutoff-bounded）。`sourceMessageIds` 只含 cutoff 之前的用户消息 ID。

**Worker request：** `buildDiagnosticRequest` → `buildResolvedTurnContext`（cutoff）→ `buildDiagnosticRequestFromResolvedTurn`（`recentMessages` 用 `turnMessages`）→ `attachCaseContext`（`buildDiagnosticRequestContext` 用 `turnMessages`/`turnRuns`/`turnUserMessageCount`）。Worker 收到的 request 只含 cutoff 之前的上下文。

**Selected claims → 最终回复：** Model 返回 `PresentationPlan`（无 `reply`）→ `validateModelPresentation` 校验 IDs（accepted、evidence 覆盖、directAnswerClaimIds 匹配、process_note 拒绝）→ `renderPresentationPlan` 从 selected claim 原文确定性渲染（`**结论：** primary_answers`；`**定位依据：** supporting`；`**下一步：** next_action`；`**仍需确认：** missingInfo`）。process_note claim 被过滤。非 developer persona 通过 `sanitizeForPersona` 脱敏。

### 主动构造场景验证

| 场景 | 测试 | 结果 |
| --- | --- | --- |
| 后发消息串线 | `first turn context excludes the second accepted message` | 第一轮 `recentMessages`/`sourceMessageIds` 不含第二条 ✓ |
| 后发 run 泄漏 | `second turn context excludes later runs` | 第二轮 `recentMessages` 不含第一轮 helper reply ✓ |
| 相同正文绑定 | `two identical-body messages bind to distinct message IDs` | `replyToMessageId` 绑定到正确 ID ✓ |
| 恶意模型新增事实 | `deterministic presentation blocks extra facts` | "Redis 缓存"被阻止，只渲染 claim 原文 ✓ |
| Q2 关键词特判 | `Q2 keyword in result does not trigger a fixed Q2 template` | 不输出 `# Q2 分析结果`，用 persona renderer ✓ |
| process_note 泄漏 | `process_note claim never enters the visible reply projection` | process_note 不被选择也不被渲染 ✓ |
| Judge score 泄漏 | `evidence judge score does not leak into the visible reply` | 分数不进入确定性渲染输出 ✓ |

### 测试是否只打 mock/旧 formatter

- 所有 model presentation 测试通过 `globalThis.fetch` mock + 真实 `DiagnosticRuntime` + `FileMemoryStore`，走完整 `reviewAndFormat` → `modelDrivenPresentation` → `validateModelPresentation` → `renderPresentationPlan` 生产路径（已验证 `renderPresentationPlan` 在 `dist/review-presentation.js:115` 被调用）。
- Fallback 测试（无 modelProvider）走 `ruleBasedReviewAndFormat` → `formatPersonaReply` 生产路径。
- `formatQ2Result` 和 `pendingUserMessageId` 从 src 和 dist 中完全删除（`grep` 零结果），不存在旧 formatter 回退路径。

### 当前实现是否合理、仍有何风险

**合理：**
- TurnContextSnapshot 使用 WeakMap 不改变 StoredCase 持久化 shape，cutoff 只影响读取不影响写入。
- PresentationPlan 移除模型自由文本生成权，确定性渲染只引用 claim 原文，从根本上阻止新增事实。
- process_note 在 validator（拒绝选择）和 renderer（过滤渲染）双重防护。

**剩余风险：**
- 真实模型端到端未验（无 API 凭证）。真实模型可能不稳定返回 `PresentationPlan`；若返回不合规 JSON（无 claimIds），`validateModelPresentation` 返回 `undefined`，fallback 到 `ruleBasedReviewAndFormat`——此降级路径已由 `malformed JSON` 测试覆盖，但未在真实模型上验证 fallback 触发频率。
- `renderPresentationPlan` 不渲染 evidence summary（只渲染 claim 原文）。这是设计决策（evidence 在日志层），但用户可能期望看到证据来源。当前通过 claim 原文间接包含证据信息。

### 提交前隔离验证

- 将暂存区补丁应用到基于 `86efac1` 的临时 detached worktree，不包含工作目录中其他未暂存改动。
- 运行 `pnpm test`：347 tests / 347 pass / 0 fail / 0 skipped / 0 todo，退出码 0。
- 当前完整工作目录的同一命令为 350/350；多出的 3 项来自未纳入本 change 提交的既有未暂存测试改动，因此不作为本 change 独立提交的通过数量。
