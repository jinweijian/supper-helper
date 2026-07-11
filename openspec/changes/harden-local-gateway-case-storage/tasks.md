## 1. 路径与 Workspace 边界

- [x] 1.1 先写真实 HTTP/FileMemoryStore 目录穿越与非法 workspace 失败测试。**验收目标：** load/delete/save/chat/knowledge 的非法标识返回 400，目录外哨兵 JSON 未被读取或删除。**红灯：** `pnpm build && node --test test/gateway-case-safety.test.mjs` 必须在现有 `casePath` 拼接上失败。**绿灯：** focused test 通过。**完成证据：** 记录哨兵路径哈希、响应状态和文件仍存在证明。
- [x] 1.2 实现共享安全 ID/workspace resolver 和 repository containment。**验收目标：** 所有入口复用同一 contract，合法旧 ID 仍可读取。**红灯：** 增加绕过 route 直接调用 repository 的失败用例。**绿灯：** safety、session、fs-route、public API tests 通过。**完成证据：** 列出所有生产 importer 和合法兼容 fixture。

## 2. 输入与错误边界

- [x] 2.1 先写 1 MiB body、64 KiB message、连接恢复和 secret-bearing 500 失败测试。**验收目标：** 超限稳定 413，后续正常请求可用，公共错误无原始异常/路径/secret。**红灯：** 真实 HTTP test 在现有无限读取/原始 error 上失败。**绿灯：** `node --test test/gateway-case-safety.test.mjs test/supper-helper.test.mjs` 通过。**完成证据：** 记录实际字节边界、响应 JSON 和脱敏断言。
- [x] 2.2 实现 bounded JSON reader、typed gateway errors 和统一安全错误 mapper。**验收目标：** routes 不复制 size/error 决策，未知错误只在安全内部日志保留。**红灯：** route boundary test 先检测重复/raw error。**绿灯：** focused tests、`pnpm typecheck` 通过。**完成证据：** 保存错误分类矩阵和每类状态码。

## 3. 原子 Case 写入

- [x] 3.1 先写真实临时目录的 fault-injection 测试。**验收目标：** temp 写/flush/rename 任一步失败时旧 Case 可解析，listCases 不列 temp，成功后没有残留。**红灯：** 当前直接覆盖实现无法满足保留旧文件。**绿灯：** repository acceptance 通过。**完成证据：** 记录故障点、旧文件校验和、残留扫描结果。
- [x] 3.2 实现同目录原子写并验证旧 Case shape。**验收目标：** 顶层 JSON keys 不新增，历史 fixture 加载后不被无关重写。**绿灯：** session lifecycle、storage scope、stale recovery 和 public API tests 通过。**完成证据：** 记录 before/after schema key 对比。

## 4. 全量与 LAN 兼容

- [x] 4.1 运行合法 API shape、LAN dry-run 与全量验证。**验收目标：** 无鉴权 LAN 行为/警告保持，所有合法接口 shape 不变。**命令：** `pnpm lint && pnpm typecheck && pnpm build && pnpm test`。**真实验收：** 启动 loopback 与 LAN server，各完成 health/session/chat smoke。**完成证据：** 记录监听地址、状态码、测试总数；不得记录用户正文或 secret。

## 5. 回头重新思考 / Anti-Fake-Complete Audit

- [x] 5.1 绕过 Gateway 直接攻击 repository，构造编码路径、超限 chunk、rename 中断、raw error 和连续正常请求，检查是否只是 route 测试假绿。**完成条件：** 证明每层均有正确 owner，LAN 未被意外鉴权或放宽路径边界；发现缺口必须更新 artifact 并修复；implementation-notes 必须评估当前单进程 JSON 设计是否仍合理及多进程剩余风险。
