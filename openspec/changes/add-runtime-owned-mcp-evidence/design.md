## Context

现有 config 可登记 MCP server，但 Runtime/Worker 没有 client adapter，`allowedMcpToolIds` 仅作为请求字段存在。需要新增正式模块而不能让 Gateway、Claude prompt 或配置文件自行执行工具。

## Goals / Non-Goals

**Goals:**

- 支持 stdio、Streamable HTTP 和 legacy SSE 的真实只读 MCP 调用。
- Runtime 最多串行两次规划/执行，并把结果变成可审核 evidence。
- 默认离线、凭证安全、失败可降级。

**Non-Goals:**

- 不实现 OAuth、read_write MCP、无限循环规划或 MCP 直接回复用户。
- 不把 MCP SDK 协议细节放入 Runtime/Gateway。

## Decisions

1. 新增 `src/mcp/`，包含稳定 port、SDK client factory、三类 transport、safe result normalizer。官方依赖锁定 `@modelcontextprotocol/sdk@1.29.0` + Zod 4；依据官方 v1.x 生产建议，访问日期 2026-07-11：`https://github.com/modelcontextprotocol/typescript-sdk`。
2. 保留 `mcpTools`/`mcpToolIds` 字段名兼容，但配置使用 discriminated union：stdio 为 command/args/cwd/env SecretRef；http/sse 为 url/headers SecretRef。新增 `allowedToolNames`、timeoutMs；缺失工具名时仅允许 discover。
3. Runtime 新增不可见 MCP Planner/Extractor Agent。Planner 输入 AnswerGoal、可用 tool schema 和前次安全结果，输出单一 tool call 或 stop；每 run 最多两次。Executor 在每次调用前重新校验 enabled、workspace、read_only、工具名和 command whitelist。
4. tool result 文本和 structuredContent 最多保留 20,000 字符；image/blob 只记录 MIME、大小和 locator。所有 header/env/错误先脱敏再持久化。
5. Extractor 只能从 MCP evidence 生成 claim 并引用 evidence ID。完整覆盖 AnswerGoal 时进入 Review；否则写入可选 `context.mcp` 并继续 Worker。
6. MCP 连接每次调用后关闭；超时 15 秒。第二次 planner 只接收第一次归一化结果，不接收原始 transport payload。

## Risks / Trade-offs

- [server 自称只读但工具有副作用] → 同时要求 server `permission=read_only` 和人工配置精确 `allowedToolNames`；未知工具拒绝。
- [模型生成错误参数] → SDK schema validation 前再做 JSON/schema 校验，失败不执行。
- [外部协议差异] → 本地真实三 transport acceptance 必过；远程服务只显式 opt-in。

## Migration Plan

旧配置继续加载；缺少新字段时 health 显示不可执行原因，不猜测默认工具。新 `context.mcp` 为可选字段，旧 Case 直接读取。

## Open Questions

无。已确认每 Run 最多两次、Runtime 独立调度、静态 SecretRef header。
