# Setup 审核可用性与 Dashboard 恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Setup 刷新后无法恢复完成状态的问题，并让审核者能够批量选择当前页、查看充分的审核依据及完成后进入 Dashboard。

**Architecture:** 保持 Gateway 首页质量门禁与 Onboarding 服务端审核规则不变。状态恢复由 `use-onboarding.ts` 负责，Setup 页面只组合状态并说明门禁，`ReviewPanel.vue` 负责当前页选择和既有安全 DTO 的完整展示；所有批量提交都携带显式非空 ID。

**Tech Stack:** Vue 3.5、TypeScript、Vitest 4、Vue Test Utils、Playwright、Node.js 20.19+、pnpm 10+

## Global Constraints

- 全选只作用于当前筛选结果中的本页项目。
- 不新增审核详情 API，不改变既有 HTTP response shape、配置 shape、Case JSON shape 或知识 artifact shape。
- 不绕过审核进入 Dashboard，不允许发布 `error` 级别切片。
- LAN 继续保持无鉴权内测模式。
- 测试默认不联网、不依赖真实 provider 凭证。

## 文件结构

- 修改 `web/src/setup/use-onboarding.ts`：从公开快照恢复 `latestRun` 与 `review`，提交后同步审核结果。
- 修改 `web/src/setup/App.vue`：显示门禁说明，并根据恢复后的完成状态展示 Dashboard 入口。
- 修改 `web/src/setup/ReviewPanel.vue`：当前页批量选择、显式 ID 提交、详细审核依据与错误级别发布保护。
- 修改 `web/src/setup/setup.css`：审核卡片、状态标签、问题说明和批量工具布局。
- 新建 `web/src/setup/ReviewPanel.test.ts`：审核组件行为契约。
- 修改 `web/src/setup/use-onboarding.test.ts`、`web/src/setup/App.test.ts`：状态恢复和入口显示契约。
- 修改 `test/fixtures/web/production-server.mjs`、`e2e/web-smoke.spec.ts`：真实 Gateway + Vite 产物的浏览器验收。

---

### Task 1: 恢复 Setup 服务端状态

**Files:**
- Modify: `web/src/setup/use-onboarding.ts`
- Test: `web/src/setup/use-onboarding.test.ts`

**Interfaces:**
- Consumes: `GET /api/onboarding` 返回的 `{ latestRun?: RunDto, review?: OnboardingReviewState }`。
- Produces: `load(): Promise<Record<string, unknown>>` 在返回快照的同时更新 `run.value` 与 `review.value`；`submitReview()` 优先采用 POST 返回的 `review`。

- [ ] **Step 1: 写失败测试**

增加用例，令 fetch 返回：

```ts
{
  latestRun: { id: 'run_saved', status: 'completed', overallProgress: 100, stages: [] },
  review: { required: false, pendingCount: 0, blockedCount: 0, items: [] },
}
```

断言 `await onboarding.load()` 后 `onboarding.run.value?.id === 'run_saved'` 且 `onboarding.review.value?.required === false`。再断言 `submitReview({ action: 'approve', ids: ['slice-1'] })` 后采用 POST 响应中的最新 review。

- [ ] **Step 2: 验证测试按预期失败**

Run: `pnpm exec vitest run web/src/setup/use-onboarding.test.ts`

Expected: FAIL，`run.value` 或 `review.value` 仍为 `undefined`。

- [ ] **Step 3: 写最小实现**

在 `load()` 中解析快照并同步：

```ts
const state = await execute(() => apiJson<OnboardingSnapshot>(fetcher, '/api/onboarding'));
snapshot.value = state;
run.value = state.latestRun;
review.value = state.review;
return state;
```

在 `submitReview()` 中若响应包含 `review`，先赋值，再加载最新页；保持错误处理不变。

- [ ] **Step 4: 验证 focused test 通过**

Run: `pnpm exec vitest run web/src/setup/use-onboarding.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/setup/use-onboarding.ts web/src/setup/use-onboarding.test.ts
git commit -m "fix(setup): restore onboarding progress state"
```

### Task 2: 增加当前页批量选择与审核依据

**Files:**
- Create: `web/src/setup/ReviewPanel.test.ts`
- Modify: `web/src/setup/ReviewPanel.vue`
- Modify: `web/src/setup/setup.css`

**Interfaces:**
- Consumes: 既有 `review.items[]` 的 `id`、`title`、`module`、`path`、`qualitySeverity`、`qualityStatus`、`pipelineStatus`、`excerptPreview` 与 `issues[].explanation`。
- Produces: `submit` 事件 `{ action, ids: string[], notes }`，其中 `ids` 永远非空且只来自当前页选择。

- [ ] **Step 1: 写审核详情失败测试**

挂载含一个 warn 项的组件，issue 包含：

```ts
explanation: {
  reason: '原因：缺少完整结论。',
  impact: '影响：无法直接回答。',
  suggestion: '建议：补充操作步骤。',
  missingInfo: ['缺少适用版本'],
}
```

断言页面显示模块、摘要、质量/管线状态，以及以上四类解释。

- [ ] **Step 2: 写批量选择失败测试**

挂载两个当前页项目，点击“全选本页”，断言显示“已选 2 / 本页 2 条”；点击“发布选中”后断言事件的 `ids` 精确等于两个当前页 ID；点击“取消全选”后断言发布按钮禁用。

- [ ] **Step 3: 写安全与选择清理失败测试**

断言选择包含 `error` 项时“发布选中”禁用并显示说明；改变 `review.items` 或触发刷新后，旧 ID 不会进入下一次 submit。

- [ ] **Step 4: 验证测试按预期失败**

Run: `pnpm exec vitest run web/src/setup/ReviewPanel.test.ts`

Expected: FAIL，缺少全选按钮、详情文本与 error 发布保护。

- [ ] **Step 5: 写最小组件实现**

增加计算属性和动作：

```ts
const pageIds = computed(() => items.value.map((item) => String(item.id)));
const selectedItems = computed(() => items.value.filter((item) => selected.value.includes(String(item.id))));
const hasSelectedError = computed(() => selectedItems.value.some((item) => item.qualitySeverity === 'error'));
function selectPage(): void { selected.value = [...pageIds.value]; }
function clearSelection(): void { selected.value = []; }
```

使用 `watch(items, ...)` 清除不再可见的 ID；刷新前清空选择。模板渲染所有既有审核字段和 issue explanation；发布按钮在 `hasSelectedError` 时禁用并显示可见原因。

- [ ] **Step 6: 补充审核布局**

在 `setup.css` 增加 `.review-selection`、`.review-summary`、`.review-statuses`、`.review-issues` 和 `.review-issue`，保持小屏单列和长路径自动换行。

- [ ] **Step 7: 验证 focused test 通过**

Run: `pnpm exec vitest run web/src/setup/ReviewPanel.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add web/src/setup/ReviewPanel.vue web/src/setup/ReviewPanel.test.ts web/src/setup/setup.css
git commit -m "feat(setup): add batch knowledge review controls"
```

### Task 3: 解释 Dashboard 门禁并恢复入口

**Files:**
- Modify: `web/src/setup/App.vue`
- Modify: `web/src/setup/App.test.ts`

**Interfaces:**
- Consumes: `onboarding.snapshot.value.completed`、`onboarding.run.value.status` 与 `onboarding.review.value.required/pendingCount/blockedCount`。
- Produces: 待审核门禁说明；完成且无需审核时稳定出现 `href="/"` 的“进入 Dashboard”。

- [ ] **Step 1: 写失败测试**

分别模拟：

```ts
{ completed: true, latestRun: completedRun, review: { required: true, pendingCount: 2, blockedCount: 1, items: [] } }
```

与：

```ts
{ completed: true, latestRun: completedRun, review: { required: false, pendingCount: 0, blockedCount: 0, items: [] } }
```

前者断言显示“处理完成后才能进入 Dashboard”且没有入口；后者断言刷新挂载后直接显示入口。

- [ ] **Step 2: 验证测试按预期失败**

Run: `pnpm exec vitest run web/src/setup/App.test.ts`

Expected: FAIL，当前页面未恢复 run，因此第二个场景没有 Dashboard 入口；第一个场景没有门禁说明。

- [ ] **Step 3: 写最小实现**

增加完成状态计算：

```ts
const onboardingCompleted = computed(() =>
  onboarding.snapshot.value.completed === true || onboarding.run.value?.status === 'completed');
```

待审核时渲染说明卡；成功入口条件改为 `onboardingCompleted && !review.required`。保持 Gateway 的真实重定向规则不变。

- [ ] **Step 4: 验证 focused test 通过**

Run: `pnpm exec vitest run web/src/setup/App.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/setup/App.vue web/src/setup/App.test.ts
git commit -m "fix(setup): explain review gate and restore dashboard entry"
```

### Task 4: 真实浏览器回归与全量验证

**Files:**
- Modify: `test/fixtures/web/production-server.mjs`
- Modify: `e2e/web-smoke.spec.ts`

**Interfaces:**
- Consumes: 真实 `startServer`、生产 Vite 构建产物及公开 Onboarding API。
- Produces: Setup 批量审核后可以访问并刷新 Dashboard 的端到端证据。

- [ ] **Step 1: 扩充真实 fixture 数据**

让审核 fixture 提供两个 warn 项及完整摘要/issue explanation，并让 `submitReview(input)` 记录且校验显式 IDs 后清空审核状态。

- [ ] **Step 2: 更新 Playwright 断言并先观察失败**

测试必须验证：详情可见、点击“全选本页”后已选 2 条、批量发布、完成/重试后点击 Dashboard、URL 为 `/`，刷新后仍显示首页。

Run: `pnpm test:e2e`

Expected before implementation integration: FAIL 于缺少批量按钮或详情。

- [ ] **Step 3: 运行 focused web tests**

Run: `pnpm test:web`

Expected: PASS。

- [ ] **Step 4: 运行强制验证**

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
```

Expected: 所有命令退出码 0；默认测试不访问远程 provider。

- [ ] **Step 5: 检查改动边界并提交**

确认没有修改 Gateway 门禁、HTTP DTO、持久化 shape、LAN 鉴权或服务端 `error` 审核规则，然后：

```bash
git add test/fixtures/web/production-server.mjs e2e/web-smoke.spec.ts
git commit -m "test(setup): cover batch review dashboard flow"
```
