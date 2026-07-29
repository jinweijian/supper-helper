## Context

异步回合通过进程内 Promise 和同 Case 队列执行，Case/消息/Run 持久化但执行句柄不持久化。真实 Gateway 消息角色是 `helper`，Web 当前只识别 `assistant`；Web 的约 60 秒固定轮询上限也短于后端 Worker 默认 20 分钟超时。服务重启后新进程无法继承旧任务，因此遗留 active Case 必须立即结束假运行并提供安全重试，而不是自动重复调用 Worker。

详细数据流和验收依据见 `docs/superpowers/specs/2026-07-25-session-turn-interruption-recovery-design.md`。

## Goals / Non-Goals

**Goals:**

- 统一 Web 与 Gateway 的 `user | helper` 消息合同。
- 让生产轮询持续到后端明确终态，并把临时连接错误作为重连而非任务中断。
- 启动监听前幂等中断全部遗留 active 回合。
- 通过 Runtime 所有的窄重试用例复用原 `userMessageId`。
- 使用可选 Session DTO 表达可重试状态，不改变 Case JSON 顶层 shape。

**Non-Goals:**

- 不自动续跑，不增加 lease/owner/heartbeat 或外部任务队列。
- 不改变 Worker、Evidence Review、Presentation 或知识检索行为。
- 不删除历史 partial Run 或中断审计日志。

## Decisions

1. Session 层提供纯持久化变换，Runtime 拥有恢复和重试资格决策。Gateway 只调用 Runtime 并序列化，Web 不通过中文回复猜测可重试性。这样保持 Gateway、Runtime、Sessions 和 UI 的既有边界。
2. 新进程在开始监听前扫描 `queued`、`ready_for_diagnosis`、`diagnosing` Case。新进程不可能继承旧 Promise，因此不设置宽限时间；配置热加载不扫描，避免误伤当前进程任务。
3. 恢复使用既有 logs/messages/runs 表达：active Run 降为 partial，添加绑定原消息的系统中断 helper，并写 `turn_interrupted` 日志。重复扫描按 `userMessageId` 幂等。
4. `/api/session` 派生可选 `retryableTurn: { userMessageId, interruptedAt, reason: 'service_restarted' }`。不增加 Case 顶层字段，旧消费者可忽略新 DTO 字段。
5. `POST /api/chat/retry` 接受 `caseId/userMessageId`。Runtime 验证专用中断日志、占位回复、归档状态和无正式回复后，移除占位回复、记录 `turn_retry_started`、恢复 Case 状态并通过既有队列执行 `completeUserTurn`。并发或重复重试返回冲突。
6. 生产 Web 轮询无固定次数上限；测试可显式设置边界。临时 fetch/JSON 错误进入 `reconnecting` 并有界退避，AbortController 取消不显示失败；匹配的 `helper + replyToMessageId` 优先于终态判断。

## Risks / Trade-offs

- [进程正常关闭时任务仍可能继续短暂写文件] → 启动恢复只处理新进程启动前持久化的 active 状态，原子 Case 写入和幂等日志防止重复占位；不宣称跨进程自动续跑。
- [删除错误 helper 回复] → 只删除 `turn_interrupted` 日志记录的占位回复 ID，并再次验证 `replyToMessageId`。
- [重复重试导致并行 Worker] → Runtime 在启动异步执行前原子式清理可重试标记并写 retry-started 状态；后续请求返回 409，执行仍进入 CaseTurnQueue。
- [无限轮询消耗请求] → active 时使用正常间隔，连接失败有界指数退避；页面切换和卸载主动 abort。
- [可选 DTO 影响严格消费者] → 只新增可选字段，增加公开 API 兼容测试，不改变现有字段类型。

## Migration Plan

1. 先加入 Session/Runtime 恢复与重试测试和实现。
2. 加入 Gateway retry route、启动调用和可选 DTO。
3. 更新 Web 合同、轮询状态与重试 UI。
4. 使用真实 Node server 和生产 Web 产物验证问候追问、服务重启、原回合重试和断线重连。
5. 回滚时可移除 retry route/DTO/Web 按钮，但应保留已写入的普通日志、消息和 partial Run；旧代码仍能读取 Case。

## Open Questions

无。重启策略、原回合复用和全 active 启动扫描均已确认。
