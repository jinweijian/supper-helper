# Vue Dashboard 能力对齐恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以迁移前 Dashboard 为最低能力基线，在 Vue 边界内恢复问答进度、回答展示、审计面板、日志、知识健康、完整设置和会话状态行为。

**Architecture:** HTTP DTO、Runtime 与持久化保持不变。Composable 管理异步控制流和安全 public state，纯函数建立展示模型，Vue component 只渲染展示模型；任何 DiagnosticRequest、WorkerTrace、raw output 都不能通过默认 Dashboard 面板暴露。

**Tech Stack:** Vue 3.5、TypeScript 5.8、Vitest 4、Vue Test Utils、Playwright、Node.js 20.19+、pnpm 10+

## Global Constraints

- 旧版交互能力是最低验收基线，不要求 HTML/CSS 像素级复制。
- 不改变 HTTP response shape、Case JSON shape、Runtime 阶段决策或 LAN 无鉴权范围。
- 不显示伪精确 ETA；只显示已耗时、心跳和明确标注的经验范围。
- 默认测试不联网、不使用真实 provider 凭证。
- 内部约束、command、cwd、stdout、provider payload 和原始 model output 不进入默认 Dashboard。

---

### Task 1: 建立安全 Dashboard 展示合同并恢复回答层级

**Files:**
- Modify: `web/src/shared/contracts.ts`
- Create: `web/src/dashboard/dashboard-view-model.ts`
- Create: `web/src/dashboard/dashboard-view-model.test.ts`
- Create: `web/src/dashboard/RichAnswer.vue`
- Create: `web/src/dashboard/RichAnswer.test.ts`
- Modify: `web/src/dashboard/ChatPanel.vue`
- Modify: `web/src/dashboard/InsightPanel.vue`

**Interfaces:**
- Consumes: `SessionDto.contextUsage`、`SessionDto.agentActivity`、最新 `run.result`。
- Produces: `safeRunView(session)`，只返回 status、accepted claims、evidence、missingInfo；`parseAnswerBlocks(text)` 返回安全 block token，不接受 HTML。

- [ ] **Step 1: 写失败测试**

```ts
expect(JSON.stringify(safeRunView(session))).not.toContain('workerTrace');
expect(JSON.stringify(safeRunView(session))).not.toContain('diagnosticObjective');
expect(safeRunView(session).evidence).toEqual([{ id: 'ev_1', summary: '已审核证据', source: 'faq.md', confidence: 'high' }]);
expect(parseAnswerBlocks('**结论**\n\n- 第一步')).toEqual([
  { kind: 'paragraph', inline: [{ kind: 'strong', text: '结论' }] },
  { kind: 'list', items: ['第一步'] },
]);
```

组件断言回答不再显示 `**`，证据默认折叠，InsightPanel DOM 不包含 command/cwd/stdout。

- [ ] **Step 2: 验证 RED**

Run: `pnpm exec vitest run web/src/dashboard/dashboard-view-model.test.ts web/src/dashboard/RichAnswer.test.ts`

Expected: FAIL，模块或安全展示模型尚不存在。

- [ ] **Step 3: 实现最小安全模型与回答组件**

```ts
export function safeRunView(session?: SessionDto): SafeRunView {
  const run = [...(session?.runs ?? [])].reverse().find((item) => isRecord(item.result));
  const result = isRecord(run?.result) ? run.result : {};
  return {
    status: String(run?.status ?? session?.status ?? 'collecting_input'),
    claims: publicClaims(result.claims),
    evidence: publicEvidence(result.evidence),
    missingInfo: stringList(result.missingInfo),
  };
}
```

`RichAnswer.vue` 使用 token + Vue template 渲染标题、段落、列表、强调、行内代码和代码块；任何 `<script>` 或 HTML 标签作为纯文本显示。

- [ ] **Step 4: 验证 GREEN 并提交**

Run: `pnpm exec vitest run web/src/dashboard/dashboard-view-model.test.ts web/src/dashboard/RichAnswer.test.ts`

```bash
git add web/src/shared/contracts.ts web/src/dashboard/dashboard-view-model.ts web/src/dashboard/dashboard-view-model.test.ts web/src/dashboard/RichAnswer.vue web/src/dashboard/RichAnswer.test.ts web/src/dashboard/ChatPanel.vue web/src/dashboard/InsightPanel.vue
git commit -m "fix(web): restore safe answer and audit presentation"
```

### Task 2: 恢复实时进度、耗时、心跳与中断

**Files:**
- Modify: `web/src/dashboard/use-chat.ts`
- Modify: `web/src/dashboard/composables.test.ts`
- Create: `web/src/dashboard/chat-progress.ts`
- Create: `web/src/dashboard/chat-progress.test.ts`
- Create: `web/src/dashboard/ChatProgressCard.vue`
- Create: `web/src/dashboard/ChatProgressCard.test.ts`
- Modify: `web/src/dashboard/App.vue`
- Modify: `web/src/dashboard/ChatPanel.vue`

**Interfaces:**
- Produces: `ChatProgressState = { state, startedAt, lastActivityAt, session?, error? }`；`poll(..., onSession)` 每次 poll 发布 Session。
- Produces: `progressView(state, now)`，包含 title、summary、percent、steps、elapsedLabel、heartbeatLabel、estimateLabel、interrupted。

- [ ] **Step 1: 写失败测试**

```ts
const seen: string[] = [];
await chat.poll('case_1', 'msg_1', (session) => seen.push(session.status));
expect(seen).toEqual(['queued', 'diagnosing', 'concluded']);
expect(progressView(interrupted, now).animated).toBe(false);
expect(progressView(running, now).estimateLabel).toContain('估计');
```

组件测试断言 elapsed 每秒更新、心跳过期提示出现、interrupted 不保留运行动画。

- [ ] **Step 2: 验证 RED**

Run: `pnpm exec vitest run web/src/dashboard/composables.test.ts web/src/dashboard/chat-progress.test.ts web/src/dashboard/ChatProgressCard.test.ts`

Expected: FAIL，当前 poll 不发布中间 Session，进度模型不存在。

- [ ] **Step 3: 实现轮询状态机**

```ts
async function poll(caseId: string, userMessageId: string, onSession?: (session: SessionDto) => void) {
  for (...) {
    const session = await loadSession(...);
    latestSession.value = session;
    lastActivityAt.value = Date.now();
    onSession?.(session);
    if (reply) return complete(session);
    if (!isActive(session.status)) throw interrupt('回答已中断：诊断已停止但没有返回回复');
    await delay(...);
  }
  throw interrupt('等待回复超时，请重试或查看诊断日志');
}
```

`App.vue` 在 send 与刷新恢复时把每次 Session 写入 `sessions.current`；切换会话时旧轮询结果不得覆盖当前会话。

- [ ] **Step 4: 验证 GREEN 并提交**

Run: `pnpm exec vitest run web/src/dashboard/composables.test.ts web/src/dashboard/chat-progress.test.ts web/src/dashboard/ChatProgressCard.test.ts`

```bash
git add web/src/dashboard/use-chat.ts web/src/dashboard/composables.test.ts web/src/dashboard/chat-progress.ts web/src/dashboard/chat-progress.test.ts web/src/dashboard/ChatProgressCard.vue web/src/dashboard/ChatProgressCard.test.ts web/src/dashboard/App.vue web/src/dashboard/ChatPanel.vue
git commit -m "fix(web): restore live diagnostic progress"
```

### Task 3: 恢复结构化日志卡片

**Files:**
- Modify: `web/src/dashboard/use-logs.ts`
- Create: `web/src/dashboard/LogCard.vue`
- Create: `web/src/dashboard/LogList.vue`
- Create: `web/src/dashboard/LogList.test.ts`
- Modify: `web/src/dashboard/App.vue`
- Modify: `web/src/dashboard/styles.css`

**Interfaces:**
- `LogBlock` 补全 id、createdAt、actor、phase、agentName、label、detail、tags。
- `LogList` 接收 blocks/loading，按稳定 id 保存 expanded 集合。

- [ ] **Step 1: 写失败测试**

```ts
expect(wrapper.findAll('details[open]')).toHaveLength(3);
await wrapper.get('[data-testid="collapse-all-logs"]').trigger('click');
expect(wrapper.findAll('details[open]')).toHaveLength(0);
await wrapper.setProps({ blocks: refreshedBlocks });
expect(wrapper.get('[data-log-id="log_2"]').attributes('open')).toBeDefined();
```

断言折叠时 detail/command 不在可见文本，summary 包含 severity、time、agent 和 phase。

- [ ] **Step 2: 验证 RED**

Run: `pnpm exec vitest run web/src/dashboard/LogList.test.ts`

Expected: FAIL，日志列表组件不存在。

- [ ] **Step 3: 实现 disclosure**

```vue
<details :open="expanded.has(block.id)" @toggle="onToggle(block.id, $event)">
  <summary>...</summary>
  <pre v-if="block.command">{{ block.command }}</pre>
  <pre>{{ formattedDetail }}</pre>
</details>
```

默认只展开 `blocks.slice(0, 3)`，刷新按 id 保留人工状态；全部展开/收起使用显式按钮。

- [ ] **Step 4: 验证 GREEN 并提交**

Run: `pnpm exec vitest run web/src/dashboard/LogList.test.ts web/src/shared/AccessibleDrawer.test.ts`

```bash
git add web/src/dashboard/use-logs.ts web/src/dashboard/LogCard.vue web/src/dashboard/LogList.vue web/src/dashboard/LogList.test.ts web/src/dashboard/App.vue web/src/dashboard/styles.css
git commit -m "fix(web): restore collapsible diagnostic logs"
```

### Task 4: 恢复 Case 状态、上下文和知识健康

**Files:**
- Modify: `web/src/shared/contracts.ts`
- Modify: `web/src/dashboard/SessionSidebar.vue`
- Modify: `web/src/dashboard/ChatPanel.vue`
- Modify: `web/src/dashboard/InsightPanel.vue`
- Modify: `web/src/dashboard/use-knowledge.ts`
- Modify: `web/src/dashboard/App.vue`
- Create: `web/src/dashboard/session-view.test.ts`
- Modify: `web/src/dashboard/composables.test.ts`

**Interfaces:**
- `latestUserQuestion(session)` 返回最后一条 user body。
- `loadLocalHealth(workspaceId)` 用空 query 请求本地 health；`probe(workspaceId, latestQuestion)` 只由按钮触发。

- [ ] **Step 1: 写失败测试**

断言 active 筛选包含 queued、ready_for_diagnosis、diagnosing；归档和 context unavailable 禁用 textarea；状态显示中文；初始化会话只调用一次空 query local health；测试检索使用最后一条 user message。

- [ ] **Step 2: 验证 RED**

Run: `pnpm exec vitest run web/src/dashboard/session-view.test.ts web/src/dashboard/composables.test.ts`

Expected: FAIL，当前筛选、禁用和 query 均不符合合同。

- [ ] **Step 3: 实现最小恢复**

```ts
export const ACTIVE_SESSION_STATUSES = ['queued', 'ready_for_diagnosis', 'diagnosing'];
export function latestUserQuestion(session?: SessionDto): string {
  return [...(session?.messages ?? [])].reverse().find((item) => item.role === 'user')?.body ?? '';
}
```

Case header 恢复 workspace、中文状态、五阶段轨道和 context meter；知识健康使用结构化卡和解释性空状态，不输出 `{}`。

- [ ] **Step 4: 验证 GREEN 并提交**

Run: `pnpm exec vitest run web/src/dashboard/session-view.test.ts web/src/dashboard/composables.test.ts`

```bash
git add web/src/shared/contracts.ts web/src/dashboard/SessionSidebar.vue web/src/dashboard/ChatPanel.vue web/src/dashboard/InsightPanel.vue web/src/dashboard/use-knowledge.ts web/src/dashboard/App.vue web/src/dashboard/session-view.test.ts web/src/dashboard/composables.test.ts
git commit -m "fix(web): restore case and knowledge health context"
```

### Task 5: 恢复完整设置与动作反馈

**Files:**
- Modify: `web/src/dashboard/use-settings.ts`
- Modify: `web/src/dashboard/SettingsForm.vue`
- Create: `web/src/dashboard/SettingsForm.test.ts`
- Modify: `web/src/dashboard/composables.test.ts`
- Modify: `web/src/dashboard/App.vue`

**Interfaces:**
- `SettingsAction = 'load' | 'saveModel' | 'saveEmbedding' | 'saveRerank' | 'saveClaude' | 'testModel' | 'testEmbedding' | 'testRerank'`。
- `actions[action] = { running, startedAt?, elapsedMs?, status, error }`；表单保持挂载。

- [ ] **Step 1: 写失败测试**

```ts
await wrapper.get('[data-testid="test-model"]').trigger('click');
expect(wrapper.find('form').exists()).toBe(true);
expect(wrapper.text()).toContain('正在测试模型');
expect(fetcher).toHaveBeenCalledWith('/api/settings/model/test', expect.objectContaining({ body: expect.stringContaining('unsaved-model') }));
```

分别断言模型高级字段、Embedding、Rerank、Claude 和 Agent 摘要存在；保存命中四个 API；其中一个失败时显示部分失败而非“全部保存成功”。

- [ ] **Step 2: 验证 RED**

Run: `pnpm exec vitest run web/src/dashboard/SettingsForm.test.ts web/src/dashboard/composables.test.ts`

Expected: FAIL，完整字段与动作状态不存在。

- [ ] **Step 3: 实现动作级状态与完整表单**

```ts
async function executeAction<T>(name: SettingsAction, work: () => Promise<T>, success: string) {
  actions[name] = { running: true, startedAt: Date.now(), status: '', error: '' };
  try { ... } catch (cause) { ... } finally {
    actions[name].running = false;
    actions[name].elapsedMs = Date.now() - actions[name].startedAt!;
  }
}
```

App 不再用 `v-else` 卸载 SettingsForm；load 状态作为表单上方提示。API Key 空值从 payload 省略。

- [ ] **Step 4: 验证 GREEN 并提交**

Run: `pnpm exec vitest run web/src/dashboard/SettingsForm.test.ts web/src/dashboard/composables.test.ts`

```bash
git add web/src/dashboard/use-settings.ts web/src/dashboard/SettingsForm.vue web/src/dashboard/SettingsForm.test.ts web/src/dashboard/composables.test.ts web/src/dashboard/App.vue
git commit -m "fix(web): restore complete settings workflows"
```

### Task 6: 真实浏览器能力矩阵与全量闸门

**Files:**
- Modify: `test/fixtures/web/production-server.mjs`
- Modify: `e2e/web-smoke.spec.ts`
- Modify: `docs/superpowers/audits/2026-07-12-vue-parity/README.md`

**Interfaces:**
- Fixture 必须让 `/api/session` 依次返回 queued、diagnosing、concluded，并提供本地 settings test adapter；不得访问互联网。

- [ ] **Step 1: 写 Playwright 失败验收**

断言动态阶段至少变化两次、耗时/心跳可见、中断 fixture 停止动画、回答 Markdown 被渲染、raw trace 不可见、日志折叠、local health 自动加载、test retrieval 使用最新问题、完整设置命中对应 API。

- [ ] **Step 2: 验证 RED**

Run: `pnpm test:e2e`

Expected: 至少一个新增能力断言失败；确认不是 fixture 或 locator 错误。

- [ ] **Step 3: 完成 fixture 与生产入口接线**

Fixture 记录公开请求并通过页面可观察状态返回断言证据；不添加测试专用生产分支。

- [ ] **Step 4: 运行完整验证**

```bash
pnpm test:web
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
```

Expected: 所有命令退出码 0；全量 Node 与 Playwright 测试无失败。

- [ ] **Step 5: 回头重新检查能力矩阵并提交**

从真实 `/api/chat` 追踪到 Session poll、进度卡、回答、日志、Knowledge、Settings；确认没有 raw trace、假 ETA、隐藏失败或旧能力缺口。

```bash
git add test/fixtures/web/production-server.mjs e2e/web-smoke.spec.ts docs/superpowers/audits/2026-07-12-vue-parity/README.md
git commit -m "test(web): enforce Vue migration capability parity"
```
