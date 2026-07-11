# Implementation Evidence

## Task Evidence

- 1.1 红灯：`pnpm build && node --test test/application-knowledge-health.test.mjs` 首次 2/2 失败，准确捕获 `src/knowledge/health-service.ts -> src/retrieval/configured-search.ts` 反向 import，以及 Gateway route 直接依赖 Knowledge health。绿灯 focused suite 4/4。
- 真实 HTTP provider trap：使用真实 `startServer`、FileMemoryStore、临时知识目录、生产 BM25 + SiliconFlow rerank adapter。带最新用户消息的 `/api/session` 后 request count=0；无 query `/api/knowledge/health` 后仍为 0；显式 query 后恰为 1，Authorization 到达 trap 且公开 DTO 不含 secret；随后 bind/reindex 即使 body 带 query，count 仍为 1。
- 1.2 dependency graph 从 `Gateway -> Knowledge -> Retrieval -> Provider` 调整为 `Gateway/CLI -> Application -> Knowledge(local)` 或 `Application -> Retrieval -> Provider`。扫描 `src/knowledge` 无 retrieval/provider factory import，Gateway route 只接收 application service contract，不组合算法。
- 2.1 `GatewayApplicationContext` 在启动和 reload 时创建 `KnowledgeManagementService`。`/api/session` 调 `getLocalHealth`；health 无 query 调 `getLocalHealth`；health query 调 `probeSearch`；bind/reindex 分别调用同名 application method，并返回原有顶层 DTO shape。
- 2.2 Vue Network 序列由 Playwright 断言：打开并刷新 active Case 后 `/api/knowledge/health` 请求数为 0；点击“知识健康 -> 测试检索”后恰为 1。`src/knowledge/health.ts` 的 action 文案同步改为“测试检索”，错误继续由现有 banner 显示。
- 3.1 fake composition acceptance：真实临时目录写入 FAQ、构建 BM25 与 fake vector artifact，再由 production `createKnowledgeManagementService().probeSearch` 执行。trace 为 `bm25=ran`、`embedding=ran`、`rerank=ran`，matchedFiles=1，与 Runtime 使用的 configured retrieval composition 相同。
- 最终完整闸门：`pnpm lint`、`pnpm typecheck`、`pnpm build` 全部通过；`pnpm test` 376/376；`pnpm test:web` 11/11；`pnpm test:e2e` Chromium 2/2，retries=0、无 skip。
- 隔离 staged-tree：从暂存树生成 detached worktree 后，lint/typecheck/build 通过，Node suite 373/373、Vitest 11/11、Chromium 2/2；当前工作树额外 3 项来自未暂存的后续 owner-split 基线。

## Anti-Fake-Complete Review

- 五条生产路径已逐一追踪：Session/local health 在 Application 终止于 Knowledge 本地 artifact；explicit query 从 Application 进入 configured Retrieval，再进入 provider；bind/reindex 只写 Knowledge artifact 并重新读取 local health。provider trap 验证真实入口，不是注入内部 mock。
- `buildKnowledgeHealthSummary` 已彻底移除 query 和 retriever factory 参数；Knowledge local contract 不可能自行发起远程检索。CLI status/doctor 也迁移到 Application local health，不保留别名绕路。
- Application 当前 70 行，只拥有跨 Knowledge/Retrieval 的四个用例和 search DTO 内部映射；不含 HTTP 状态码、厂商协议、检索算法或持久化细节，尚未成为杂物层。Gateway 仍只负责参数/DTO，Runtime retrieval 未改变。
- 风险：显式 probe 仍会按现有 provider 配置产生远程费用，这是预期且由 UI 明示触发；provider 自身失败按 Retrieval 既有 fallback/trace 处理。LAN 无鉴权行为保持不变。
