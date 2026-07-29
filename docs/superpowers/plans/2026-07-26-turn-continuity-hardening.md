# Turn Continuity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除“用户刚提问就被前端判定为回答中断”的竞态，并保证任何诊断分支都只在正式 helper 回复已经持久化后向外暴露终态。

**Architecture:** Gateway 只负责把持久化状态投影为公开 DTO；Runtime 的 Review 只冻结结果、决策与目标 case status，不再提前修改 case；所有会产生最终答复的分支统一通过一个 Runtime 完成器，按“准备展示事件 → helper 消息 → 最终回复事件 → case 终态”的顺序提交。Web 轮询以正式回复或明确的 `retryableTurn` 为终止依据，并使用 `AbortSignal` 与轮询代次隔离陈旧响应。

**Tech Stack:** TypeScript、Node.js、Vue 3 Composition API、Vitest、Node Test Runner、Playwright。

## Global Constraints

- 遵守 `docs/standards/development.md` 与 `docs/standards/module-boundaries.md`；状态修复不得写进 Gateway route。
- 不改变持久化 case 顶层 JSON shape，不改变 `/api/chat`、`/api/session` 既有 response shape。
- 不把普通 terminal status 瞬间当作中断；只有 `retryableTurn` 或 HTTP/超时错误可以进入中断/重连 UI。
- Runtime 最终回复仍由 Presentation 生成，worker 不得直接回复用户。
- 每个任务先写失败测试，再写最小实现；不要顺手重构不相关代码。

---

## File Map

| 文件 | 责任 |
| --- | --- |
| `src/gateway/dto.ts` | 公开 session status 投影，当前活跃回合优先于旧 Run 结果 |
| `src/runtime/contracts.ts` | `ReviewPresentationResult` 携带冻结的 `caseStatus` |
| `src/runtime/review-presentation.ts` | 校验 Run 并计算目标状态，但不提前写 case 终态 |
| `src/runtime/turn-completion.ts` | 新增统一的正式回复/终态提交出口 |
| `src/runtime/diagnostic-runtime.ts` | MCP 与 worker 分支使用统一完成器 |
| `src/runtime/experience-turn.ts` | Experience 命中分支使用统一完成器 |
| `src/runtime/knowledge-turn.ts` | Knowledge 直答分支使用统一完成器 |
| `src/runtime/worker-diagnosis.ts` | worker 阶段保持活跃状态，不提前暴露终态 |
| `src/runtime/session-lifecycle.ts` | 真实异常按 helper 回复先于 terminal status 的顺序记录 |
| `web/src/dashboard/use-chat.ts` | 可取消、代次安全、以回复为准的轮询状态机 |
| `web/src/dashboard/App.vue` | 切换会话和卸载时取消轮询，只保留一处聊天错误反馈 |
| `test/supper-helper.test.mjs` | Gateway 状态投影与真实失败持久化回归 |
| `test/turn-presentation-integrity.test.mjs` | Runtime 提交顺序与各诊断分支回归 |
| `web/src/dashboard/composables.test.ts` | 轮询竞态、取消与陈旧响应回归 |
| `e2e/web-smoke.spec.ts` | 浏览器层“提问不会立即中断”验收 |

---

### Task 1: 让当前活跃回合状态覆盖历史 Run 结果

**Files:**

- Modify: `test/supper-helper.test.mjs`
- Modify: `src/gateway/dto.ts`

- [ ] **Step 1: 写一个会失败的 Gateway DTO 回归测试**

在 `test/supper-helper.test.mjs` 的 session summary 测试附近增加：

```js
test('session summary keeps a newly accepted turn active despite an older terminal run', () => {
  const summary = sessionSummary({
    id: 'case_turn_race',
    claudeSessionId: 'claude-session',
    tenantId: 'local',
    userId: 'local-user',
    workspaceId: 'current',
    title: '继续追问',
    status: 'ready_for_diagnosis',
    userPersona: 'operations',
    messages: [{ id: 'msg_new', role: 'user', body: '新的问题' }],
    runs: [{
      id: 'run_old',
      caseId: 'case_turn_race',
      status: 'partial',
      result: {
        status: 'partial',
        summary: '旧回合',
        evidence: [],
        claims: [],
        missingInfo: ['旧信息'],
        recommendedNextAction: 'ask_user',
      },
    }],
    logs: [],
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:01.000Z',
  });

  assert.equal(summary.status, 'ready_for_diagnosis');
});
```

- [ ] **Step 2: 运行目标测试，确认现有实现会错误返回旧终态**

Run:

```bash
pnpm build
node --test --test-name-pattern="newly accepted turn active" test/supper-helper.test.mjs
```

Expected: FAIL，实际 status 为 `partial`。

- [ ] **Step 3: 最小修改公开状态投影**

在 `src/gateway/dto.ts` 中先判断 case 当前活跃状态，再考虑 Run：

```ts
const ACTIVE_CASE_STATUSES: StoredCase['status'][] = [
  'ready_for_diagnosis',
  'queued',
  'diagnosing',
];

function publicSessionStatus(caseSession: StoredCase): StoredCase['status'] {
  if (ACTIVE_CASE_STATUSES.includes(caseSession.status)) {
    return caseSession.status;
  }

  const latestResult = [...caseSession.runs].reverse().find((run) => run.result)?.result;
  return latestResult ? caseStatusFromDiagnosticResult(latestResult) : caseSession.status;
}
```

保留“已完成回合由审核后 Run 结果纠正公开状态”的能力。

- [ ] **Step 4: 运行目标测试和类型检查**

Run:

```bash
pnpm build
node --test --test-name-pattern="session summary" test/supper-helper.test.mjs
pnpm typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add src/gateway/dto.ts test/supper-helper.test.mjs
git commit -m "fix: keep accepted turns active in session dto"
```

---

### Task 2: 把 Review 的目标 case status 变成显式 contract

**Files:**

- Modify: `src/runtime/contracts.ts`
- Modify: `src/runtime/review-presentation.ts`
- Modify: `test/turn-presentation-integrity.test.mjs`

- [ ] **Step 1: 写一个会失败的 Review 副作用测试**

在 `test/turn-presentation-integrity.test.mjs` 增加测试，构造 `caseSession.status = 'diagnosing'`、一个可得出 `concluded` 的结果，调用 `reviewAndFormat` 后断言：

```js
assert.equal(caseSession.status, 'diagnosing');
assert.equal(review.caseStatus, 'concluded');
assert.equal(run.status, 'concluded');
assert.equal(run.result.status, 'concluded');
```

测试名称使用：

```js
test('review freezes case status without publishing it before presentation', async () => {
```

- [ ] **Step 2: 运行目标测试，确认 Review 当前会提前改写 case**

Run:

```bash
pnpm build
node --test --test-name-pattern="freezes case status" test/turn-presentation-integrity.test.mjs
```

Expected: FAIL，`caseSession.status` 已被改成 terminal status，且 `review.caseStatus` 不存在。

- [ ] **Step 3: 扩展 Review contract**

在 `src/runtime/contracts.ts`：

```ts
export interface ReviewPresentationResult {
  reply: string;
  decision: RuntimeDecision;
  caseStatus: StoredCase['status'];
}
```

在 `src/runtime/review-presentation.ts`：

```ts
const caseStatus = caseStatusFromDiagnosticResult(validated);
```

删除：

```ts
caseSession.status = caseStatusFromDiagnosticResult(validated);
```

并在该方法的所有返回值中加入：

```ts
caseStatus,
```

- [ ] **Step 4: 运行目标测试和所有引用点的类型检查**

Run:

```bash
pnpm typecheck
pnpm build
node --test --test-name-pattern="freezes case status" test/turn-presentation-integrity.test.mjs
```

Expected: PASS；若类型检查指出手写 `ReviewPresentationResult` fixture 缺少 `caseStatus`，只补齐对应 fixture，不加兼容 optional 字段。

- [ ] **Step 5: 提交本任务**

```bash
git add src/runtime/contracts.ts src/runtime/review-presentation.ts test/turn-presentation-integrity.test.mjs
git commit -m "refactor: freeze reviewed case status in contract"
```

---

### Task 3: 新增 Runtime 正式回复完成器

**Files:**

- Create: `src/runtime/turn-completion.ts`
- Modify: `test/turn-presentation-integrity.test.mjs`

- [ ] **Step 1: 写一个会失败的提交顺序测试**

使用记录调用顺序的内存 repository/event recorder doubles，验证：

```js
assert.deepEqual(order, [
  'presentation_prepared',
  'helper_message',
  'final_reply_created',
  'terminal_status',
]);
assert.equal(caseSession.messages.at(-1).replyToMessageId, 'msg_user');
assert.equal(caseSession.status, 'concluded');
```

测试名称：

```js
test('turn completion persists the formal helper reply before terminal case status', () => {
```

- [ ] **Step 2: 运行目标测试，确认模块尚不存在**

Run:

```bash
pnpm build
node --test --test-name-pattern="formal helper reply before terminal" test/turn-presentation-integrity.test.mjs
```

Expected: FAIL，无法导入 `dist/runtime/turn-completion.js`。

- [ ] **Step 3: 实现单一完成出口**

创建 `src/runtime/turn-completion.ts`：

```ts
import type { StoredCase, CaseRepository } from '../sessions/case-repository.js';
import type { ReviewPresentationResult, RuntimeTurnResponse } from './contracts.js';
import type { CaseRuntimeEventRecorder } from './event-recorder.js';

export function completePresentedTurn(input: {
  store: CaseRepository;
  events: CaseRuntimeEventRecorder;
  caseSession: StoredCase;
  review: ReviewPresentationResult;
  replyToMessageId?: string;
}): RuntimeTurnResponse {
  const { store, events, caseSession, review, replyToMessageId } = input;
  events.presentationPrepared(caseSession, review.decision);
  store.addMessage(caseSession, {
    role: 'helper',
    body: review.reply,
    replyToMessageId,
  });
  events.finalReplyCreated(caseSession, review.reply, review.decision);
  caseSession.status = review.caseStatus;
  store.saveCase(caseSession);
  return {
    caseSession,
    assistantMessage: review.reply,
    decision: review.decision,
  };
}
```

注：repository 的 `addMessage` 和 event recorder 会各自落盘，因此 terminal status 的赋值必须保持在最后。

- [ ] **Step 4: 运行目标测试和类型检查**

Run:

```bash
pnpm typecheck
pnpm build
node --test --test-name-pattern="formal helper reply before terminal" test/turn-presentation-integrity.test.mjs
```

Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add src/runtime/turn-completion.ts test/turn-presentation-integrity.test.mjs
git commit -m "feat: centralize presented turn completion"
```

---

### Task 4: 所有诊断分支改用统一完成器

**Files:**

- Modify: `src/runtime/diagnostic-runtime.ts`
- Modify: `src/runtime/experience-turn.ts`
- Modify: `src/runtime/knowledge-turn.ts`
- Modify: `src/runtime/worker-diagnosis.ts`
- Modify: `test/turn-presentation-integrity.test.mjs`

- [ ] **Step 1: 为 Experience、Knowledge、MCP、Worker 四条路径写参数化回归**

每条路径都使用会在 `reviewAndFormat` 与 helper 持久化之间暂停的 fake reviewer/model；暂停期间重新从 repository 读取 case，断言：

```js
assert.ok(['ready_for_diagnosis', 'queued', 'diagnosing'].includes(snapshot.status));
assert.equal(snapshot.messages.some((message) =>
  message.role === 'helper' && message.replyToMessageId === 'msg_user'
), false);
```

释放暂停后断言：

```js
assert.equal(settled.status, expectedTerminalStatus);
assert.equal(formalReplies.length, 1);
```

- [ ] **Step 2: 运行回归，确认四个分支至少一条会提前暴露终态**

Run:

```bash
pnpm build
node --test --test-name-pattern="keeps .* active until formal reply" test/turn-presentation-integrity.test.mjs
```

Expected: FAIL。

- [ ] **Step 3: 替换 Experience 与 Knowledge 的分散提交逻辑**

在 `src/runtime/experience-turn.ts`：

- 创建 Run 时用 `status: 'running'`，先保持 `caseSession.status = 'diagnosing'`。
- 删除 Review 前的 `caseStatusFromDiagnosticResult` 写入。
- Review 后返回 `completePresentedTurn(...)`。

在 `src/runtime/knowledge-turn.ts` 做同样处理；保留知识检索/审核事件原顺序，只替换最终展示提交。

- [ ] **Step 4: 替换 MCP 与 Worker 的分散提交逻辑**

在 `src/runtime/diagnostic-runtime.ts`：

- MCP Run 创建后不把 case 改成结果终态。
- MCP 与 worker 的 Review 结果统一交给 `completePresentedTurn(...)`。

在 `src/runtime/worker-diagnosis.ts`：

- worker 返回后更新 `run.result`、`run.status` 与 trace，但继续让 `caseSession.status = 'diagnosing'`。
- follow-up 判断期间同样保持活跃。
- 删除 worker/follow-up 路径中的 terminal case 写入。

- [ ] **Step 5: 运行 Runtime 回归和完整服务端测试**

Run:

```bash
pnpm typecheck
pnpm build
node --test test/turn-presentation-integrity.test.mjs
pnpm test
```

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add src/runtime/diagnostic-runtime.ts src/runtime/experience-turn.ts src/runtime/knowledge-turn.ts src/runtime/worker-diagnosis.ts test/turn-presentation-integrity.test.mjs
git commit -m "fix: publish terminal state after formal reply"
```

---

### Task 5: 真实失败路径也遵守回复先于终态

**Files:**

- Modify: `src/runtime/session-lifecycle.ts`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: 写失败路径持久化顺序测试**

为 repository 建立 snapshot 记录，在调用 `recordTurnFailure` 后断言第一次出现 `partial` 的 snapshot 已经包含：

```js
{
  role: 'helper',
  replyToMessageId: 'msg_user',
}
```

同时断言只生成一个失败 helper 回复。

- [ ] **Step 2: 运行目标测试，确认当前实现先保存 `partial`**

Run:

```bash
pnpm build
node --test --test-name-pattern="failure reply before partial" test/supper-helper.test.mjs
```

Expected: FAIL。

- [ ] **Step 3: 调整失败提交顺序**

在 `src/runtime/session-lifecycle.ts` 中改为：

```ts
this.events.turnFailed(caseSession, message);
this.store.addMessage(caseSession, {
  role: 'helper',
  body: reply,
  replyToMessageId,
});
caseSession.status = 'partial';
this.store.saveCase(caseSession);
```

- [ ] **Step 4: 验证**

Run:

```bash
pnpm typecheck
pnpm build
node --test --test-name-pattern="failure reply before partial" test/supper-helper.test.mjs
```

Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add src/runtime/session-lifecycle.ts test/supper-helper.test.mjs
git commit -m "fix: persist failure reply before partial status"
```

---

### Task 6: 把 Web 轮询改为可取消、代次安全、以正式回复为准

**Files:**

- Modify: `web/src/dashboard/use-chat.ts`
- Modify: `web/src/dashboard/composables.test.ts`

- [ ] **Step 1: 把错误的 terminal-without-reply 测试改成竞态回归**

将现有“`partial` 立即中断”的测试改成：

```ts
it('keeps polling across a transient terminal snapshot until the matching reply appears', async () => {
  const fetcher = vi.fn()
    .mockImplementationOnce(() => response({ session: {
      id: 'case_a', status: 'partial',
      messages: [{ id: 'msg_user', role: 'user', body: '问题' }],
    } }))
    .mockImplementationOnce(() => response({ session: {
      id: 'case_a', status: 'concluded',
      messages: [
        { id: 'msg_user', role: 'user', body: '问题' },
        { id: 'msg_helper', role: 'helper', body: '正式回复', replyToMessageId: 'msg_user' },
      ],
    } }));

  const chat = useChat({ fetcher, pollDelayMs: 0, maxPolls: 2 });
  await expect(chat.poll('case_a', 'msg_user')).resolves.toMatchObject({ status: 'concluded' });
  expect(chat.progress.value.state).toBe('completed');
});
```

再增加：

- `retryableTurn` 优先进入 `interrupted`。
- 调用 `cancel()` 后 pending fetch 收到 `signal.aborted === true`。
- 新 poll 启动后，旧 poll 的晚到响应不能覆盖 `progress`。

- [ ] **Step 2: 运行 Web 单测，确认竞态与取消测试失败**

Run:

```bash
pnpm test:web -- web/src/dashboard/composables.test.ts
```

Expected: FAIL，现有代码仍会把 `partial` 判为中断，且没有公开 `cancel()`。

- [ ] **Step 3: 在每个聊天请求中透传 AbortSignal**

`apiJson` 已接受 `RequestInit`，保持签名不变；在 `use-chat.ts` 中为 POST 和每次 GET 显式传入 signal：

```ts
const request = jsonRequest('POST', { ...input, async: true });
const accepted = await apiJson<AcceptedTurn>(
  fetcher,
  '/api/chat',
  { ...request, signal },
);
```

GET 使用：

```ts
await apiJson<{ session: SessionDto }>(
  fetcher,
  `/api/session?caseId=${encodeURIComponent(caseId)}&includeKnowledgeHealth=false`,
  { signal },
);
```

- [ ] **Step 4: 实现代次隔离与明确的结束优先级**

在 `useChat` 内：

```ts
let generation = 0;

function cancel(): void {
  generation += 1;
  abortController?.abort();
  abortController = undefined;
}
```

每次 `send`、`poll`、`retry` 开始时创建本轮 `currentGeneration`；任何异步返回后先判断：

```ts
if (signal.aborted || currentGeneration !== generation) {
  throw new DOMException('aborted', 'AbortError');
}
```

单次快照按以下顺序判定：

```ts
if (hasHelperReply(session, userMessageId)) complete();
else if (session.retryableTurn?.userMessageId === userMessageId) interrupt();
else continuePolling();
```

删除“只要 session status 非活跃就立即中断”的分支。达到 `maxPolls` 才报告超时；网络异常继续使用 reconnecting/backoff。

- [ ] **Step 5: 暴露 cancel 并跑 Web 回归**

返回：

```ts
return { sending, error, progress, send, poll, retry, cancel };
```

Run:

```bash
pnpm typecheck:web
pnpm test:web -- web/src/dashboard/composables.test.ts
pnpm test:web
```

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add web/src/dashboard/use-chat.ts web/src/dashboard/composables.test.ts
git commit -m "fix: make chat polling reply-driven and cancellable"
```

---

### Task 7: 在页面生命周期中取消旧轮询并去掉重复错误横幅

**Files:**

- Modify: `web/src/dashboard/App.vue`
- Modify: `web/src/dashboard/ChatPanel.vue`
- Modify: `web/src/dashboard/ChatProgressCard.vue`
- Modify: `web/src/dashboard/ChatProgressCard.test.ts`

- [ ] **Step 1: 写组件行为测试**

增加断言：

- 普通聊天错误只在 `ChatProgressCard`/composer 区域显示，不渲染顶端 `.global-error`。
- 切换会话前调用 `chat.cancel()`。
- 组件卸载时调用 `chat.cancel()`。
- retryable interruption 仍显示“一键重试”。

- [ ] **Step 2: 运行组件测试，确认当前重复错误与未取消问题**

Run:

```bash
pnpm test:web -- web/src/dashboard/ChatProgressCard.test.ts web/src/dashboard/composables.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 接入页面生命周期取消**

在 `App.vue`：

```ts
onBeforeUnmount(() => {
  chat.cancel();
  window.removeEventListener('popstate', onPopState);
});

async function openSession(id: string): Promise<void> {
  chat.cancel();
  // 保留现有 audit/knowledge/session 打开逻辑
}
```

`onPopState` 重新初始化前同样调用 `chat.cancel()`。

- [ ] **Step 4: 统一聊天错误展示**

将：

```ts
const bannerError = computed(() => sessions.error.value || chat.error.value);
```

改为只承载 session 级加载错误：

```ts
const bannerError = computed(() => sessions.error.value);
```

聊天发送/轮询错误由进度卡或 composer 的 inline feedback 显示，避免同一错误出现两次。

- [ ] **Step 5: 验证**

Run:

```bash
pnpm typecheck:web
pnpm test:web
```

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add web/src/dashboard/App.vue web/src/dashboard/ChatPanel.vue web/src/dashboard/ChatProgressCard.vue web/src/dashboard/ChatProgressCard.test.ts
git commit -m "fix: cancel stale dashboard polls"
```

---

### Task 8: 增加浏览器级竞态验收并完成全量验证

**Files:**

- Modify: `e2e/web-smoke.spec.ts`

- [ ] **Step 1: 增加 transient terminal 快照的 E2E**

在 Playwright 中拦截第一次 `/api/session`，对当前 user message 删除 helper 并强制 `status = 'partial'`；第二次恢复真实响应。断言：

```ts
await expect(page.getByText('回答已中断')).toBeHidden();
await expect(page.getByText('项目状态可以继续检查。').first()).toBeVisible();
```

- [ ] **Step 2: 运行目标 E2E**

Run:

```bash
pnpm test:e2e -- --grep="transient terminal"
```

Expected: PASS。

- [ ] **Step 3: 运行仓库规定的完整验证**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test:web
pnpm test
pnpm test:e2e
```

Expected: 全部 PASS。

- [ ] **Step 4: 检查无临时标记和格式问题**

Run:

```bash
rg -n "FIXME|HACK|TEMPORARY" src/gateway/dto.ts src/runtime web/src/dashboard test/supper-helper.test.mjs test/turn-presentation-integrity.test.mjs e2e/web-smoke.spec.ts
git diff --check
```

Expected: 没有本次新增的临时标记，`git diff --check` 无输出。

- [ ] **Step 5: 提交 E2E 验收**

```bash
git add e2e/web-smoke.spec.ts
git commit -m "test: cover transient terminal turn race"
```
