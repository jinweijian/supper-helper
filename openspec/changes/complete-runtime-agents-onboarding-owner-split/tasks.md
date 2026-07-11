## 1. 结构基线与反假完成测试

- [x] 1.1 先写 production reachability、marker、reverse re-export、300 行与 public symbol identity 失败测试。**验收目标：** 当前一行 phase/service marker 和 giant impl 必须被检测为未完成。**红灯：** `pnpm build && node --test test/module-boundaries.test.mjs` 新断言在现状失败。**绿灯条件：** 只有真实 owner 迁移后才能通过。**完成证据：** 记录被捕获文件、生产 importer 和行数清单。

## 2. Event Recorder 真实 owner

- [x] 2.1 先冻结所有 phase、payload redaction、evidence ID 引用和 public method identity。**验收目标：** 拆分前后真实 Runtime 事件序列与安全字段一致。**红灯：** owner reachability test 因现有 giant impl 失败。**绿灯：** runtime-hardening/observability tests 通过。**完成证据：** 记录 phase 集合和关键事件快照。
- [x] 2.2 将 conversation/preflight/knowledge/review/curator/worker 方法真实迁移到 owner 并删除 giant impl/marker。**验收目标：** 聚合入口只组合 sink 与 owners，任一 owner 删除会造成 typecheck/test 失败。**绿灯：** focused tests 与 300 行 gate 通过。**完成证据：** 记录每个 owner 的生产 symbol/importer 和最大行数。

## 3. Onboarding 真实 services

- [x] 3.1 先为 draft/review/run/secrets 的真实 HTTP→service→repository 路径加入失败/调用归属测试。**验收目标：** 测试不只检查 facade export identity，而能证明各 use case 由对应 service 处理。**红灯：** 当前重复 re-export 结构失败。**完成证据：** 记录每条 HTTP path 的 owner。
- [x] 3.2 迁移真实 service 行为并保留窄 facade。**验收目标：** save/validate/run/progress/review/retry/secret/config commit 与中断恢复全部兼容，owner 不反向 import facade。**真实验收：** 临时目录运行完整 onboarding HTTP+SSE 流程。**绿灯：** onboarding 全套 tests 和 boundary gate 通过。**完成证据：** 记录 persisted run/draft/review 状态摘要。

## 4. Agent 权威配置收敛

- [x] 4.1 先写重复/冲突合同 lint，覆盖 Claude session、DiagnosticResult role/answers、Presentation 和各 stage authority。**验收目标：** 现有 Main 中 per-run 与实际 per-case 冲突必须先红。**绿灯：** Main 只保留全局规则，stage configs/代码 contract 为唯一细节 authority。**完成证据：** 记录删除/迁移的重复章节和 registry 解析结果。
- [x] 4.2 运行真实 agents API、Runtime prompt assembly 与全量验证。**命令：** `pnpm lint && pnpm typecheck && pnpm build && pnpm test`。**验收目标：** `/api/agents`、preflight、presentation、case curator 行为不变且 prompt 无矛盾。**完成证据：** 记录测试总数和关键 prompt contract 断言。

## 5. 回头重新思考 / Anti-Fake-Complete Audit

- [x] 5.1 删除/禁用任一新 owner 验证测试确实失败；从真实 Runtime event 和 Onboarding HTTP/SSE 追踪生产调用，检查是否还有别名回到 giant impl、是否为满足 300 行而任意切片、Agent 规则是否仍重复。**完成条件：** 发现问题必须更新 design/spec/tasks 并修复；implementation-notes 逐模块评价 owner 是否可独立理解、使用和替换，仅写文件列表不得勾选。
