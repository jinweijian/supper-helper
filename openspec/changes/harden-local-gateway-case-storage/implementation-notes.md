# Implementation Evidence

## Task Evidence

### 1.1 路径与 workspace 红灯

- 命令：`pnpm build && node --test test/gateway-case-safety.test.mjs`
- 红灯结果：3/3 失败。穿越 GET/DELETE/PATCH/chat 实际状态分别为 `200/200/404/202`；非法 workspace 的 session/chat/knowledge 实际为 `200/202/400`；repository 直接调用未抛错。
- 哨兵：真实临时目录 `sentinel.json` 位于 `cases/` 外，测试记录内容 SHA-256，并在所有攻击后验证文件仍存在且哈希不变。

### 1.2 安全标识与 containment 绿灯

- `src/sessions/case-identifier.ts` 是 Case ID 与 resolved-path containment 的 owner；`FileMemoryStore.casePath` 对 load/save/delete 统一复用。
- `src/gateway/request-contracts.ts` 是 Gateway case/workspace 输入合同 owner；session、chat、knowledge、logs routes 复用，workspace 必须来自 config allowlist。
- `src/gateway/errors.ts` 将输入合同错误统一映射为 400。
- 命令：`node --test test/gateway-case-safety.test.mjs test/fs-routes.test.mjs test/supper-helper.test.mjs`
- 结果：93/93 通过；合法 `case_*` ID、既有 session/fs/public API shape 保持通过。

Anti-Fake 复查时发现直接调用 Runtime 仍可创建未配置 workspace。新增红灯 `DiagnosticRuntime rejects an unconfigured workspace when gateway is bypassed` 后，将 allowlist 下沉到 `config.configuredWorkspaceId`，Gateway 与 `SessionLifecycle` 共用；绿灯后 focused suites 为 97/97。

### 2.1 / 2.2 输入和错误边界

- 红灯：大于 1 MiB 的 JSON body 返回 200；65,538-byte UTF-8 chat message 返回 202；畸形 JSON 返回 500；包含 Authorization、token、绝对路径的异常原样进入 500 响应。
- 绿灯：`http-utils.readJson` 统一累计原始字节，`1,048,576` bytes 为允许上限；超限返回 `413 {error:"payload too large"}`。chat 使用 `Buffer.byteLength`，超过 `65,536` 返回 `413 {error:"message too large"}`。
- 错误矩阵：缺失/非法 ID 与 workspace、畸形 JSON → 400；不存在 → 404；冲突 → 409；body/message 超限 → 413；未知异常 → 500 `internal server error`。
- 未知错误只通过 `onInternalError` 接收最长 2,000 字符的脱敏诊断；真实测试确认响应和记录均不含 Authorization、token、secret 值、绝对路径或文件名。
- 命令：`pnpm build && node --test test/gateway-case-safety.test.mjs test/supper-helper.test.mjs`；结果 89/89（加入 Runtime 绕过回归后为 97/97）通过。

### 3.1 / 3.2 原子 Case 写入

- 红灯：注入 write、fsync、rename 中断时现有构造器忽略注入，三项均因“未抛出预期异常”失败。
- 绿灯：Case 写入使用同目录 `.<caseId>.<uuid>.tmp`，依次 open/write/fsync/close/rename；任一步失败均 close/unlink 临时文件并重抛原错误。
- 三个故障点均验证旧 Case SHA-256 不变、旧 title 可解析、`listCases` 只返回正式 Case、临时文件扫描为空。
- 成功替换前后顶层 keys 完全相同；legacy Case 缺少新字段时仍可读取并以原顶层 shape 原子补齐，不增加 `case`/`data` wrapper。

## LAN Non-Goal Confirmation

未新增登录、token、RBAC、tenant 权限或 CSRF 行为。真实 server smoke 分别监听 `127.0.0.1` 与 `0.0.0.0`，两者在无 Authorization header 时均完成 `/api/health` 200、session create 200、async chat 202。

LAN dry-run：`node dist/cli.js dashboard --home <temp> --dry-run --no-open --bind lan --port 44318`，退出码 0；输出 `listen: 0.0.0.0:44318`，并保留“当前暂未启用访问令牌，请只在受信任网络中使用”警告。

## Full Verification

- `pnpm lint && pnpm typecheck && pnpm build && pnpm test`：退出码 0。
- 当次全量结果：365/365 pass，0 fail/skip/todo；随后新增 chunked Anti-Fake acceptance，最终测试数见下方最终验证记录。
- 合法 chat/session/settings/knowledge/logs/onboarding DTO shape 由既有 public API suite 保持。

## Anti-Fake-Complete Review

### 生产控制流与绕过检查

- HTTP caseId：route → `request-contracts.requireCaseId` → `sessions/case-identifier`；repository 直调仍通过 `FileMemoryStore.casePath` 做正则与 `resolve`/`relative` containment。
- workspace：Gateway 和 `SessionLifecycle` 均调用 `config.configuredWorkspaceId`。审计时发现 Runtime 绕过缺口，已经反向补红灯并修复，而不是只记录问题。
- body：所有 JSON route 复用 `http-utils.readJson`。额外用无 `Content-Length` 的 17 个 65,536-byte chunk 验证累计限制，返回 413；证明不是只信任 header。
- error：构造携带 Authorization、token、绝对路径和文件名的异常，公共响应固定为 `internal server error`，内部记录只有 `[redacted]`/`[path]`。
- atomic：write/fsync/rename 分别注入中断，旧文件哈希不变；临时文件不匹配 `*.json` 且失败后被清除。

### 合理性结论

当前单进程、单机 JSON Case 模型下，同目录临时文件 + fsync + rename 与既有 Case shape 兼容，复杂度和故障恢复能力匹配当前内测阶段。Gateway、Config/Runtime 与 Sessions 的 owner 分工合理：HTTP 状态映射不进入 repository，路径 containment 不依赖 route。

### 剩余风险

- 多进程同时写同一 Case 仍可能最后写入者覆盖前者，明确不在本 change 范围。
- 当前只 fsync 临时文件，没有对父目录额外 fsync；极端断电下 rename 的目录项持久性取决于文件系统。
- LAN 无鉴权意味着可信内网中的任意客户端仍可发起大量合法上限内请求；本轮只有单请求大小边界，没有速率限制。

### 最终验证记录

- 最终 `pnpm test`：366/366 pass，0 fail/cancelled/skipped/todo，退出码 0。
- `openspec instructions apply --change harden-local-gateway-case-storage --json`：8/8 complete，state=`all_done`。
- 提交前将暂存补丁独立应用到基于 `6e8a00d` 的 detached worktree；`pnpm test` 为 363/363 pass。当前完整工作树多出的 3 项属于未纳入本 change 的既有基线测试。
