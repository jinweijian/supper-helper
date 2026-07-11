# Implementation Evidence

## Official Dependency Record

- `@modelcontextprotocol/sdk` 锁定 `1.29.0`；`zod` 安装为 `4.4.3`，由 pnpm lock 固定。
- 官方依据：`https://github.com/modelcontextprotocol/typescript-sdk`，访问日期 2026-07-11。采用稳定 v1.x，不采用预发布 v2。
- `rg '@modelcontextprotocol' src/runtime src/gateway` 为零；SDK import 只存在 `src/mcp/sdk-client.ts`，Runtime/Gateway 面向 MCP port/policy。

## Task Evidence

### 1.1 / 1.2 Contract 与配置

- 红灯：`dist/mcp/policy.js` 不存在，focused test 以 `ERR_MODULE_NOT_FOUND` 失败。
- 绿灯：旧 `mcpTools` 配置可加载；缺 `allowedToolNames` 返回 `tool_allowlist_missing`。disabled、read_write、workspace 未授权、工具未列入 allowlist、stdio command 未列入 host command whitelist 均在 client factory 前拒绝，factory 调用计数为 0。
- Header/env 只接受 `SecretRef`，由执行时 resolver materialize；配置对象未被写入明文。

### 2.1 三协议真实 adapter

- stdio 红灯：生产 `sdk-client.js` 不存在；随后使用官方 `McpServer + StdioServerTransport` 子进程转绿。
- HTTP/SSE 红灯：fixture 已真实监听但生产 adapter 明确抛出 `unsupported MCP protocol: http|sse`；实现官方 StreamableHTTPClientTransport 与 SSEClientTransport 后转绿。
- focused 结果：12 tests 中三协议 list/call/close 均通过；stdio 与 HTTP 各约一次调用，SSE session 在 client close 与 fixture SIGTERM 时关闭。证据只断言协议/工具结果前缀，不记录完整 payload。

### 2.2 Normalizer 与错误矩阵

- text + structuredContent 总预算 20,000 字符；测试输入 25,000 字符并确认 `truncated=true`。Authorization、token、绝对路径和文件名均不进入 normalized result。
- 1,024-byte image 与 2,048-byte blob 仅保留 kind/MIME/size/locator，base64 前缀不存在于序列化结果。
- create/connect 的 429 secret-bearing error 返回稳定 `transport_failure`；挂起 client 在 20ms 测试 timeout 后返回 `timeout` 且 close 恰好一次。生产默认 timeout 为 15,000ms。

### 3.1 / 3.2 Runtime chain

- 红灯：真实 Runtime 完成后 Worker request 的 `context.mcp` 为 undefined；接入 `McpEvidenceService` 后转绿。
- production order：Experience → Knowledge → MCP evidence → Worker → Review。Knowledge 已返回时控制流直接 return，不进入 MCP。
- 真实 stdio Runtime 配置三个允许工具；只执行前两个，第二次参数包含第一次 normalized text/structuredContent，第三个 `forbidden-third` 不出现在 context 或日志。
- 普通 MCP 输出生成 `mcp_ev_*` supporting evidence 并进入 Worker request；显式 `superHelperEvidence` 高置信 envelope 只有在 primary claim 覆盖全部 mustAnswerItems 时生成 concluded result，经现有 Review/Presentation 后直答，Worker 调用数为 0。
- `/api/agents` 真实 HTTP 返回 `mcp_planner` 和 `mcp_evidence_extractor`，均 `mayProduceUserFacingText=false`。
- Anti-Fake 发现 File SecretRef resolver 未进入默认 Runtime composition；补红灯后增加 `DiagnosticRuntimeOptions.mcp`，Gateway 只传 resolver，明文仅在 transport materialization 内存中存在，原 config 不变。

## External Acceptance

未配置用户授权的远程 MCP server 或凭证，因此未执行外部 acceptance，也不声称已验证第三方服务兼容性。影响：真实公网代理、厂商 429 格式和特定 SSE 实现差异仍有风险；本地官方 SDK 三协议与 secret-bearing fake error 已覆盖协议基本行为和安全降级。

## Anti-Fake-Complete Review

- 生产可达性：真实 DiagnosticRuntime 在 Knowledge 未完成后调用 `McpEvidenceService`；该 service 使用 `executeMcpTool` 与生产 `createSdkMcpClient`。三协议 acceptance 没有替换 adapter。
- 权限顺序：disabled、read_write、workspace 未授权、缺 allowlist、工具未列入 allowlist、stdio command 未在 host whitelist 均证明 client factory 调用为 0。
- 两次预算：真实 stdio 配置三个工具，只生成两个 calls/evidence；第二次输入只含第一次 normalized result，第三次未执行。
- Review 边界：普通输出只能进入 `context.mcp` 后继续 Worker；只有 Zod 严格验证的高置信 `superHelperEvidence`、primary fact/inference 和 mustAnswerItems 全覆盖才形成 result，仍经过既有 Review/Presentation。
- 审计发现并修复两处假完成风险：File SecretRef 未进入 Runtime composition；未知 `assumption` 被默认升级为 fact。两者均先补红灯再修复。
- 设计结论：Runtime 拥有顺序与最终 Review，MCP 模块拥有 transport/policy/normalizer，Gateway 仅注入 secret resolver；边界合理。剩余风险是第三方协议差异、server 对“只读”的虚假声明以及多工具智能规划质量。

## Final Verification

- `pnpm test`：385/385 pass，0 fail/skip/todo。
- `pnpm acceptance:mcp:local`：19/19 pass，stdio、Streamable HTTP、legacy SSE 均使用生产 SDK adapter。
- `openspec instructions apply --change add-runtime-owned-mcp-evidence --json`：9/9 complete，state=`all_done`。
- 提交前基于 `073569f` 的 detached worktree 仅应用暂存补丁：`pnpm test` 382/382，`pnpm acceptance:mcp:local` 19/19；完整工作树多出的 3 项属于未纳入本 change 的既有基线测试。
