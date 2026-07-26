# Dosu 风格会话界面与回合连续性设计

## 背景

本次改造同时解决两个用户可见问题：

1. 将 `super helper` 当前的诊断 Dashboard 改造成接近 Dosu 样本的会话阅读界面。
2. 修复已有历史 Run 的会话再次提问时，页面立即显示“回答已中断”的错误状态。

目标样本是 Dosu 的问答页。改造借鉴其页面骨架、阅读密度、暗色层级和输入器布局，但保留 `super helper` 的产品语义、诊断状态、会话能力、知识健康、日志、配置和 Evidence Review 边界。

本设计不复制 Dosu 的品牌、文案或知识文档树数据模型。

## 已确认决策

- 采用“结构映射”方案，而不是只换颜色或完整复制 Dosu。
- 默认展示暗色主题，同时保留浅色主题切换。
- 不为本次视觉改造新增知识文档树 API。
- 继续使用 Vue 3、Vue Router 和现有 Vanilla CSS，不迁移框架，不增加 UI 依赖。
- 修复必须覆盖 Gateway 状态投影、Runtime 终态提交顺序和 Web 轮询生命周期，不能只隐藏错误提示。
- 不修改 Case JSON 顶层 shape，不绕过 Runtime、Evidence Review 或 Presentation。

## 已确认根因

### 历史结果覆盖当前回合

新消息进入 Runtime 后，`SessionLifecycle.startUserTurn()` 已将 Case 状态保存为 `ready_for_diagnosis`。

但 Gateway 的 `publicSessionStatus()` 在本轮新 Run 尚未创建时，会读取历史最新 Run 的结果。例如上一轮结果是 `partial`，则公开 Session DTO 会把当前 `ready_for_diagnosis` 错误映射为 `partial`。

Web 轮询尚未找到绑定当前 `userMessageId` 的 helper 回复，又看到非 active 状态，于第一轮轮询立即抛出“回答已中断”。

真实 Case 的时间线证明后台没有停止：

- 当前用户消息：`2026-07-26T12:49:39.999Z`
- 匹配 helper 回复：`2026-07-26T12:49:56.681Z`
- 后台继续执行约 16.7 秒

### 终态早于 helper 落盘

即使修复历史结果覆盖，当前 Runtime 仍有第二个竞态：

```text
Worker / Knowledge / Experience 产生结果
  -> Case 提前保存为 partial 或 concluded
  -> Evidence Review / Presentation
  -> helper 回复最后落盘
```

Presentation 可能包含模型调用。历史数据中，Worker 完成到 helper 落盘曾相隔约 12.4 秒。前端在这个窗口轮询时仍会看到“终态且没有回复”，从而误判中断。

### 与立即中断无关的独立错误

最新 `run_10` 最终失败是 Claude CLI 收到腾讯 TokenHub 402：试用额度耗尽且未启用后付费。这是外部模型服务错误，不是前端 AbortController 取消了 Worker。

修复后，此类错误应作为经过 Review 的 helper 失败回复正常展示，不能显示为“后台被立即中断”。

## 方案比较

### 方案 A：Dosu 结构映射与完整回合提交

重组现有 Vue 页面骨架；同时修正 Gateway 当前状态优先级、Runtime 终态提交顺序和 Web 轮询生命周期。

优点：

- 视觉目标与用户给出的样本一致。
- 保留现有业务能力和模块边界。
- 从数据流根源消除两类假中断。
- 不增加持久化 shape 或外部依赖。

代价：

- 涉及 Gateway、Runtime、Web 和 E2E 测试。
- 需要把当前分散的“审核后回复提交”收敛成单一 Runtime helper。

采用本方案。

### 方案 B：仅换肤并放宽前端状态判断

只修改 CSS，并让前端遇到 `partial` 时继续等待。

优点是改动少；缺点是信息架构仍然像 Dashboard，Runtime 的终态竞态仍存在，前端继续承担诊断决策。

不采用。

### 方案 C：完整复制 Dosu 的文档树和双层导航

新增知识文档目录、文档详情、知识搜索、文档级会话等能力。

该方案需要新的 Gateway/Knowledge API 和产品数据模型，明显超出本次“会话界面与中断修复”的范围。

不采用。

## 工作流拆分

本次交付包含两个相互独立但需要共同验收的工作流：

1. 回合连续性：Gateway、Runtime 和 Web 状态机。
2. Dosu 风格界面：Web 组件、路由与样式。

两个工作流分别测试，最后通过真实浏览器场景联合验收。

## 回合连续性设计

### Gateway：当前 active 状态优先

`sessionSummary()` 仍负责公开 DTO 序列化，但必须遵守以下优先级：

1. 当前 Case 是 `queued`、`ready_for_diagnosis` 或 `diagnosing` 时，直接返回当前 Case 状态。
2. 当前存在 queued/running Run 时，返回当前 Case 的 active 状态。
3. 只有当前 Case 已进入非 active 状态时，才允许使用最新已验证 DiagnosticResult 校正历史不一致的 terminal 状态。

这样保留现有“无效 concluded 结果公开降级为 partial”的兼容行为，同时阻止历史 Run 覆盖当前回合。

Gateway 不新增诊断决策；它只按 Runtime 已冻结的当前状态序列化。

### Runtime：helper 先于 terminal status

Evidence Review 可以冻结 validated result、Run status 和最终 decision，但不能在 Presentation 完成前把 Case 提交为 terminal。

新增一个 Runtime 内部窄 helper，负责提交审核后的用户回复：

```text
reviewAndFormat()
  -> 得到 reply、decision、caseStatus
  -> add helper(replyToMessageId)
  -> record final user_reply event
  -> set Case terminal status
  -> save Case
```

该 helper 由 Experience、Knowledge、MCP 和 Worker 四条回答路径共同使用。

设计不要求文件级事务，但保证所有可观察中间态安全：

- helper 落盘前：Case 仍是 active。
- helper 已落盘但 terminal status 尚未保存：Web 已能用 `replyToMessageId` 判断本轮完成。
- terminal status 已保存：匹配 helper 已存在。

`recordTurnFailure()` 也使用相同顺序：先写绑定当前消息的安全失败 helper，再提交 `partial`。

### Web：只认当前回合事实

Web 轮询以 `userMessageId` 为唯一当前回合标识。

状态规则：

1. 匹配 `retryableTurn.userMessageId` 时显示明确中断和“一键重试”。
2. 存在正式 `helper + replyToMessageId` 时完成。
3. 未找到匹配 helper 时继续等待，不根据历史 Session terminal 状态立即声明中断。
4. 网络或 JSON 错误进入 `reconnecting`，成功后恢复。
5. 页面卸载、切换会话、开始新轮询时取消旧轮询，不产生错误提示。

后端必须保证正常完成、失败和启动恢复最终都会产生绑定当前消息的 helper。Web 不通过中文文案判断失败类型。

### 取消和迟到响应

当前 AbortController 只取消本地 delay，没有传给实际 fetch。本次修复要求：

- `apiJson()` 接受并传递 `AbortSignal`。
- `useChat()` 暴露 `cancel()`。
- 页面卸载、切换会话、新发送和新轮询前调用 `cancel()`。
- 每次轮询持有 generation ID；旧 generation 的响应不得更新 `progress` 或当前 Session。
- AbortError 安静结束，不写 `chat.error`，不显示中断。

### 错误展示

Chat 回合错误只在对话流中的进度/错误组件显示一次。

顶部全局横幅只用于页面级 Session 初始化或导航错误，不再重复展示 `chat.error`。

Worker 402、超时和执行失败继续通过 Runtime 的安全 Review fallback 生成 helper 内容；UI 将其作为本轮正式回复展示。

## Dosu 风格界面设计

### 页面骨架

桌面布局：

```text
┌──────────────── 256px sidebar ────────────────┬─ 16px ─┬──────────────── main canvas ────────────────┐
│ 品牌 / workspace                              │        │ 极简标题栏                                   │
│ 全局搜索 / 新建诊断                           │        ├──────────────────────────────────────────────┤
│ 知识状态入口                                  │        │ 文档式会话内容                               │
│ 历史会话列表                                  │        │                                              │
│                                               │        ├──────────────────────────────────────────────┤
│ 主题 / 辅助入口                               │        │ 浮动富输入器                                 │
└───────────────────────────────────────────────┴────────┴──────────────────────────────────────────────┘
```

- 外层背景：`#141414`。
- 主画布：接近黑色的 `#050505`。
- 主画布外边距：16px。
- 主画布圆角：12px。
- 分隔线：约 `#303030`。
- 桌面侧栏宽度：256px。
- 回答阅读宽度：最大约 960px，但输入器可接近主区全宽。

### 左侧栏

左侧栏保留现有 Session 能力，并映射 Dosu 的信息层级：

1. `super helper` 品牌与当前 workspace。
2. “搜索”与“新建诊断”主入口。
3. 知识健康入口，显示可用、需处理或未绑定状态。
4. 历史会话搜索和会话列表。
5. 主题切换与辅助入口。

不新增文档树。现有 Session 状态筛选改成紧凑筛选菜单或分段控件，避免占据主要视觉层级。

侧栏在窄桌面可折叠为约 64–72px 的图标栏；移动端作为可关闭的 slide-over，不再堆叠成页面顶部的 260px 列表。

### 主标题栏

标题栏使用单行结构：

- 左侧：侧栏切换、新建诊断、当前会话标题。
- 右侧：复制当前链接、更多菜单。
- workspace 与状态作为低对比辅助信息，不占独立大行。

“诊断详情”“日志”“配置”进入更多菜单，保留可访问名称、键盘焦点和现有 Drawer 行为。

### 回答区

回答区改为文档阅读器，而不是连续卡片：

- helper 内容无气泡背景，使用段落、列表、代码块和引用层级。
- 用户消息保留轻量强调，但缩小绿色气泡感，避免压过答案。
- 角色与时间使用低对比元信息。
- 内容区增加留白，正文行高约 1.65。
- 长代码块保留横向滚动和清晰边界。

`RichAnswer` 在不增加依赖的前提下补充：

- 安全 Markdown 链接。
- 有序列表与引用。
- 代码块语言标签和复制按钮。
- 回答操作栏：复制回答；赞踩只做禁用占位或不展示，除非存在真实后端行为。

不创建无后端行为的假按钮。

### 输入器

输入器采用 Dosu 式底部浮动容器：

- 高度约 136–152px。
- 顶部为多行 textarea。
- 底部左侧是知识源状态和用户视角 chip。
- 底部右侧是发送按钮。
- Enter 发送，Shift+Enter 换行。
- 发送、重连、归档和上下文已满状态有明确 disabled/状态反馈。

继续使用原生 textarea 和 select/button 的可访问语义，不引入复杂 contenteditable 编辑器。

### 主题

- 首次访问默认暗色。
- 保留浅色主题并持久化用户选择。
- 两套主题使用相同几何、间距和层级，不让浅色模式退回旧 Dashboard 风格。
- 不加载远程字体；字体栈优先 `Inter`，回退系统 sans-serif。

### 路由

正式注册：

- `/`
- `/sessions/:id`
- `/sessions/:id/audit`

使用 Vue Router 导航替代手写 `history.pushState`。直接刷新 audit URL 必须可恢复同一页面。

### 可访问性与响应式

- 所有图标按钮必须有可见 tooltip 或 `aria-label`。
- 保留 Drawer 的 Escape 关闭和焦点归还。
- 焦点环使用单一绿色 accent，满足暗色和浅色对比度。
- 支持 `prefers-reduced-motion`。
- 触控目标不小于 40px。
- 820px 以下侧栏进入 slide-over；主画布取消外边距和圆角。
- 代码块、长标题和会话摘要不得造成水平页面滚动。

## 模块边界

### `src/gateway/`

- 只修正 Session DTO 的状态序列化优先级。
- 不调用 Worker，不决定是否继续诊断，不格式化最终回复。

### `src/runtime/`

- 拥有 validated result、最终 Case 状态和 helper 提交顺序。
- 收敛四条审核后回复路径。

### `src/sessions/`

- 保持 Case repository 和启动恢复职责。
- 不调用模型或 Runtime。
- Case JSON 顶层 shape 不变。

### `web/`

- 负责基于公开 DTO 展示状态、轮询、取消和页面布局。
- 不根据问题文案或 Worker trace 判断诊断结果。

## 主要修改位置

回合连续性：

- `src/gateway/dto.ts`
- `src/runtime/contracts.ts`
- `src/runtime/review-presentation.ts`
- `src/runtime/experience-turn.ts`
- `src/runtime/knowledge-turn.ts`
- `src/runtime/worker-diagnosis.ts`
- `src/runtime/diagnostic-runtime.ts`
- `src/runtime/session-lifecycle.ts`
- `web/src/shared/api.ts`
- `web/src/dashboard/use-chat.ts`
- `web/src/dashboard/App.vue`

视觉与交互：

- `web/src/dashboard/App.vue`
- `web/src/dashboard/SessionSidebar.vue`
- `web/src/dashboard/ChatPanel.vue`
- `web/src/dashboard/ChatProgressCard.vue`
- `web/src/dashboard/RichAnswer.vue`
- `web/src/dashboard/main.ts`
- `web/src/dashboard/use-theme.ts`
- `web/src/styles.css`

## 测试设计

所有行为修复先写失败测试并确认失败原因，再写生产代码。

### Gateway

- 已有历史 `partial` Run，当前 Case 为 `ready_for_diagnosis` 时，公开状态保持 active。
- 已有历史 `concluded` Run，当前 Case 为 `diagnosing` 时，公开状态保持 active。
- 当前 Case 真正 terminal 且最新 validated result 被降级时，继续公开正确的 `partial`。
- `/api/sessions` 与 `/api/session` 保持相同状态语义。

### Runtime

- 使用可控 Promise 延迟 Presentation，期间 Session 仍为 active。
- helper 落盘后才提交 terminal Case status。
- Experience、Knowledge、MCP 和 Worker 四条路径使用相同顺序。
- Worker failure 和 `recordTurnFailure()` 始终生成绑定当前 `userMessageId` 的 helper。
- 启动恢复和原回合重试继续复用既有 pipeline。

### Web 单元测试

- 有历史失败 Run 的第二轮提问不会立即中断。
- terminal DTO 与 helper 同时到达时完成并展示 helper。
- retryable interruption 优先显示重试，而不是误判 completed。
- 生产轮询超过旧 120 次边界仍继续。
- 网络错误进入 reconnecting，恢复后完成。
- fetch 收到 AbortSignal；切换会话和卸载会 abort。
- 旧轮询迟到响应不能覆盖当前会话。
- Chat 错误不同时出现在顶部横幅和消息流。
- RichAnswer 安全处理链接、代码复制、引用和列表。

### 浏览器验收

- 具有历史 partial Run 的 Case 再次提问，页面持续显示处理中，最终展示匹配 helper。
- 延迟 Presentation 期间不出现中断。
- Worker 返回 402 时展示真实失败 helper，不显示假中断。
- 服务重启后显示结构化可重试状态。
- 切换会话后旧请求不会跳回旧会话。
- 桌面暗色布局与 Dosu 样本的 256px 侧栏、16px 外边距、12px 主画布圆角和底部宽输入器一致。
- 浅色、窄桌面和移动端无溢出，键盘可完整操作。

## 兼容与非目标

- 不改变 `/api/chat` 已有成功 response shape。
- Session DTO 仅修正错误状态值，不删除字段。
- 不改变持久化 Case JSON 顶层 keys。
- 不改变 Worker、DiagnosticRequest、DiagnosticResult 或 Evidence Review 的外部合同。
- 不自动购买额度、修改 TokenHub 账户或更换模型 provider。
- 不新增文档树、知识文档编辑或赞踩后端。
- 不在本次改造中迁移 CSS 框架或状态管理库。

## OpenSpec 处理

实施前更新现有 `harden-session-turn-continuity` change：

- 补充“历史结果不得覆盖当前 active 回合”。
- 补充“helper 先于 terminal Case status”的提交顺序。
- 修正已经勾选但实际缺失的 Web、Abort、重连、真实重启和第二轮 E2E 测试任务。

Dosu 风格视觉改造作为独立 Web 工作流记录在实施计划中，不改变 Runtime 或公开数据模型。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test:web
pnpm test
pnpm test:e2e
```

还需使用真实 Chrome 对本地页面进行桌面、窄桌面和移动端人工验收。

## 完成标准

- 新回合不会被历史 Run 状态覆盖。
- helper 落盘前不会公开 terminal Case 状态。
- Web 不再从瞬时 Session terminal 状态推断“回答已中断”。
- 网络取消、切换会话和迟到响应行为可预测且有测试。
- 402 等 Worker 失败显示为正式安全回复。
- 页面在桌面暗色下达到 Dosu 样本的结构、密度和交互层级，同时保留 `super helper` 的诊断能力。
- 浅色与响应式布局可用。
- 全部 lint、typecheck、build、Node/Vitest/Playwright 测试通过。
