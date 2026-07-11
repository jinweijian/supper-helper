## 1. Local Health 与显式 Probe 合同

- [x] 1.1 先写真实 HTTP provider-trap 失败测试。**验收目标：** `/api/session` 和无 query 的 health 即使 config 启用远程 provider，也产生零 provider 请求；显式 query 恰好产生一次生产 retrieval。**红灯：** `pnpm build && node --test test/application-knowledge-health.test.mjs` 在现有隐式 retriever 上失败。**绿灯：** focused test 通过。**完成证据：** 记录 trap request count、route 状态和 search DTO。
- [x] 1.2 定义 application use-case contract 与 local/probe 两条数据流。**验收目标：** Knowledge local contract 不接受 provider/retrieval factory，Gateway route 不组合算法。**红灯：** module scan 先捕获现有 knowledge→retrieval import。**绿灯：** boundary test 通过。**完成证据：** 记录 dependency graph 前后差异。

## 2. 生产用例迁移

- [x] 2.1 实现 local health、explicit probe、bind、reindex application service 并迁移 Gateway。**验收目标：** 所有 `/api/knowledge/*` 与 session health 字段保持，默认读取不联网。**绿灯：** `node --test test/application-knowledge-health.test.mjs test/supper-helper.test.mjs` 通过。**真实验收：** 启动真实 Node server 和本地 fake-provider HTTP trap。**完成证据：** 记录每个入口调用的 application method 和 provider count。
- [x] 2.2 更新 UI/文档使“测试检索”成为显式动作。**验收目标：** 打开 Case 不触发 probe，点击动作带 query 请求并显示结果/错误。**红灯：** UI/API interaction test 先失败。**绿灯：** web/HTTP tests 通过。**完成证据：** 记录两条网络序列。

## 3. 兼容与全量验证

- [x] 3.1 运行本地 BM25/fake embedding/rerank probe 和全量验证。**验收目标：** probe trace 与 Runtime configured retrieval strategies/rerank 一致；公开 DTO 不变。**命令：** `pnpm lint && pnpm typecheck && pnpm build && pnpm test`。**完成证据：** 记录 trace 摘要、测试总数、零隐式网络证明。

## 4. 回头重新思考 / Anti-Fake-Complete Audit

- [x] 4.1 从 `/api/session`、无 query health、显式 query、bind、reindex 五条真实路径追踪到 application/knowledge/retrieval/provider，检查 application 是否成为杂物层、Knowledge 是否仍通过别名反向依赖 Retrieval、测试是否只注入 mock。**完成条件：** provider trap 与 production composition 同时证明边界；发现缺口反向补 artifact/测试；implementation-notes 评价当前 use-case 层是否合理。
