## 1. 全仓 Knowledge 结构基线

- [x] 1.1 生成 production TS/Vue 行数、import graph、marker、reverse re-export 和 artifact schema 基线，并先写失败 gate。**验收目标：** 当前 quality/onboarding-style 空壳模式和未批准 >300 行实现均被明确列出。**红灯：** `pnpm build && node --test test/module-boundaries.test.mjs` 新 gate 在现状失败。**完成证据：** implementation-notes 保存路径、行数、owner、生产 importer 和允许例外候选，不保存生成产物正文。

## 2. Quality 真实拆分

- [x] 2.1 先冻结 source/slice/chunk rules、aggregation、gate、report IO、chunk map 的 fixture 输出与 import independence。**验收目标：** 单独 import gate/report IO 不加载 complete audit owner。**红灯：** 当前 reverse export 结构失败。**绿灯：** quality fixture suite 通过。**完成证据：** 记录规则数量、report schema key 和 dependency graph。
- [x] 2.2 迁移真实 rules/IO/aggregation，删除 marker 与 giant reverse出口。**验收目标：** audit orchestrator 只发现输入和组合规则，各 owner ≤300 行且有 production importer。**绿灯：** quality/knowledge/boundary tests 通过。**完成证据：** 记录 owner symbols、最大行数和 fixture 等价结果。

## 3. Knowledge Pipeline 真实拆分

- [x] 3.1 按 extract/slice/repair/publish/vector/frontmatter 逐 capability 写 artifact 等价失败测试。**验收目标：** 每批测试真实临时文件、幂等、失败恢复、旧 artifact 读取，而非内部 mock。**红灯：** 新 owner API 尚不存在时失败。**完成证据：** 记录每类 artifact 的 schema-significant hash/字段。
- [x] 3.2 依次提取 contracts/pure transforms/artifact IO/service orchestration 并迁移 CLI/Onboarding importers。**验收目标：** CLI 不含算法，Knowledge 不 import Runtime/Gateway/Worker/remote Provider，所有实现 owner ≤300 行或有明确例外。**绿灯：** knowledge、vector、quality、CLI、boundary suites 通过。**完成证据：** 每批记录 production data flow 与例外理由。

## 4. Shared Domain/Config/Types

- [x] 4.1 先写 capability import isolation 和 public aggregator 无行为失败测试。**验收目标：** Provider/Settings/Runtime 可只 import 所需 contract，不加载无关 capability implementation。**红灯：** 当前聚合类型依赖过宽时失败。**完成证据：** 记录目标 dependency graph。
- [x] 4.2 拆分 domain/config/knowledge types，保持 public type names、config defaults 和 persisted/artifact shape。**验收目标：** 原聚合入口只做类型/常量 re-export，不含 factory、IO 或策略。**绿灯：** typecheck、config、provider、session、knowledge suites 通过。**完成证据：** 记录 public symbol diff 和旧 config/Case/artifact fixture 兼容结果。

## 5. 本地端到端 Pipeline 与全量验证

- [x] 5.1 使用真实临时目录完成 ingest→extract→slice→audit→review→publish→index→retrieve。**验收目标：** 最终 evidence 命中发布 parent，含 source document/block/section provenance；生产 services 和 CLI 至少各走一次。**红灯：** 先让 acceptance 断言新 owners 的 trace/reachability。**绿灯：** `pnpm acceptance:knowledge:local` 通过。**完成证据：** 记录各阶段计数、artifact 路径类别和 evidence IDs，不保存完整源文。
- [x] 5.2 运行 `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm acceptance:knowledge:local`。**验收目标：** 无网络、无真实凭证、无未批准 oversized owner、无 marker/reverse giant。**完成证据：** 测试总数、行数扫描、exception 清单和命令退出码。

## 6. 回头重新思考 / Anti-Fake-Complete Audit

- [x] 6.1 删除或绕过每类新 owner，确认结构/端到端测试确实失败；重新检查 artifact 是否只“能生成”却无法检索、是否改变旧 schema、是否为行数任意切片、是否产生循环或越界 import。**完成条件：** 对 Quality、Pipeline、Shared Contracts 分别回答当前设计是否合理；任何假完成必须反向补 design/spec/tasks 并修复；implementation-notes 形成最终大文件/例外/生产可达性矩阵。
