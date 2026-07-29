## Why

真实 Session API 返回 `helper` 消息，但 Vue 轮询只识别 `assistant`，导致已完成回合被误报中断；固定约 60 秒轮询上限还会把正常长任务误判为失败。服务重启后旧进程内异步任务已经丢失，持久化 active Case 却不会立即转成用户可理解、可重试的状态。

## What Changes

- 统一 Web 消息合同与 Gateway 真实 `user | helper` DTO，并按 `replyToMessageId` 判断回合完成。
- 移除生产轮询固定次数上限，区分临时连接失败、客户端取消和后端明确中断。
- 服务启动且尚未监听请求前扫描全部遗留 active Case，立即记录安全、幂等的可重试中断，不自动重复调用 Worker。
- 新增原回合重试能力和 `POST /api/chat/retry`，复用原 `userMessageId`，保留历史 Run/日志并拒绝重复或非法重试。
- `/api/session` 增加可选 `retryableTurn` 只读 DTO，不改变 Case JSON 顶层 shape。
- 增加 Session、Runtime、Gateway、Web 与真实浏览器重启回归测试。

## Capabilities

### New Capabilities

- `session-turn-continuity`: 定义真实 helper 回复识别、长任务轮询、启动中断恢复、结构化可重试状态和原回合重试合同。

### Modified Capabilities

- `runtime-behavior-compatibility`: 公开 Session DTO 只增加可选字段，既有异步 chat 成功 shape 和持久化 Case 顶层 shape 保持兼容。

## Impact

影响 `src/sessions/` 的遗留回合变换、`src/runtime/` 的恢复与重试决策、`src/gateway/` 的启动调用和 HTTP DTO、`web/` 的消息合同与轮询状态，以及对应 Node/Vitest/Playwright 测试。无新增外部依赖，不自动联网，不改变 Worker、Evidence Review、Presentation 或持久化 Case 顶层结构。
