# Vue 迁移能力校准设计

## 背景

Dashboard 从单文件 UI 迁移到 Vue 后，保留了页面骨架和 HTTP 接口，却丢失了旧版已经验证的关键交互：问答期间的动态进度、请求中断识别、日志渐进披露，以及配置检测的持续反馈。这属于迁移能力回退，而不是合理简化。

本设计采用“逐项恢复旧版能力，再按 Vue 边界重建”。旧版行为是最低能力基线；Vue 可以改进结构、可访问性和视觉表达，但不得降低状态语义、失败反馈、信息层级或用户判断能力。

## 目标

- 问答执行期间持续展示真实进展、耗时、心跳与中断状态。
- 日志恢复摘要卡片与按需展开，不再默认平铺完整 JSON。
- 模型、Embedding、Rerank 检测从开始到结束始终有可见反馈。
- 建立旧版到 Vue 的能力校准矩阵和真实浏览器回归闸门。
- 保持 Gateway、Runtime、Settings 和 Observability 的既有所有权及 HTTP DTO 兼容。

## 非目标

- 不恢复旧版 `src/ui.ts` 巨型实现。
- 不追求旧版 HTML、CSS 或动画的像素级复制。
- 不制造精确倒计时；模型和 Worker 耗时不可可靠预测。
- 不改变 Runtime 阶段决策、日志持久化 shape、Case JSON shape 或公开 HTTP response shape。
- 不实现 LAN 鉴权。

## 方案与原则

以旧版能力清单为契约，在 Vue 中按责任拆分：

- composable 管理异步状态、轮询、心跳、错误和公开 DTO；
- component 只把状态转换为可访问的交互界面；
- Gateway 继续只提供 HTTP 数据，不承担 UI 进度估算；
- Runtime 和 Observability 继续提供真实阶段与日志事实，前端不得虚构执行结果。

任何“优化”必须先证明能力等价，再改进表达。视觉简化不能删除状态，组件拆分不能删除控制流，测试迁移不能只验证按钮存在。

## 能力校准矩阵

| 旧版能力 | Vue 当前缺口 | Vue 完成标准 |
| --- | --- | --- |
| 每轮 polling 更新 Session | 只在最终完成后更新 | 每次成功轮询都把最新 Session 送入页面 |
| 动态阶段卡片与进度轨道 | 只有固定“正在审核”文案 | 展示真实状态映射、阶段、百分比和活动摘要 |
| 运行耗时与活动变化 | 不可见 | 展示已耗时及最近心跳时间 |
| 估计等待时间 | 不可见 | 展示经验区间并明确不是精确倒计时 |
| 页面刷新恢复未完成任务 | 后台轮询但页面不更新 | 恢复进度卡且持续更新 Session |
| 中断后停止假装思考 | 仅全局错误或超时 | 进度卡进入 interrupted，说明原因和下一步 |
| 日志摘要卡片 | 完整 block JSON 平铺 | 摘要层只显示核心元数据 |
| 日志详情按需展开 | 默认全部展开 | `<details>` 或等价可访问 disclosure |
| 最近日志默认展开 | 无层级 | 默认展开最近少量条目，支持全部展开/收起 |
| 测试连接的进行中反馈 | Form 被 loading 条件卸载 | Form 保持挂载，显示具体动作状态与耗时 |
| 测试当前未保存输入 | 事件已传 payload，但反馈不明确 | 请求使用当前表单 payload，并有契约测试 |
| 测试成功/失败结果 | 通用短文案或表单消失 | 展示安全、具体、动作级结果 |

## 问答进度设计

### 所有权

- `use-chat.ts` 负责轮询生命周期、最新 Session、时间与错误状态。
- `App.vue` 负责把轮询中的 Session 同步到 `useSessions.current`。
- 新的进度展示组件负责状态映射与渲染，不执行 HTTP。
- `ChatPanel.vue` 负责在对话流中放置进度卡和中断卡。

### 数据流

1. 用户发送消息，`POST /api/chat` 返回 `caseId` 和 `userMessageId`。
2. `useChat` 立即进入 queued 状态并记录 `startedAt`。
3. 每次 `GET /api/session` 成功后：
   - 更新 `latestSession`；
   - 更新 `lastActivityAt`；
   - 通过回调或 reactive state 让 `App.vue` 立即替换当前 Session；
   - 从 session status、最新 run 与 agentActivity 计算当前阶段。
4. 找到绑定该 `userMessageId` 的 assistant 回复时进入 completed。
5. Session 不再 active 却没有对应回复、轮询超时、网络请求失败或组件恢复失败时进入 interrupted。

### 展示状态

进度卡至少包含：

- 当前阶段名称和解释；
- 阶段轨道与有界百分比；
- 已耗时；
- 最近活动距现在多久；
- 正常耗时范围，例如“通常还需 1–3 分钟”；
- 当前 Agent/Worker 活动摘要（存在时）；
- 超过心跳阈值的等待提示。

经验范围来自固定阶段画像，只用于预期管理，必须标注为估计。不得把百分比或时间区间记录回 Runtime，也不得声称精确完成时间。

### 中断语义

以下情况必须结束动画并显示中断：

- poll 达到上限；
- HTTP 或 JSON 错误；
- Session 状态已退出 active，但没有绑定回复；
- 恢复未完成回合时找不到待回复的用户消息。

中断卡展示安全错误、最后活动时间，并建议重试或打开日志。不能继续显示运行点或扫描动画。

## 日志设计

### 所有权

- `use-logs.ts` 保留结构化 `DiagnosticLogBlock`，并管理刷新状态。
- 新建日志列表/日志卡组件负责 disclosure 状态与可访问性。
- Observability DTO 保持不变，前端不重新决定日志严重级别。

### 摘要与详情

摘要层展示：label、title、severity、createdAt、agentName/actor、phase 和关键 tags。详情展开后展示 command、detail 或 body；对象使用格式化 JSON。

默认展开最新 3 条，其余折叠。用户手动展开/收起的 ID 在刷新后保留；新出现的最近日志可按默认规则展开。提供“全部展开”和“全部收起”。使用原生 `<details>/<summary>` 或等价键盘可操作组件。

## 配置检测设计

### 所有权

- `use-settings.ts` 将单个全局 `loading` 拆为动作状态：load、saveModel、testModel、testEmbedding、testRerank。
- `SettingsForm.vue` 始终保持挂载，显示动作级状态、耗时和结果。
- Gateway 与 Settings 服务保持现有请求和安全错误合同。

### 行为

- 点击检测后立即显示“正在测试…”，启动耗时计数。
- 只禁用当前动作和会产生冲突的保存动作，不卸载表单。
- 请求使用点击时当前表单值；未输入 API Key 时不提交 key，沿用服务端已有凭证行为。
- 成功显示 provider/model 等安全摘要；失败显示经过 API 归一化的安全错误。
- 所有 resolve/reject 路径必须结束 running 状态。
- 用户关闭再打开抽屉时，可以看到最近一次检测结果，但不会自动重复调用。

## 组件边界

建议新增：

- `web/src/dashboard/ChatProgressCard.vue`：进度与中断展示。
- `web/src/dashboard/chat-progress.ts`：阶段映射、百分比、耗时范围等纯函数。
- `web/src/dashboard/LogCard.vue`：单条日志 disclosure。
- `web/src/dashboard/LogList.vue`：默认展开、全部展开/收起、刷新状态保留。
- `web/src/dashboard/settings-action-state.ts`：动作状态 contract 与纯格式化函数（仅在 composable 复杂度需要时）。

现有 `App.vue` 只做组合，不加入阶段业务表或日志格式化逻辑。

## 错误处理与安全

- 进度、日志和配置错误均使用安全 API 错误，不显示 provider payload、Authorization、token、原始 stdout/stderr 或非必要绝对路径。
- 日志 detail 只显示服务端已经脱敏的 DTO。
- 计时器和 polling 在完成、失败、切换会话或组件卸载时清理。
- 旧请求迟到时不得覆盖新会话或新检测动作的状态。
- 默认测试不联网、不使用真实凭证。

## 测试策略

严格先失败后通过：

1. `use-chat`：每次 poll 发布最新 Session；阶段变化可观察；完成、中断、超时与恢复均结束正确状态。
2. 进度组件：阶段、百分比、耗时、心跳、估计范围和 interrupted 显示；完成后不残留动画。
3. 日志组件：默认只展开最近 3 条、详情按需显示、全部展开/收起、刷新保留用户状态、键盘操作。
4. Settings：点击测试期间表单不卸载，当前 payload 被发送，running/success/error 和耗时可见，所有失败路径复位。
5. Playwright 使用真实 Node Gateway 与生产 Vite 产物验证：
   - 异步问答至少经历两个不同阶段，页面动态变化；
   - 模拟中断后明确显示中断；
   - 日志以折叠卡片出现并可展开；
   - 模型测试发出真实本地 fixture HTTP 请求，并展示进行中与结果。

最终运行：

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
```

## 完成合同

- 能力矩阵每一行都有自动测试和真实浏览器证据。
- 生产数据真实经过 `/api/chat`、`/api/session`、`/api/logs` 和 `/api/settings/*/test`。
- 旧版能力没有因为 Vue 组件化再次丢失。
- 不改变公开 DTO、Case 持久化、Runtime 决策或 LAN 部署范围。
- 发现其他同类迁移回退时，必须补入矩阵并修复，不能只记录为后续事项。
