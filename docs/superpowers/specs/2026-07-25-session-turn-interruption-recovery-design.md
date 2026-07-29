# 会话回合中断恢复设计

## 背景

会话 `case_324fb8d6` 暴露了三个相互关联的问题：

1. Gateway 返回的消息角色是 `helper`，Vue 前端合同和轮询实现却只识别 `assistant`，导致已经生成并绑定到当前用户消息的追问回复被误判为不存在。
2. 前端默认只轮询约 60 秒，而后端 Worker 默认允许执行 20 分钟。前端轮询结束不代表后台任务失败，却会被展示为“回答已中断”。
3. 异步回合只在当前 Node 进程内执行。服务重启后，持久化 Case 仍可能处于 active 状态，但旧 Promise 和内存队列已经丢失。当前实现只在长时间过期后被动收尾，不能立即向用户说明中断或提供原回合重试。

本设计同时修复消息 DTO 契约、长任务等待语义和服务重启后的明确中断恢复。

## 目标

- 前端以真实公开 DTO `user | helper` 识别关联回复。
- 前端停止把固定轮询次数耗尽解释为后台任务失败。
- 临时网络错误与后端明确中断使用不同状态和文案。
- 新服务启动时立即识别所有旧进程遗留的 active 回合，并将其转换为可重试中断。
- 用户点击“一键重试”后复用原 `userMessageId`，不复制用户消息。
- 重试仍进入既有 Runtime pipeline，不新增绕过 Preflight、Review 或 Presentation 的路径。
- 不改变 Case JSON 顶层 shape，不自动重复调用 Worker。

## 非目标

- 不实现服务重启后的自动续跑。
- 不引入持久化任务 lease、owner、heartbeat 或分布式队列。
- 不改变 Worker、Evidence Review 或 Presentation 合同。
- 不删除旧中断 Run 和审计日志。
- 不通过中断文案或中文关键词推断回合是否可重试。

## 已确认产品决策

- 重启策略：旧进程遗留回合立即明确中断，由用户一键重试，不自动调用 Worker。
- 重试语义：复用原 `userMessageId`，移除系统生成的中断占位回复，不创建重复用户消息。
- 启动扫描：扫描全部 `queued`、`ready_for_diagnosis`、`diagnosing` Case，包括尚未创建 Run 的 Preflight 前回合。
- 审计语义：旧 partial Run 和中断日志保留；中断占位回复在重试开始时删除。

## 方案比较

### 方案 A：分层恢复协议

启动时由 Session/Runtime 扫描遗留 active Case，Gateway 暴露窄重试 API，前端消费结构化的可重试回合 DTO。

优点：符合模块边界；复用原回合；不依赖文案；无需修改 Case JSON shape；可以覆盖真实重启验收。

代价：需要同时修改 Session、Runtime、Gateway 和 Web，并增加启动恢复与重试合同。

### 方案 B：前端复制原问题重新发送

中断卡直接把原问题再次提交到 `/api/chat`。

优点：实现简单，不需要新 API。

缺点：产生重复用户消息；旧回合与新回合语义混杂；不符合已确认的“复用原回合”；容易污染上下文。

### 方案 C：持久化任务状态机

为回合增加 attempt、lease、owner 和 heartbeat，服务启动后重新认领任务。

优点：可以扩展为自动续跑和多进程执行。

缺点：在当前“不自动续跑”的目标下过度设计；需要持久化 shape 和迁移策略；显著扩大失败面。

采用方案 A。

## 架构与所有权

### Sessions

`src/sessions/` 负责持久化会话事实和本地变换：

- 枚举旧进程遗留的 active Case。
- 定位尚未获得正式回复的最新用户消息。
- 将 queued/running Run 降为 partial。
- 写入结构化 `turn_interrupted` 日志，至少记录 `userMessageId`、系统中断占位回复 ID、原因和恢复时间。
- 为合法重试移除对应系统中断占位回复，并保留旧 Run 与日志。

Sessions 不调用 Runtime、Worker 或模型，也不解析 HTTP。

恢复操作必须幂等。已经存在同一 `userMessageId` 的启动中断日志和占位回复时，不得重复添加。

### Runtime

`src/runtime/` 拥有回合恢复和重试决策：

- `recoverInterruptedTurns()` 在进程启动边界调用 Session 恢复能力，将全部遗留 active 回合转换为可重试中断。
- `retryInterruptedTurn(caseId, userMessageId)` 验证 Case 未归档、用户消息存在、存在匹配的可重试中断记录、当前没有正式关联回复，也没有新的 active 回合。
- 合法重试清理中断占位回复，记录 `turn_retry_started`，把 Case 恢复为 `ready_for_diagnosis`，然后调用既有 `completeUserTurn(caseId, userMessageId)`。
- 重试继续使用同一 CaseTurnQueue 和完整 Runtime pipeline。

Runtime 不处理 URL、HTTP body 或公开 DTO。

### Gateway

`src/gateway/` 只提供 transport 和序列化：

- 新增 `POST /api/chat/retry`。
- 请求只包含 `caseId` 和 `userMessageId`。
- 非法输入返回 400，不存在返回 404，不可重试或状态冲突返回 409。
- 接受后返回 202，并沿用异步聊天已公开的 accepted 字段语义。
- `/api/session` 增加可选只读字段 `retryableTurn`，由结构化恢复日志和当前消息事实派生。

`retryableTurn` 建议 shape：

```ts
interface RetryableTurnDto {
  userMessageId: string;
  interruptedAt: string;
  reason: 'service_restarted';
}
```

该字段是可选新增字段，不修改持久化 Case JSON。旧消费者可以忽略它。

### Server 启动

`src/gateway/http-server.ts` 在创建新的应用上下文后、开始接收请求前调用一次 Runtime 恢复用例。

配置热加载不得再次扫描。热加载仍在同一进程内进行，重复扫描可能把当前仍在执行的回合误判为旧进程遗留。

### Web

`web/` 只负责客户端交互和展示：

- `MessageDto.role` 与 Gateway 对齐为 `user | helper`。
- 轮询通过 `helper + replyToMessageId` 判断当前回合完成。
- `pendingUserMessageId` 只在 active Session 中查找未获得关联 helper 回复的用户消息。
- `retryableTurn` 存在时，中断卡显示“一键重试”。
- 点击后调用 `/api/chat/retry`，收到 202 后继续轮询同一 `userMessageId`。
- 页面卸载、切换 Session 或开始另一个本地轮询时取消旧轮询，迟到响应不得覆盖当前 Session。

Web 不推断后端失败原因，不通过中断回复正文判断是否可重试。

## 数据流

### 正常回合

```text
POST /api/chat
  -> Runtime.startUserTurn
  -> persist userMessageId
  -> Runtime.completeUserTurn
  -> helper(replyToMessageId=userMessageId)
  -> GET /api/session
  -> Web detects matching helper and completes polling
```

`need_input`、`partial` 和 `concluded` 都可能是正常终态。判断成功的第一依据是是否存在绑定当前 `userMessageId` 的 helper 回复，而不是终态名称。

### 服务重启

```text
new process creates Runtime
  -> recoverInterruptedTurns()
  -> scan all persisted active Cases
  -> queued/running Runs become partial
  -> Case becomes partial
  -> append turn_interrupted log
  -> append helper interruption placeholder bound to original userMessageId
  -> /api/session exposes retryableTurn
```

启动恢复只处理新进程创建前已经存在于持久化存储中的 active Case。恢复完成后才开始监听 HTTP 请求。

### 一键重试

```text
POST /api/chat/retry { caseId, userMessageId }
  -> Runtime validates retryable interruption
  -> remove interruption placeholder
  -> keep old partial Runs and interruption logs
  -> append turn_retry_started log
  -> Case becomes ready_for_diagnosis
  -> return 202 accepted
  -> completeUserTurn(caseId, same userMessageId)
  -> existing pipeline creates formal helper reply
```

重试请求必须是幂等安全的状态转换，而不是幂等执行。第一次请求接受后，后续并发或重复请求返回 409，不得并行重复调用 Worker。

## 前端等待与错误语义

### 持续轮询

默认不设置固定 `maxPolls`。只要关联回复尚未出现且 Session 仍 active，前端持续轮询。

测试可以通过显式选项设置轮询边界，生产默认不得使用该边界表达后端失败。

### 临时连接失败

单次 HTTP、JSON 或网络错误不能把回合转换为 `interrupted`：

- 客户端进入 `reconnecting` 展示状态。
- 使用有界指数退避继续请求，例如从 500ms 增长到最多 5 秒。
- 成功响应后恢复 `running`。
- 客户端错误不写入 Case，不声称 Worker 已失败。

如果用户离开页面，轮询由 AbortController 安静取消，不显示中断提示。

### 明确中断

只有以下事实可以显示 `interrupted`：

- Session DTO 提供 `retryableTurn`。
- 后端已经生成绑定当前用户消息的中断 helper 回复。
- Session 进入非 active 状态且没有任何绑定回复，此时显示不可重试的合同异常，并建议查看日志。

固定轮询时间耗尽不属于明确中断。

## 安全与兼容

- 中断和重试日志不得包含 Worker 原始 stdout/stderr、provider payload、secret 或完整命令。
- 重试不得删除用户消息、普通 helper 回复或非目标中断回复。
- 重试不得修改历史 Run 的证据内容，只允许把旧 active Run 安全降为 partial。
- 已归档 Case、错误 Case、错误消息 ID、已有正式回复、正在执行的新回合都必须拒绝重试。
- `/api/session.retryableTurn` 是可选字段；既有成功 response shape 保持兼容。
- Case JSON 顶层 keys 不新增。恢复标记使用既有 logs/messages/runs 结构。

## 测试策略

严格先写失败测试，再写实现。

### Web 单元测试

- 真实 `helper` 回复与 `need_input` Session 被识别为完成，不误报中断。
- 旧 `assistant` 假 DTO 不再作为生产合同测试数据。
- 超过原 120 次轮询后，active Session 仍继续等待。
- 临时网络错误进入 reconnecting，后续成功后正常完成。
- AbortController 在卸载、切换会话和替换轮询时取消旧请求。
- `retryableTurn` 显示中断卡与重试按钮；点击后复用原 `userMessageId`。

### Session 与 Runtime 测试

- 启动恢复覆盖 queued、ready_for_diagnosis、diagnosing。
- 覆盖尚无 Run、queued Run 和 running Run。
- 重复调用恢复方法不产生重复日志或占位回复。
- 恢复生成的 helper 正确绑定原 `userMessageId`。
- 合法重试移除且只移除目标占位回复，保留旧 Run 和日志。
- 合法重试复用原消息并走完整 pipeline。
- 归档、消息不存在、已有正式回复、非恢复中断、重复/并发重试返回冲突。

### Gateway 合同测试

- `POST /api/chat/retry` 验证 400、404、409 和 202。
- 202 response 与异步 chat accepted 字段保持兼容。
- `/api/session` 只在可重试时暴露 `retryableTurn`。
- 旧 Case fixture 可读，持久化顶层 keys 不变。

### 真实浏览器验收

- 真实 Gateway 对问候生成 `helper` 追问和 `need_input`，页面正常展示回复，不显示中断。
- 构造持久化 active Case 后启动新服务，首次打开页面立即看到服务重启中断和一键重试。
- 点击重试后 HTTP 请求使用原 `userMessageId`，对话中不增加第二条用户消息，最终出现正式 helper 回复。
- 临时断开 Session API 后恢复，页面先显示重新连接，再继续完成，不显示虚假后台中断。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
```

## 完成标准

- `case_324fb8d6` 对应的真实 DTO 模式不再触发前端误中断。
- 正常长任务不会因为前端固定 60 秒边界被宣告失败。
- 服务重启后遗留 active Case 在开始接收请求前被立即转换为可重试中断。
- 一键重试复用原 `userMessageId`，不重复用户消息，不并发重复执行。
- Runtime pipeline、Evidence Review、公开 API 兼容和 Case JSON 顶层 shape 均保持。
- 单元、合同、全量和真实浏览器测试全部通过。
