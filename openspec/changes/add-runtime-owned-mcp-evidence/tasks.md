## 1. MCP Contracts 与配置安全

- [x] 1.1 先写 config migration、SecretRef、read_only、allowedToolNames 和 command whitelist 失败测试。**验收目标：** 旧配置可读但缺 allowlist 时不可执行；read_write/disabled/未知 command 均在连接前拒绝。**红灯：** `pnpm build && node --test test/mcp-runtime.test.mjs` 因无 MCP contract 失败。**绿灯：** contract tests 通过且默认不联网。**完成证据：** 记录每个拒绝原因和零 transport-call 计数。
- [x] 1.2 引入锁定 SDK/Zod 并实现 capability-scoped config/port。**验收目标：** Runtime/Gateway 不 import SDK transport；SecretRef 明文不进入 public settings。**绿灯：** provider/module boundary tests 与 typecheck 通过。**完成证据：** 记录依赖版本、官方 URL/访问日期、import boundary 扫描。

## 2. 三类真实 Transport

- [x] 2.1 先建立官方 SDK 本地 stdio、Streamable HTTP、legacy SSE fixture 与失败 acceptance。**验收目标：** 测试启动真实进程/HTTP server，生产 adapter 完成 connect/listTools/callTool/close。**红灯：** adapters 尚不存在时明确失败。**绿灯：** `pnpm acceptance:mcp:local` 三协议均通过。**完成证据：** 记录协议、工具名、调用次数、关闭状态；不得记录完整工具结果。
- [x] 2.2 实现 transports、15 秒超时和 20,000 字符安全 normalizer。**验收目标：** text/structuredContent 可证据化，image/blob 仅 locator；429、断连、脏 JSON、secret-bearing error 安全降级。**绿灯：** local acceptance 与 error matrix tests 通过。**完成证据：** 记录裁剪长度、脱敏断言和无残留进程证明。

## 3. Runtime Planner/Executor/Extractor

- [x] 3.1 先写真实 Runtime 次序、两次串行预算和第三次拒绝测试。**验收目标：** Knowledge final 时 MCP 不运行；partial 时最多两次，第二 planner 只见第一次安全结果，第三次为零执行。**红灯：** 生产 Runtime 无 MCP 阶段时失败。**绿灯：** `node --test test/mcp-runtime.test.mjs test/supper-helper.test.mjs` 通过。**完成证据：** 记录 lifecycle phase 与调用计数。
- [x] 3.2 实现 MCP Agent configs、planner/executor/extractor 和 `context.mcp`。**验收目标：** full MCP claims 经 Review 后直答；partial evidence 进入 Worker request；MCP/MCP工具均不能直接写用户回复。**红灯：** 先加入 full/partial/unsupported fact 失败场景。**绿灯：** runtime/evidence/agents API tests 通过。**完成证据：** 记录 AnswerGoal 覆盖矩阵、evidence IDs 和 Worker 是否调用。

## 4. 默认离线与外部显式验收

- [x] 4.1 运行默认全量和网络哨兵。**验收目标：** `pnpm test` 无外部 DNS/HTTP，fake/local fixture 可重复。**命令：** `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm acceptance:mcp:local`。**完成证据：** 记录测试总数、三协议通过结果和网络哨兵。
- [x] 4.2 有远程 MCP 配置时执行显式 acceptance；无凭证/服务时记录未验。**验收目标：** 真实 server 完成 discover+allowed call，日志无 header/token/完整敏感结果。**完成证据：** 只记录 server ID、协议、工具名、状态、耗时和脱敏检查；无环境时写明影响与风险，不得声称已验证。

## 5. 回头重新思考 / Anti-Fake-Complete Audit

- [x] 5.1 从真实 Runtime 追踪 Knowledge→Planner→真实 transport→Extractor→Review→Worker，主动尝试 read_write、未 allowlist、第三次调用、schema 注入、超时和 secret error。**完成条件：** 证明生产 adapter 而非 fake 被本地 acceptance 使用；检查 MCP 配置命名和 Runtime ownership 是否合理；任何假完成或边界穿透必须反向补 artifact/测试，implementation-notes 写明结论与剩余第三方兼容风险。
