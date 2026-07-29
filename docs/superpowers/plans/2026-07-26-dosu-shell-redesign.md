# Dosu Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不复制 Dosu 品牌资产和不破坏 super-helper 诊断能力的前提下，把 Dashboard 重构成同类的深色知识工作台：安静的 256px 左侧栏、16px 外边距中的黑色文档画布、轻量顶部栏、可读性优先的回答区与底部宽输入器。

**Architecture:** 保留现有 Vue 组件与 composable 边界，使用 CSS token 和少量语义化模板调整完成视觉重构。`SessionSidebar` 负责工作台导航与会话树，`ChatPanel` 负责文档画布、消息与 composer，`RichAnswer` 负责结构化内容呈现，`App` 只负责布局和页面级抽屉/审计路由。深色是产品默认值，浅色仍通过现有 `data-theme` 机制完整可用。

**Tech Stack:** Vue 3 SFC、TypeScript、原生 CSS、Vitest + Vue Test Utils、Playwright；不新增 UI 或图标依赖。

## Global Constraints

- 先完成并验证 `2026-07-26-turn-continuity-hardening.md`，再执行本计划。
- 视觉参考只采用布局、密度和信息层级，不复制 Dosu logo、品牌名、受版权保护图形或源码。
- 默认深色主题；已存储的明确浅色选择继续生效。
- 桌面端左栏 256px，工作区外边距 16px，主画布圆角 12px；回答正文最大可读宽度约 860px。
- 主聊天页不展示内部 judge 分数、worker trace、路由过程；这些继续留在审计页/日志抽屉。
- 不新增知识树 API；左栏仍使用现有会话数据。
- 保持键盘可达、焦点样式、`aria-live`、drawer focus return 与 320px 最小宽度支持。

---

## File Map

| 文件 | 责任 |
| --- | --- |
| `web/index.html` | 主题启动脚本，首次访问默认深色且避免闪屏 |
| `web/src/dashboard/use-theme.ts` | 显式选择持久化，未选择时默认深色 |
| `web/src/dashboard/App.vue` | Desktop/mobile shell、侧栏开关、audit 页面容器 |
| `web/src/dashboard/main.ts` | 注册 `/sessions/:id/audit` 路由 |
| `web/src/dashboard/SessionSidebar.vue` | Dosu 式品牌区、主导航、会话搜索/列表、底部主题切换 |
| `web/src/dashboard/ChatPanel.vue` | 极简顶部栏、文档消息流、底部 composer |
| `web/src/dashboard/RichAnswer.vue` | 标题、列表、代码块和 inline code 的文档排版 |
| `web/src/dashboard/ChatProgressCard.vue` | 低干扰的单行运行状态 |
| `web/src/dashboard/AuditPage.vue` | 独立审计页，不挤占聊天画布 |
| `web/src/styles.css` | token、桌面布局、响应式、浅深主题全部视觉规则 |
| `web/src/dashboard/session-view.test.ts` | shell、header、composer 语义结构测试 |
| `web/src/dashboard/RichAnswer.test.ts` | 富文本结构化渲染测试 |
| `web/src/dashboard/ChatProgressCard.test.ts` | 运行态/中断态视觉语义测试 |
| `e2e/web-smoke.spec.ts` | 桌面、移动端与主题切换视觉行为验收 |

---

### Task 1: 固化“首次默认深色、显式选择持久化”的主题合同

**Files:**

- Modify: `web/src/dashboard/use-theme.ts`
- Modify: `web/index.html`
- Modify: `web/src/dashboard/composables.test.ts`

- [ ] **Step 1: 写主题合同测试**

增加测试覆盖：

```ts
it('defaults to dark when the user has not chosen a theme', () => {
  localStorage.removeItem('super-helper-theme');
  expect(document.documentElement.dataset.theme).toBe('dark');
});
```

以及：

- 存在 `super-helper-theme=light` 时仍为浅色。
- toggle 后写入 localStorage。
- 系统 light media query 不覆盖“产品默认深色”。

- [ ] **Step 2: 运行测试，确认当前实现会跟随系统浅色**

Run:

```bash
pnpm test:web -- web/src/dashboard/composables.test.ts
```

Expected: FAIL，现有 `readSystem()` 在系统浅色时返回 `light`。

- [ ] **Step 3: 调整 composable 和启动脚本**

`use-theme.ts` 使用：

```ts
function readCurrent(): ThemeName {
  return readStored() ?? 'dark';
}
```

删除未显式选择时跟随系统变化的监听。`web/index.html` 的 inline boot script 使用同样规则：

```js
const stored = localStorage.getItem('super-helper-theme');
document.documentElement.dataset.theme = stored === 'light' ? 'light' : 'dark';
```

- [ ] **Step 4: 验证**

Run:

```bash
pnpm typecheck:web
pnpm test:web -- web/src/dashboard/composables.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add web/index.html web/src/dashboard/use-theme.ts web/src/dashboard/composables.test.ts
git commit -m "feat: make dark the dashboard default"
```

---

### Task 2: 重构全局 token 与 Dosu 式桌面 shell

**Files:**

- Modify: `web/src/styles.css`
- Modify: `web/src/dashboard/App.vue`
- Modify: `web/src/dashboard/session-view.test.ts`

- [ ] **Step 1: 写 shell 结构测试**

测试应断言：

- `.workspace-grid` 同时包含侧栏与 `.chat-column`。
- `.chat-column` 是主 `main` landmark。
- 页面没有常驻右侧详情栏。
- 存在移动端侧栏开关按钮及其 `aria-expanded`。

示例：

```ts
expect(wrapper.find('.workspace-grid').exists()).toBe(true);
expect(wrapper.find('main.chat-column').exists()).toBe(true);
expect(wrapper.find('.insight-panel').exists()).toBe(false);
expect(wrapper.get('[aria-controls="session-sidebar"]').attributes('aria-expanded')).toBe('false');
```

- [ ] **Step 2: 运行测试，确认现有 shell 缺少移动端侧栏合同**

Run:

```bash
pnpm test:web -- web/src/dashboard/session-view.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 定义核心视觉 token**

在 `styles.css` 深色根 token 中收敛为：

```css
:root {
  color-scheme: dark;
  --bg-app: #141414;
  --bg-surface: #181818;
  --bg-card: #050505;
  --bg-elevated: #202020;
  --bg-hover: #282828;
  --border-subtle: #242424;
  --border-default: #303030;
  --text-primary: #f1f1ef;
  --text-secondary: #a3a3a0;
  --text-tertiary: #727270;
  --accent: #7c6df2;
  --accent-strong: #8d80f5;
  --radius-lg: 12px;
}
```

浅色 token 继续放在 `:root[data-theme="light"]`，确保对比度和语义色不丢失。

- [ ] **Step 4: 实现桌面 shell 尺寸**

```css
.workspace-grid {
  grid-template-columns: 256px minmax(0, 1fr);
  gap: 16px;
  padding: 16px 16px 16px 0;
}

.chat-column {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  min-width: 0;
}
```

在 `App.vue` 增加 mobile sidebar toggle 状态和 backdrop；桌面端不改变原有打开会话逻辑。

- [ ] **Step 5: 验证**

Run:

```bash
pnpm typecheck:web
pnpm test:web -- web/src/dashboard/session-view.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add web/src/styles.css web/src/dashboard/App.vue web/src/dashboard/session-view.test.ts
git commit -m "feat: establish Dosu-style dashboard shell"
```

---

### Task 3: 把侧栏改成安静的知识工作台导航

**Files:**

- Modify: `web/src/dashboard/SessionSidebar.vue`
- Modify: `web/src/styles.css`
- Modify: `web/src/dashboard/session-view.test.ts`

- [ ] **Step 1: 写侧栏语义测试**

断言存在：

- 品牌与“内网”状态，但没有大面积绿色品牌块。
- “问或搜索”与“新建对话”两个一级动作。
- 会话搜索。
- 会话项 title、摘要与 overflow actions。
- 底部主题切换。

示例：

```ts
expect(wrapper.get('button.sidebar-new').text()).toBe('新建对话');
expect(wrapper.get('input[aria-label="搜索会话"]').exists()).toBe(true);
expect(wrapper.get('[aria-label="更多选项"]').exists()).toBe(true);
```

- [ ] **Step 2: 运行测试，确认文案和结构不匹配**

Run:

```bash
pnpm test:web -- web/src/dashboard/session-view.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 调整模板层级**

`SessionSidebar.vue` 结构按以下顺序：

```html
<aside id="session-sidebar" class="sessions-sidebar" aria-label="历史会话">
  <header class="sidebar-brand">...</header>
  <nav class="sidebar-primary-nav" aria-label="主要操作">...</nav>
  <section class="sidebar-library" aria-labelledby="session-library-title">
    <h2 id="session-library-title">会话</h2>
    <!-- search + compact list -->
  </section>
  <footer class="sidebar-footer">...</footer>
</aside>
```

将“新建诊断”改为“新建对话”；保留筛选功能，但将筛选收进紧凑的二级控件，不再占据强视觉层级。

- [ ] **Step 4: 收敛会话项视觉**

会话项默认无卡片边框，hover/active 才出现低对比背景；active 使用 2px 左侧强调，不使用大面积绿色。摘要单行省略，overflow menu 保持键盘可用。

- [ ] **Step 5: 验证**

Run:

```bash
pnpm typecheck:web
pnpm test:web -- web/src/dashboard/session-view.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add web/src/dashboard/SessionSidebar.vue web/src/styles.css web/src/dashboard/session-view.test.ts
git commit -m "feat: redesign the session workspace sidebar"
```

---

### Task 4: 把聊天区域改成文档画布与轻量顶部栏

**Files:**

- Modify: `web/src/dashboard/ChatPanel.vue`
- Modify: `web/src/styles.css`
- Modify: `web/src/dashboard/session-view.test.ts`

- [ ] **Step 1: 写 ChatPanel 结构测试**

断言：

- header 只有菜单按钮、标题、overflow actions。
- 不再把 workspace/status 作为大号副标题常驻。
- helper 消息没有对话气泡容器。
- user 消息仍有轻量区分。
- 主内容有 `.document-column` 最大宽度容器。

- [ ] **Step 2: 运行测试，确认当前 header 与消息结构失败**

Run:

```bash
pnpm test:web -- web/src/dashboard/session-view.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 重排 ChatPanel 模板**

顶部栏参考：

```html
<header class="case-header">
  <button class="sidebar-toggle" aria-label="打开会话列表">...</button>
  <h1>{{ session?.title || '新对话' }}</h1>
  <details class="case-actions">
    <summary aria-label="会话操作">•••</summary>
    <slot name="actions" />
  </details>
</header>
```

消息流：

```html
<section ref="chat" class="chat" aria-live="polite">
  <div class="document-column">
    <!-- empty state / messages / progress -->
  </div>
</section>
```

对 helper 使用连续文档排版；用户消息保留作者/时间与低对比底色。

- [ ] **Step 4: 设置阅读宽度和纵向节奏**

```css
.document-column {
  width: min(100%, 860px);
  margin: 0 auto;
  padding: 36px 40px 180px;
}

.message.helper {
  padding: 0;
  background: transparent;
  border: 0;
}
```

- [ ] **Step 5: 验证**

Run:

```bash
pnpm typecheck:web
pnpm test:web -- web/src/dashboard/session-view.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add web/src/dashboard/ChatPanel.vue web/src/styles.css web/src/dashboard/session-view.test.ts
git commit -m "feat: turn chat into a document canvas"
```

---

### Task 5: 升级 RichAnswer 的文档与代码排版

**Files:**

- Modify: `web/src/dashboard/RichAnswer.vue`
- Modify: `web/src/dashboard/RichAnswer.test.ts`
- Modify: `web/src/styles.css`

- [ ] **Step 1: 写富文本回归测试**

覆盖：

- `#`、`##`、`###` 分别渲染不同 heading level，不全部降成 `h3`。
- fenced code block 保留语言 class（如 `language-ts`）。
- 无序列表、粗体、inline code 继续安全渲染，不使用 `v-html`。

示例：

```ts
expect(wrapper.find('h1').text()).toBe('结论');
expect(wrapper.find('h2').text()).toBe('定位依据');
expect(wrapper.find('pre code').classes()).toContain('language-ts');
expect(wrapper.html()).not.toContain('<script>');
```

- [ ] **Step 2: 运行测试，确认 heading level 与语言信息丢失**

Run:

```bash
pnpm test:web -- web/src/dashboard/RichAnswer.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 扩展安全 parser 的 block 类型**

使用：

```ts
type Block =
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'code'; text: string; language?: string }
  | { kind: 'list'; items: string[] };
```

渲染 heading：

```html
<component :is="`h${block.level}`" v-if="block.kind === 'heading'">
```

代码语言只生成经过 `/^[a-z0-9_+-]+$/i` 校验的 class。

- [ ] **Step 4: 定义文档排版**

正文 15px/1.72，标题间距明显但克制；代码块使用 `#111214` 背景、1px 边框、10px 圆角、横向滚动；inline code 不使用高饱和底色。

- [ ] **Step 5: 验证**

Run:

```bash
pnpm typecheck:web
pnpm test:web -- web/src/dashboard/RichAnswer.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add web/src/dashboard/RichAnswer.vue web/src/dashboard/RichAnswer.test.ts web/src/styles.css
git commit -m "feat: improve document answer typography"
```

---

### Task 6: 构建底部宽输入器与低干扰运行状态

**Files:**

- Modify: `web/src/dashboard/ChatPanel.vue`
- Modify: `web/src/dashboard/ChatProgressCard.vue`
- Modify: `web/src/dashboard/ChatProgressCard.test.ts`
- Modify: `web/src/styles.css`

- [ ] **Step 1: 写 composer 与 progress 测试**

断言：

- composer 高度区间通过 `.composer` 结构承载，textarea 在上、工具行在下。
- persona 是紧凑 chip/select。
- 发送按钮有可访问名称“发送”。
- running/reconnecting 只显示单行状态；只有 retryable interruption 显示重试按钮。

- [ ] **Step 2: 运行测试，确认当前结构/文案不满足**

Run:

```bash
pnpm test:web -- web/src/dashboard/ChatProgressCard.test.ts web/src/dashboard/session-view.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 重排 composer**

```html
<form class="composer" @submit.prevent="submit">
  <textarea ... />
  <div class="composer-toolbar">
    <div class="composer-context">
      <label class="persona-chip">...</label>
      <span class="source-chip">内网知识</span>
    </div>
    <button class="send-button" type="submit" aria-label="发送">↑</button>
  </div>
</form>
```

桌面高度设为 144px 左右，定位于 chat canvas 底部，宽度与文档列一致；保留 Shift+Enter 换行和 Enter 发送。

- [ ] **Step 4: 收敛 progress**

`.progress-line` 使用 12px 次级文字和 6px 状态点，不使用大卡片或强边框。`interrupted` 只有明确 `retryableTurn` 时提供按钮；普通重连不显示错误式红色。

- [ ] **Step 5: 验证**

Run:

```bash
pnpm typecheck:web
pnpm test:web -- web/src/dashboard/ChatProgressCard.test.ts web/src/dashboard/session-view.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add web/src/dashboard/ChatPanel.vue web/src/dashboard/ChatProgressCard.vue web/src/dashboard/ChatProgressCard.test.ts web/src/styles.css
git commit -m "feat: redesign the chat composer and progress line"
```

---

### Task 7: 完成独立 Audit 路由和移动端 slide-over

**Files:**

- Modify: `web/src/dashboard/main.ts`
- Modify: `web/src/dashboard/App.vue`
- Modify: `web/src/dashboard/AuditPage.vue`
- Modify: `web/src/styles.css`
- Modify: `web/src/dashboard/session-view.test.ts`

- [ ] **Step 1: 写路由与响应式行为测试**

断言：

- `/sessions/:id/audit` 是显式 router route。
- 打开 audit 使用 router/history 后可返回会话。
- 小屏侧栏使用 `aria-modal`/backdrop，选择会话后关闭。
- Escape 能关闭 mobile sidebar。

- [ ] **Step 2: 运行测试，确认当前 audit 仅靠 pathname regex**

Run:

```bash
pnpm test:web -- web/src/dashboard/session-view.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 注册 audit 路由**

在 `main.ts`：

```ts
routes: [
  { path: '/', component: App },
  { path: '/sessions/:id', component: App },
  { path: '/sessions/:id/audit', component: App },
],
```

`App.vue` 继续使用现有数据 composables，但以当前 route path 决定展示 `AuditPage`；不要复制 session 加载逻辑。

- [ ] **Step 4: 实现 mobile slide-over**

在 `@media (max-width: 840px)`：

- `.workspace-grid` 改为单列、padding 0。
- `.sessions-sidebar` 固定在左侧、宽 `min(88vw, 320px)`，默认 transform 隐藏。
- `.sessions-sidebar.is-open` 进入视口。
- `.sidebar-backdrop` 覆盖其余画面。
- `.chat-column` 去掉外圆角以充分使用屏幕。

- [ ] **Step 5: 验证**

Run:

```bash
pnpm typecheck:web
pnpm test:web
```

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add web/src/dashboard/main.ts web/src/dashboard/App.vue web/src/dashboard/AuditPage.vue web/src/styles.css web/src/dashboard/session-view.test.ts
git commit -m "feat: add audit route and responsive sidebar"
```

---

### Task 8: 用 Playwright 验收视觉行为并完成全量验证

**Files:**

- Modify: `e2e/web-smoke.spec.ts`

- [ ] **Step 1: 更新既有 E2E 文案与定位器**

将“新建诊断”定位器改为“新建对话”；顶部 actions 改用 overflow menu 后，先点击“会话操作”再打开“诊断详情”“日志”“配置”。

- [ ] **Step 2: 增加桌面 shell 断言**

在 1440×900 viewport 下读取 bounding boxes 并断言：

```ts
expect(sidebar.width).toBeGreaterThanOrEqual(248);
expect(sidebar.width).toBeLessThanOrEqual(264);
expect(canvas.x - (sidebar.x + sidebar.width)).toBeGreaterThanOrEqual(12);
expect(canvasBorderRadius).toBe('12px');
```

同时断言 `document.documentElement.dataset.theme === 'dark'`。

- [ ] **Step 3: 增加主题切换与移动端验收**

主题：

- 点击主题开关后根节点变为 `light`。
- reload 后仍为 `light`。

移动端 390×844：

- 会话侧栏默认不遮挡聊天。
- 点击“打开会话列表”后侧栏可见。
- 点击 backdrop 或选择会话后侧栏关闭。
- composer 与发送按钮始终在 viewport 内。

- [ ] **Step 4: 运行目标 E2E**

Run:

```bash
pnpm test:e2e -- --grep="Dashboard|theme|mobile"
```

Expected: PASS。

- [ ] **Step 5: 运行仓库规定的完整验证**

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

- [ ] **Step 6: 检查视觉实现没有临时资产或硬编码泄漏**

Run:

```bash
rg -n "Dosu|app\\.dosu|FIXME|HACK|TEMPORARY" web/src web/index.html e2e/web-smoke.spec.ts
git diff --check
```

Expected: 产品代码中不出现 Dosu 品牌/链接或本次新增临时标记，`git diff --check` 无输出。

- [ ] **Step 7: 提交最终验收**

```bash
git add e2e/web-smoke.spec.ts
git commit -m "test: verify Dosu-style dashboard behavior"
```
