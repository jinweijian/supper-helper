## 1. Session/Runtime 启动恢复与原回合重试

- [x] 1.1 写 Session 层恢复变换的失败测试：扫描全部 active Case、覆盖无 Run/queued Run/running Run、幂等、占位回复绑定原 userMessageId。
- [x] 1.2 实现 `src/sessions/stale-turn.ts` 的 `markInheritedActiveTurnsRetryable()`，使用既有 logs/messages/runs 表达中断。
- [x] 1.3 写 Runtime 层 `recoverInterruptedTurns()` 和 `retryInterruptedTurn()` 的失败测试：合法重试复用原消息、移除占位、保留旧 Run/日志；归档/不存在/已有正式回复/非可重试/重复并发拒绝。
- [x] 1.4 实现 `src/runtime/diagnostic-runtime.ts` 的恢复与重试方法，复用既有 `completeUserTurn` pipeline 和 CaseTurnQueue。
- [x] 1.5 运行 `pnpm test` 确认 Session/Runtime 测试通过。

## 2. Gateway 重试 API 与 retryableTurn DTO

- [x] 2.1 写 Gateway 合同失败测试：`POST /api/chat/retry` 的 400/404/409/202；`/api/session` 在可重试时返回 `retryableTurn`，否则省略。
- [x] 2.2 实现 `src/gateway/routes/chat-routes.ts` 的 retry route 和 `src/gateway/dto.ts` 的可选 `retryableTurn` 派生。
- [x] 2.3 在 `src/gateway/http-server.ts` 启动时调用一次 `agent.recoverInterruptedTurns()`，配置热加载不重复扫描。
- [x] 2.4 运行 `pnpm test` 确认 Gateway 合同测试通过。

## 3. Web helper 合同、持续轮询、重连与重试交互

- [x] 3.1 写 Web 单元失败测试：真实 `helper` + `need_input` 完成；超过 120 次仍 active 继续等待；临时网络错误进入 reconnecting；AbortController 取消不显示中断；`retryableTurn` 显示重试按钮；点击后复用原 userMessageId。
- [x] 3.2 修改 `web/src/shared/contracts.ts` 的 `MessageDto.role` 为 `user | helper`，修改 `web/src/dashboard/use-chat.ts` 的轮询逻辑：移除固定 maxPolls、增加 reconnecting 状态和 AbortController 取消。
- [x] 3.3 修改 `web/src/dashboard/ChatProgressCard.vue` 和 `ChatPanel.vue`：中断卡展示重试按钮，点击调用 `/api/chat/retry` 后继续轮询。
- [x] 3.4 运行 `pnpm test:web` 确认 Web 单元测试通过。

## 4. 真实浏览器回归验收

- [x] 4.1 写 Playwright 失败测试：真实 Gateway 问候不误报中断；构造持久化 active Case 后重启服务，页面显示中断和重试按钮；点击重试后同一 userMessageId 得到正式回复；临时断线后恢复不显示虚假中断。
- [x] 4.2 运行 `pnpm test:e2e` 确认真实浏览器验收通过。

## 5. 完整验证

- [x] 5.1 运行 `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm test:e2e`，全部通过。
