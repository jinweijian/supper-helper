# super helper 全量修复完成矩阵

完成日期：2026-07-11。LAN 无鉴权保持为可信内网内测范围；登录、访问令牌、租户授权、OAuth MCP 和多进程 Case 写入仍不在本轮范围。

## Change 完成矩阵

| 发现 / 交付 | OpenSpec change | 生产验收与结果 | 提交 |
| --- | --- | --- | --- |
| 回合按消息 ID 隔离，Presentation 不得夹带事实 | `harden-turn-presentation-integrity` 7/7 | 真实 Runtime/FileMemoryStore 并发与相同正文消息测试；恶意 Presentation、Q2、process note、Judge score 均被阻止 | `6e8a00d` |
| Gateway 路径、输入上限、安全错误和 Case 原子写 | `harden-local-gateway-case-storage` 8/8 | 真实 127.0.0.1/0.0.0.0 HTTP；穿越、1 MiB/64 KiB、写/fsync/rename 中断、旧 Case fixture 全部通过 | `073569f` |
| Runtime-owned MCP 只读证据链 | `add-runtime-owned-mcp-evidence` 9/9 | 官方 SDK 本地 stdio/HTTP/SSE；两次串行 Runtime 调用；read_write、白名单、超时、断连与脱敏测试通过 | `f37c5ee` |
| Vue 3 + Vite 多页迁移 | `migrate-web-ui-to-vue-vite` 9/9 | 生产 Vite assets；Vitest 12/12；Playwright Chromium 2/2；历史路由和 DTO 保持兼容 | `6b0c732`，提示补充 `b33a129` |
| Knowledge health Application 用例层 | `separate-knowledge-health-application-service` 6/6 | 真实 HTTP local health 保持零远程调用；显式 probe 恰好一次并复用生产 Retrieval | `6bc189e` |
| Runtime/Agents/Onboarding 真实 owner | `complete-runtime-agents-onboarding-owner-split` 8/8 | Event phase/evidence/redaction、真实 Onboarding HTTP+SSE、owner 删除实验、Main Agent registry/prompt tests 通过 | `dafba3c` |
| Knowledge/Domain/Config 真实 owner | `complete-knowledge-domain-owner-split` 10/10 | 本地 ingest→extract→normalize→slice→audit→publish→index→retrieve；CLI 同目录验收；owner 删除与全仓行数 gate 通过 | `5d922a6` |

## 最终对抗性复盘

| 人工构造风险 | 生产边界 | 证据 | 结果 |
| --- | --- | --- | --- |
| 未审核事实 / Presentation 注入 | Result Validator + deterministic presenter | `turn-presentation-integrity`、runtime suites | 拒绝并安全降级 |
| 并发未来消息 / 相同正文 | `userMessageId` + `TurnContextSnapshot` + Case queue | 并发 Runtime/FileMemoryStore tests | 不串线，逐 ID 绑定回复 |
| Case/asset/目录路径穿越 | Gateway contract + repository containment | 真实 HTTP 和 outside sentinel tests | 400，目录外文件不变 |
| `read_write`、未白名单 MCP | Runtime MCP policy | local SDK acceptance | transport 创建前拒绝 |
| Provider/model 超时或失败 | Provider safe error + Runtime fallback | timeout/redaction/runtime tests | 有界错误，不泄漏 payload/secret |
| Case/Onboarding 进程或写入中断 | atomic replace + run recovery | write/fsync/rename/recovery tests | 旧数据可读，run 可重试 |
| Artifact 只生成但不可用 | Knowledge publish/index + production Retrieval | `acceptance:knowledge:local` | active parent 可检索且 provenance 完整 |

## 最终命令

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `pnpm test`：387/387。
- `pnpm test:e2e`：2/2。
- `pnpm acceptance:mcp:local`：19/19。
- `pnpm acceptance:knowledge:local`：1/1。

## 剩余风险

- 没有真实远程 MCP 或模型/Embedding/Rerank 厂商凭证，因此只验证了本地真实协议、生产 adapter 和确定性外部边界；未声称远程配额、凭证或网络已验证。
- 全仓仍有 7 个在 Knowledge change design 中逐项登记的既有超长状态机/决策或离线 evaluation owner；精确清单 gate 禁止新增或静默增长。
- LAN 无鉴权是明确的可信内网内测选择；路径、输入、错误脱敏、secret 和 MCP 只读边界仍已加固。
