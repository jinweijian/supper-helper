## Why

项目目前只保存 MCP 配置和 allowlist，却没有生产调用链；`allowedMcpToolIds` 无法产生 MCP evidence，也未过滤 read_write 或具体工具。需要实现 Runtime-owned、可审计且默认只读的真实 MCP 能力。

## What Changes

- 新增独立 MCP contracts、官方 SDK client 和 stdio/Streamable HTTP/legacy SSE transports。
- Runtime 在 Knowledge 后、Worker 前最多串行执行两次受控 MCP 调用。
- 强制 enabled、workspace allowlist、read_only、精确工具名和 stdio command whitelist。
- 支持静态 Header/env SecretRef，默认测试不联网、不依赖真实凭证。
- 将 MCP 结果归一化为 evidence/claims，完整覆盖 AnswerGoal 才能直答，否则继续 Worker。

## Capabilities

### New Capabilities

- `runtime-owned-mcp-evidence`: MCP 发现、计划、只读执行、证据化、审核和降级合同。

### Modified Capabilities

- `diagnostic-agent-runtime`: 新增 Knowledge 与 Worker 之间的 MCP evidence 阶段。
- `multi-agent-configuration`: 新增不可面向用户的 MCP Planner/Extractor 配置。

## Impact

新增 `src/mcp/`、Runtime MCP service、配置 schema、SecretRef 应用、审计事件与本地真实 MCP acceptance；引入 `@modelcontextprotocol/sdk@1.29.0` 和 Zod 4，不实现 OAuth。
