# fix-answer-fidelity-and-retrieval-quality 任务

> 本 change 不拆分，但必须依次通过 Gate A（回答投影）、Gate B（AnswerGoal）、Gate C（知识检索）和跨 Gate 验收。每个实现任务都遵守 RED → GREEN → REFACTOR；没有记录失败测试、通过测试和兼容证据，不得勾选。

## 0. 合同冻结与改动前基线

- [x] 0.1 在 `implementation-notes.md` 记录改动前可复现链路：supporting rejection 连坐、fallback 吞 `next_action`、renderer 可达 raw result、Preflight items 被默认值覆盖/少报子问题、producer `answers` 过度标注、coverage 只适配 Knowledge 或直传 raw/stale Evidence、Experience 历史 reply 自报全覆盖或当前 evidence 已变化、opaque prompt 夹带事实、双 publisher 丢失更新、v3/平面 artifact 与域相关 span/Judge pattern；每项附测试或最小复现命令及结果
- [x] 0.2 使用固定 `test/fixtures/retrieval/production-eval-50.json` 运行改动前离线评估，记录 Recall@5、MRR、direct precision、no-hit abstention、must-escalate 与命令/退出码；不得先改 fixture 再记录基线
- [x] 0.3 记录兼容基线：公共 HTTP response shape、Case JSON shape、`DiagnosticRequest`/`DiagnosticResult` 字段、旧 v3 artifact 读取行为
- [x] 0.4 记录依赖结论：不新增外部 API/协议/凭据类型；真实 provider 仅复用现有 adapter 与 SecretRef/env，默认验收不读取真实凭据
- [x] 0.5 运行 `openspec validate fix-answer-fidelity-and-retrieval-quality --strict`，把基线结果写入实现记录

## Gate A — 回答审核与冻结投影

### 1. RED：局部拒绝、全局阻断与联合覆盖

- [x] 1.1 先为 `result-validator`/`review-gate` 写失败测试：一个无效 supporting claim 被移除，但原始 `concluded + final_answer` 且剩余 primary coverage 完整时仍可 final
- [x] 1.2 写失败测试：primary claim 被局部拒绝后覆盖缺项，结果按全局 coverage blocker 降级
- [x] 1.3 写失败测试：两个 accepted primary claims 的 reviewer-accepted bindings 并集覆盖全部 items，且所有合法 `fullQuestionClaimIds` 都进入 frozen primary 时保持 final；无单 claim 全覆盖也必须通过
- [x] 1.4 写失败测试：稳定 primary set 是 greedy item-cover 与 reviewer-required full-question IDs 的原顺序并集；不在两者中的冗余 primary 不成为 frozen direct answer，但补足同一 item 内条件/时效且列入 `fullQuestionClaimIds` 的 claim 必须保留
- [x] 1.5 写失败测试：producer 把只回答一半问题的 claim 过度标注为覆盖全部 items 时，independent AnswerCoverageReview 只接受受支持 binding，并因完整 `resolvedQuestion` 仍缺项阻断 final
- [x] 1.6 写失败测试：sentinel 路径仍审核完整 `resolvedQuestion`；coverage reviewer unavailable/malformed/unknown 时保守非 final
- [x] 1.6a 写失败测试：当前 Worker workspace evidence 与当前 allowlisted read-only MCP evidence 经 source-neutral segments 可分别保持合法 final；不得因它们没有 Knowledge canonical span 而一律失败
- [x] 1.6b 写失败测试：raw `Evidence.summary/source`、secret/path、provider payload、trace、完整 retrieval text、未选 evidence 不进入 coverage reviewer payload；claim/evidence 1000/1001、20/21 claims、40/41 evidence 与总文本 24000/24001 边界按合同保守失败且不字符截断
- [x] 1.7 写失败测试：上游 Evidence Review 的结构化 conflict blocker、claim/evidence ID 不唯一、结果级结构损坏时阻断 final；另测无结构化 signal 时不得用自然语言关键词或 fixture 特判猜冲突
- [x] 1.8 写失败测试：清洗后的完整 coverage 不得把原始 partial/ask_user/escalate 升级为 final
- [x] 1.9 写失败测试：coverage 缺失且有安全可回答 `missingInfo` 时 outcome 为 ask_user；无用户可补信息且无需 escalation 时为 partial；安全/身份 blocker 为 escalate
- [x] 1.10 运行上述 focused tests，确认它们因目标行为尚未实现而失败，并在 `implementation-notes.md` 记录 RED 命令、退出码和失败断言

### 2. GREEN：实现 result validation 与 frozen projection

- [x] 2.1 在 `src/runtime/result-validator.ts` 明确定义 claim-local rejection 与 result-global blocker；删除 `rejectedClaimIds.length > 0` 等连坐逻辑
- [x] 2.2 建立统一 runtime-only `CoverageClaimSegment`/`CoverageEvidenceSegment` 与 `AnswerCoverageReview` contract：producer `answers` 仅为 candidate；materializer 为 Knowledge/Workspace/MCP/current manual/current log 生成 stable ID + safe text + kind/freshness enum，不修改公共 Evidence shape，不传 raw summary/source/payload/trace/完整 retrieval text；每 turn 单次 batch 最多 20 claims、40 evidence、每项 1000、总文本 24000，超限/unknown/failure 保守非 final
- [x] 2.3 抽取 coverage helper：eligible claim 必须 accepted、`role=primary_answer`、类型为 fact/inference 且有 reviewer-accepted binding；按原始顺序冻结 greedy item-cover + valid full-question-required IDs 的稳定并集，并要求 full-question=`full`、missingElements 为空、所有 required IDs 均合法且已包含
- [x] 2.4 修改 `src/runtime/rag-answerability-service.ts`、Knowledge/MCP/Worker/Experience review 消费，统一通过 runtime coverage-review service 复用该 contract；更新 `src/agents/evidence-coverage.md` 与 registry contract tests，禁止 raw producer answers 或 producer 同次 model 输出直接授予 coverage
- [x] 2.4a 实现 source eligibility/materializer：Knowledge 只取 current active v4 strict-eligible canonical span；当前 Worker/MCP 使用 same-run validated evidence；manual 只绑定 current sourceMessageId；log 只取 same-run safe excerpt；history/unknown 不生成 coverage segment；任一 required segment超界、清洗为空或 freshness 无法证明时阻断 final
- [x] 2.5 修改 `src/runtime/review-gate.ts`：outcome 只能保持或降级；按“不可恢复安全/身份 blocker 或 upstream escalate 优先 → 保持 upstream ask_user/partial → 仅完整安全的 final 保持 final，否则 ask_user/partial”的状态表生成确定性 reason code
- [x] 2.6 在 runtime 内实现两阶段边界：validated result → reviewed ID selection → materialized `SafeFrozenAnswerProjection`；后者包含已脱敏 claim segments、有界脱敏 evidence segments+claim bindings、带来源的 unknown/missing-info prompts、最终 outcome 和 required IDs
- [x] 2.7 required primary/actionable 安全物化失败时加入 global blocker 并按状态表重新冻结一次 outcome；optional 超限只记录 omitted count
- [x] 2.8 改造生产 renderer 签名：只能接收 safe projection、persona 与受限 layout，禁止传入 `DiagnosticResult`、summary、全量 claims/evidence 或 trace，也禁止按 evidence ID 回查 raw evidence；用类型/production composition 测试证明 raw result 不可达
- [x] 2.9 运行 1.x focused tests，确认 GREEN；记录命令、退出码与关键断言

### 3. RED：model/fallback 同源渲染与整份回复安全

- [x] 3.1 写失败测试：model plan 与 fallback 都渲染 frozen primary/preliminary、全部 bounded required `next_action` 和 frozen supporting claims
- [x] 3.2 写失败测试：plan 遗漏 required action、directAnswer 集合不等、缺少 factual claim 所需 evidence、结构 malformed 或清洗为空时必须 fallback
- [x] 3.3 写失败测试：未知 optional claim、`process_note`/`evidence_locator`、重复 ID、unreferenced evidence 按 droppable 矩阵清洗后复验
- [x] 3.4 写失败测试：model 返回自定义 `answerTarget` 不影响渲染；reviewed DiagnosticResult 的 model/fallback 均使用 runtime-owned anchor；Preflight/Curator/system message 明确不依赖 frozen projection
- [x] 3.5 写失败测试：rejected fact 同时存在于 summary、unused evidence 或后续段落时不可通过 segment provenance 回流；opaque unknown/missingInfo 即使 source 合法，只要夹带未审核事实或 prompt-safety reviewer unavailable/malformed/unknown，也必须整项不可见并重新冻结 ask-user outcome
- [x] 3.6 写失败测试：`search.provider -> embedding`、安全文件名、接口/错误名在 operations/support/developer 中保留；secret、用户目录、内部 knowledge path 在所有 persona/字段中被屏蔽
- [x] 3.7 写失败测试：partial 且存在 relevant accepted primary inference 时先显示“初步判断”；仅剩 supporting fact/inference 时分别标“已确认线索”/“推断线索”，均不得冒充 direct answer；final primary inference 仍保留 inference 标签
- [x] 3.8 写失败测试：无 frozen action 时才允许明确标注的只读“通用建议”，不得包含诊断特定原因或声称动作已执行
- [x] 3.9 写失败测试：primary/preliminary/action 1000/1001、supporting 600/601、unknown/missingInfo 5/6 项与 300/301 code points；required 超界阻断，optional 超界剔除，任何 claim 均不得字符截断
- [x] 3.10 运行上述 focused tests，确认 RED 并记录真实失败证据

### 4. GREEN：实现统一 Presentation 投影、清洗和安全扫描

- [x] 4.1 修改 `src/runtime/review-presentation.ts`：model 只排序 frozen IDs；实现 fatal/droppable 矩阵、稳定去重、required IDs/evidence 完整性复验
- [x] 4.2 抽取 `presentation-redaction.ts`（或等价纯 runtime 模块），并实现 runtime `VisiblePromptSafetyReview` service + 新登记的 `src/agents/visible-prompt-safety.md` model-assisted config：每 turn 至多一次、最多 10 个已做 secret/path 清洗的 prompt candidate，输入不含 raw result/summary/evidence/trace，只做 ID 级 accept/reject；缺 ID、失败/unknown 保守不可见
- [x] 4.3 固定顺序为 normalize → secret redaction → path/internal-source redaction → bounds → bounded prompt-safety batch review → claim-only persona simplification → materialize safe segments → assemble → structural provenance check → deterministic whole-reply secret/path/trace scan；accepted prompt text 不再由 persona 重写，只套封闭追问标签
- [x] 4.4 修改 `src/runtime/presenter.ts`：model/fallback 只渲染同一 safe materialized projection；summary/raw result 不在函数签名；persona 模板只提供封闭的非事实结构标签
- [x] 4.5 删除硬编码业务特判和会替代真实 `next_action` 的 persona 固定步骤；仅在无 action 时使用明确标注的通用只读建议
- [x] 4.6 `answerTarget` 只由 `resolvedQuestion` 派生：清理控制字符和敏感内容、最多 160 Unicode code points、清洗为空使用中性锚点；忽略 model 同名字段
- [x] 4.7 每个 factual/action segment 必须结构化映射 accepted claim ID 和直接 evidence；每个 unknown/missing-info segment 必须带 accepted non-factual prompt-review provenance；final text scan 只做可确定的 secret/internal trace/provider payload/path 检测，不写自然语言“事实真伪”关键词判断
- [x] 4.8 实现 1000/600/300 code-point 与 5-item 边界；投影 claim 不得在配置 key/value、命令、编号步骤、否定词或授权状态中间截断；required 超界重新冻结/降级
- [x] 4.9 若 `presenter.ts` 仍混合选择、脱敏和格式化，在 `implementation-notes.md` 记录模块边界例外依据；否则完成纯模块抽取并补单测
- [x] 4.10 运行 3.x focused tests，确认 GREEN，并记录 model/fallback golden reply

### 5. Gate A 闸门

- [x] 5.1 运行 result-validator、review-gate、review-presentation、presenter 相关完整测试文件
- [x] 5.2 检查所有 reviewed-DiagnosticResult reply 构建入口只接收 safe projection，没有从 raw result summary/evidence 绕行；单独列出 Preflight、Curator、transport/system formatter 及其既有安全合同
- [x] 5.3 在 `implementation-notes.md` 填写 Gate A RED/GREEN/兼容证据；未通过不得进入 Gate B 完成状态

## Gate B — AnswerGoal 与 worker actionable 合同

### 6. RED：Preflight 分解、reconcile 与 exact identity

- [x] 6.1 写失败测试：model-assisted Preflight 返回 1–5 个合法连续子串，且独立 AnswerGoalCompletenessReview 确认覆盖全部用户答案义务时，trim/空白折叠/稳定去重后被采纳
- [x] 6.2 写失败测试：非数组、0 项、>5 项、任一非字符串/空/超过 80 Unicode code points/含控制字符/secret-shaped 时整个集合回退 `[DIRECT_ANSWER_ITEM]`
- [x] 6.3 写失败测试：item proposer 或独立 completeness reviewer 缺失/超时/malformed/unknown 时回退 sentinel，且 turn 继续；proposer 自评完整不得替代第二次独立调用
- [x] 6.4 写失败测试：model 试图改写 `rawUserQuestion`、`resolvedQuestion`、`answerObject` 或 source identities 时被忽略
- [x] 6.5 写失败测试：accepted items 经 Preflight reconcile 后不会在 `answer-goal.ts`、`resolved-turn.ts`、request builder 中被默认 sentinel 覆盖
- [x] 6.6 写失败测试：形状合法但不是 `resolvedQuestion` 连续子串的无关项、工具路由或仅来自 `diagnosticObjective` 的文本使整个集合回退 sentinel
- [x] 6.7 写对抗失败测试：“如何开启 X，多久生效”只分解“如何开启 X”时 completeness review 报缺项并整组回退
- [x] 6.8 写失败测试：Knowledge、MCP、Worker producer 使用 exact reconciled item strings，但 final union 只采用 independent reviewer-accepted bindings；producer 过度标注被拒
- [x] 6.9 写 Experience 专项失败测试：不得把历史 reply/summary 包装成全覆盖 primary；`resolvedQuestion`/`answerObject`/items 任一不等即非 exact goal（两边同为 sentinel 也不例外）；current v4 同 identity 内容变化后历史 claim 必须重审；历史 Workspace/MCP 无结构化 current resolver、历史 manual/log/history/unknown 均仅 investigation
- [x] 6.10 写失败测试：sentinel 仅用于兼容 ID、不出现在用户回复/审计原文，且仍需完整 resolvedQuestion coverage review
- [x] 6.11 运行 focused tests，确认 RED 并记录失败证据

### 7. GREEN：实现 AnswerGoal 单一权威链

- [x] 7.1 更新 `src/agents/input-review.md` 的 proposer contract，并新增/登记独立 `answer-goal-completeness` agent config：只接收安全规范化 resolvedQuestion + proposed items，只判断是否覆盖完整问题并输出 complete/incomplete/unknown、最多 5 个 bounded missingElements 与 reason，不生成用户文本；两个判断不得复用同一次 model 输出或 proposer rationale
- [x] 7.2 修改 `src/runtime/preflight-service.ts` 与独立 completeness review service：执行 shape/safety/连续子串 scope、完整问题义务 review、稳定去重和 whole-set fallback；review failure/unknown 保守 sentinel
- [x] 7.3 修改 `src/runtime/answer-goal.ts`、`resolved-turn.ts` 与 request builder，使 accepted items 只构造/携带一次，后续不重置
- [x] 7.4 更新 Knowledge/MCP/Worker 等 answer source/claim producer，确保 `answers` 使用 exact current items；删除局部 alias 和问法枚举驱动
- [x] 7.5 修改 Experience 生产路径：从 source run 重新验证结构化 claims/evidence 与 exact normalized resolvedQuestion + answerObject + items；禁止历史 rendered body/summary 生成 primary；knowledge evidence 通过 retrieval port 重解析 current active v4；Workspace/MCP 仅通过对应 current read-only resolver 重验，无法从既有结构化数据构造 resolver 时 direct-ineligible；历史 manual/log/history/unknown 不授予 replay coverage，且不改变 Case JSON shape
- [x] 7.6 结构化事件只记录 source、count、fallback reason；不记录 rejected item text、secret 或隐藏 prompt
- [x] 7.7 运行 6.x focused tests，确认 GREEN

### 8. RED/GREEN：worker 把解决步骤放入 next_action

- [x] 8.1 先写 contract 测试：受 evidence 支持的配置修复必须为 `role=next_action`、带 relevant exact `answers` 和 evidence IDs，不能只存在于 summary/process note
- [x] 8.2 写 contract 测试：无安全 action 时不得虚构；删除/覆盖/部署/写配置动作必须标为待人工授权且不得声称已执行
- [x] 8.3 更新 `src/workers/claude/claude-prompts.ts` 和必要的 worker output validation，保持 read-oriented tool policy
- [x] 8.4 运行 worker focused tests，记录 RED 与 GREEN 证据

### 9. Gate B 闸门

- [x] 9.1 端到端验证合法 model items 从 Preflight 到 Knowledge/Worker claims、review coverage 和 Presentation 保持 identity 不变
- [x] 9.2 验证 fallback sentinel 的旧行为兼容且不用户可见
- [x] 9.3 验证 Experience exact structured current-source replay 可用；同 sentinel 不同问题、历史 reply wrapping、legacy knowledge、stale/unresolvable Workspace/MCP 与历史 manual/log/history/unknown 旁路均被阻断
- [x] 9.4 在 `implementation-notes.md` 填写 Gate B RED/GREEN/兼容证据；未通过不得进入 Gate C 完成状态

## Gate C — parent-child v4 与 evidence span

### 10. RED：v4 artifact、legacy 与安全 rebuild

- [x] 10.1 盘点并在实现记录列出所有 v2/v3/version hardcode：chunk contracts/types、vector index、migration、templates、slicer、manifest、readers、fixtures/tests；区分 child `artifact_version=4`、现有 index/vector manifest schema version 与新 generation-manifest schema，不得批量把所有 version 改成 4
- [x] 10.2 写失败测试：v4 `text` 保持 canonical body，`retrieval_text` 为 bounded section path + body；legacy-named `text_hash` 作为 child identity hash，`retrieval_text_hash` 作为 embedding input hash，输入语义稳定
- [x] 10.3 写失败测试：BM25 使用独立 heading field + canonical body，heading 不因 `retrieval_text` 重复加权；embedding/rerank 使用 `retrieval_text`
- [x] 10.4 写失败测试：同 section undersized trailing child 合并；超 max 时按 sentence/Markdown block 重平衡；孤立小 child 以及两个 sibling 无安全重平衡边界时保留、标记 `undersized_unmergeable`，并一律为 investigation-only/strict-direct-ineligible
- [x] 10.5 写失败测试：任何非 v4 record 即使持久化 `legacy=false`，读取后也为 `legacy=true` 且 strict direct-answer ineligible
- [x] 10.6 写失败测试：v3 parent 可作为只读 canonical source 生成 v4 child，但普通 search request 不写 parent/knowledge directory
- [x] 10.7 写 generation 失败测试：临时 generation 全部校验后只原子替换 `active.json`；reader 每请求固定一次 generation；并发 activation 不混代；两个 publisher 从同一 expected active 竞争时仅一个成功、另一个 `generation_conflict`；lock busy/stale recovery、崩溃 incomplete generation、CAS rollback、旧 flat legacy 全覆盖
- [x] 10.8 写发布模式失败测试：embedding enabled/requested 时 chunk/vector 任一失败均保留 active pointer；embedding 显式 disabled 且 BM25-only 完整时 SHALL 发布；不发布 mixed-version vector
- [x] 10.9 写 provider failure/privacy 失败测试：timeout、429/rate-limit、server、malformed response、dimension mismatch 各自产生 bounded reason，BM25 候选按自身资格继续；在 retrieval text 植入唯一 marker 后扫描 trace、Case JSON、日志、report、Presentation 均不存在该 marker
- [x] 10.10 运行 focused tests，确认 RED 并记录失败证据

### 11. GREEN：实现 parent-child v4

- [x] 11.1 更新 `src/knowledge/documents/chunk-contracts.ts` 与 artifact types/readers/writers：`parent-child-v4`、child artifact version 4、保持各 index/vector manifest 自身 schema version、增加 generation-manifest v1、optional-read/required-write 的 `retrieval_text` 与 `retrieval_text_hash`
- [x] 11.2 修改 chunk builder：canonical/retrieval text 分离、section prefix 240 code points、稳定 hash payload、`minChars` merge/rebalance/health reason
- [x] 11.3 修改 BM25 adapter 保持 separate heading + canonical body；修改 embedding、rerank 与 vector content hash 使用 retrieval text/hash
- [x] 11.4 更新 vector compatibility、manifest、migration、templates、slicer render、fixtures和 health checks；修正 legacy 计算为 `chunk.legacy === true || !current`
- [x] 11.5 在 `src/application/` 的 knowledge management use case 编排显式 rebuild/publish/rollback/retry；`src/knowledge/` 提供 generation 构建/校验与 publisher port/文件适配器，application 不直接操作 lock/manifest/pointer，provider 走既有 port，CLI/onboarding 保持薄调用
- [x] 11.6 实现 `generations/<id>/` + `active.json` + cross-process publish lock/expected-active CAS：临时 generation、mode/count/ID/file-hash/strategy/dimension/completeness 校验、不可变完成标记、同目录 temp+fsync+rename、每请求单次解析、previous generation CAS rollback、显式 stale-lock recovery；enabled embedding 不完整即整组失败，disabled embedding 才发布完整 BM25-only set
- [x] 11.7 legacy flat/non-v4 artifact 只允许 investigation use，输出 bounded `rebuild_required` reason；请求路径零自动写入；incomplete generation 不可激活
- [x] 11.8 Evidence Pack、Case JSON、日志、report、Presentation 不新增完整 `retrieval_text` 或 raw candidate；只保留现有 section path 与 bounded canonical content
- [x] 11.9 实现 provider failure 的独立降级与安全 trace，确保一个 adapter 失败不清空其他合格 recall 候选
- [x] 11.10 运行 10.x focused tests，确认 GREEN

### 12. RED/GREEN：域中立 answer span 与 Judge 单一职责

- [x] 12.1 先写 answer-span 失败测试：连续 1/2/3 句、4 个必需单元、500/501 code points、Markdown 编号列表无句号、无匹配、仅 heading 匹配、域外技术/政策文本
- [x] 12.2 写失败测试：完整步骤超界时返回 `undefined` 且 investigation-only，禁止截 500 字伪装完整
- [x] 12.3 写失败测试：span 必须是 canonical body 的连续片段，不得来自 retrieval heading prefix
- [x] 12.4 写 Evidence Judge 失败测试：不再依赖第二套教育域关键词；只校验 span provenance/completeness/confidence/claim binding/coverage
- [x] 12.5 修改 `src/retrieval/answer-span.ts`：以 query coverage、段落边界、列表连续性和通用条件/能力/动作结构评分，输出完整或 abstain
- [x] 12.6 删除/统一 `src/runtime/evidence-judge.ts` 中漂移的 `ANSWER_BEARING_PATTERNS`/`hasAnswerBearingSentence` 业务域判断
- [x] 12.7 更新 knowledge candidate/evidence mapping：传递 section path、bounded canonical span/context，不传完整 retrieval text
- [x] 12.8 运行 12.x focused tests，记录 RED 与 GREEN 证据

### 13. Gate C 闸门与检索非回归

- [x] 13.1 在临时知识 workspace 运行 v3/flat readable-but-ineligible、v4 generation publish、并发 reader、崩溃恢复、失败 rollback、zero auto-write 用例
- [x] 13.2 对固定 `production-eval-50.json` 运行改动后离线评估：Recall@5、MRR、direct precision、no-hit abstention、must-escalate 均不得低于 0.2 记录的基线
- [x] 13.3 新增多步骤完整性与域外定向 fixture 必须 100% 通过；不得通过删除/弱化失败 case 达标
- [x] 13.4 在 `implementation-notes.md` 填写 Gate C artifact 清单、hash/version、before/after 指标和 rollback 证据

## Cross-Gate — 用户问题验收与兼容

### 14. 默认离线端到端 golden cases

- [x] 14.1 通过生产 composition/factory 正式注入点构建完全离线 harness：`mkdtemp` 知识目录、按 agent seam 可区分并计数的 fake proposer/completeness/coverage/prompt-safety/presentation model、fake embedding/rerank、network sentinel=0、poisoned SecretRef/env resolver（即使环境里有假真实凭据也必须 read count=0），不得改走测试专用平行 pipeline
- [x] 14.2 golden：worker 返回联合 primary + `search.provider -> embedding` + next actions，model plan 和 fallback 回复均锚定问题、完整呈现步骤且不泄漏路径/secret
- [x] 14.3 golden：无效 supporting claim 被移除但完整 primary coverage 保持 final，rejected text 不从 summary/evidence/后段回流
- [x] 14.4 golden：Preflight 少报“多久生效”子问题时 completeness review 回退 sentinel；producer 对只回答“如何开启”的 claim 过度标注全部 items 时 independent coverage review 阻断 final
- [x] 14.5 golden：coverage 缺项时不得 final；相关 accepted primary inference 以初步判断显示；missingInfo 夹带未审核事实时整项拒绝并重新冻结 ask/partial
- [x] 14.6 golden：知识多句步骤在界内完整出现；四步骤或 501 code points 时 abstain/升级，不输出残缺直答
- [x] 14.7 golden：v3 artifact 只调查不可直答，v4 validated artifact 可按相同 AnswerGoal coverage 进入严格审核
- [x] 14.8 golden：Experience 只复用 exact-goal structured current-provenance claims；同 identity 当前内容不再支持历史 claim、历史 rendered body 与 v3/unknown provenance 均不能绕过 strict review
- [x] 14.9 golden：两个 publisher 从同一 active generation 竞争时只有一个成功，另一个 conflict；reader 不混代，rollback CAS 正确
- [x] 14.10 production-composition golden：两个 primary 绑定同一 item，其中第二条补足时效/限制且被 reviewer 列入 `fullQuestionClaimIds`；model/fallback 均必须显示两条，生产 freeze/projection 忽略该字段时用例必须失败
- [x] 14.11 production-composition golden：当前 Worker workspace 与当前 read-only MCP evidence 分别可 final；coverage model payload 仅含 source-neutral safe segments；植入 raw summary/source/secret/path marker 后 payload/log/reply 均无 marker；Experience 非知识 evidence 无 current resolver 时不可 replay
- [x] 14.12 在未设置 `SUPER_HELPER_REAL_ACCEPTANCE=1` 且环境中放置 poisoned credential 的条件下运行 `pnpm acceptance:knowledge:local` 与新增 answer-fidelity offline acceptance，记录命令、退出码、各独立 reviewer call/batch count、secret-resolver/network count 和临时目录清理结果

### 15. 文档、契约与模块边界同步

- [x] 15.1 更新 `src/agents/input-review.md`、`evidence-coverage.md`、`presentation.md`，新增 `answer-goal-completeness.md`、`visible-prompt-safety.md`，并补 `registry.json` 配对、executionMode、non-user-facing 与 schema contract tests
- [x] 15.2 更新 `docs/architecture/runtime/contracts.md`、`question-contract.md`、`review-presentation.md`、`knowledge-answering.md`、`worker-escalation.md`，明确 sentinel、独立 goal-completeness/claim-coverage/prompt-safety reviews、source-neutral coverage segments/freshness、reviewed union + full-question-required IDs、safe materialized projection、Experience 对各当前来源重审、v4 双文本和 generation pointer
- [x] 15.3 更新知识迁移/运维说明：v3/flat/undersized-unmergeable readable-but-ineligible、application-layer explicit orchestration、knowledge-owned publisher lock/manifest/pointer IO、expected-active CAS、双 publisher conflict、concurrent reader、stale-lock 显式恢复、crash recovery、rollback、真实目录 opt-in
- [x] 15.4 增加深度兼容测试：legacy Case fixture load→save roundtrip；`/api/chat` sync/async 与 `/api/session(s)` 深度 shape 对比；新旧 DiagnosticRequest/Result required-key 集合对比；执行 v4 retrieval/coverage review 后 Case/log/model payload 不含 `retrieval_text`、`retrieval_text_hash`、raw candidate、raw Evidence source/summary marker
- [x] 15.5 运行模块边界测试/静态检查，确认 application 只编排 rebuild/publish/rollback，knowledge-owned publisher adapter 执行 lock/manifest/pointer IO，retrieval 不写 artifact，runtime 只通过 port 编排 workspace/MCP current-source revalidation，worker/MCP adapter 不决定 coverage，gateway/CLI 只调用用例，agents/observability 不越界；`src/cli.ts` 保持薄入口

### 16. 真实 provider/知识库验收（显式 opt-in）

- [x] 16.1 仅在用户明确授权且设置唯一开关 `SUPER_HELPER_REAL_ACCEPTANCE=1` 时运行真实 model/embedding/知识目录验收；缺开关即使凭据存在也必须安全跳过并记 `NOT_RUN`，不得由默认 `pnpm test` 触发
- [x] 16.2 将每项真实验收记录为 `PASS`、`FAIL` 或 `NOT_RUN`；`NOT_RUN` 不能标成通过，也不能覆盖离线失败
- [x] 16.3 真实运行日志不得写入凭据、完整 provider payload、完整 retrieval text 或用户知识正文

## Anti-Fake-Complete

- [x] 17.1 每个实现小节在 `implementation-notes.md` 同时有 RED 命令/失败断言、GREEN 命令/退出码和实际修改文件；只有 GREEN 无 RED 不得勾选
- [x] 17.2 检查无 `.only`、新增 `.skip`、空断言、总为真的 stub、篡改 production fixture、仅更新 snapshot 掩盖行为等假通过手段
- [x] 17.3 对生产 seam 做 mutation/failure-injection：分别临时恢复 rejection 连坐、信任 producer `answers`/proposer 自评、忽略 `fullQuestionClaimIds`、让 coverage reviewer 接收 raw Evidence summary/source 或陈旧非知识 evidence、跳过 prompt-safety review、让 renderer 接收 raw result、让 Experience 包装历史 reply/只比 sentinel/不对当前 evidence 重审、让 embedding 使用 canonical text、信任 persisted `legacy=false`、允许 undersized child 直答、移除 publisher lock/CAS 或逐文件发布 generation、把 span 截至 500；对应 production-composition/focused test 必须失败，恢复生产代码后通过。仅反转测试断言不算证据
- [x] 17.4 用 `rg` 复查所有 v2/v3/`parent-child-v3` hardcode、所有用户 reply builder、所有 answer-bearing pattern、所有 `mustAnswerItems` producer/consumer、所有 Evidence kind producer 与 current-source resolver，逐项记录“更新/兼容保留/不适用”
- [x] 17.5 核对所有任务勾选均有证据链接；外部依赖、真实 provider 与真实迁移若不适用必须明确 `N/A`/`NOT_RUN`，不得留空冒充完成
- [ ] 17.6 由非原实现者的独立 reviewer 对 spec ↔ implementation ↔ tests ↔ implementation-notes 做反向审计；记录 reviewer 身份/执行主体、日期、reviewed commit/diff identity、逐项 production-path 结论、findings 与关闭证据，重点找能绕过 safe projection、`fullQuestionClaimIds`、source-neutral coverage/freshness、独立 completeness/coverage/prompt reviews、Experience current-evidence eligibility、undersized-child 限制和 publisher lock/CAS 的路径

## 18. 最终验证与完成闸门

- [x] 18.1 `openspec status --change fix-answer-fidelity-and-retrieval-quality`
- [x] 18.2 `openspec validate fix-answer-fidelity-and-retrieval-quality --strict`
- [x] 18.3 `pnpm lint`
- [x] 18.4 `pnpm typecheck`
- [x] 18.5 `pnpm build`
- [x] 18.6 `pnpm test`
- [x] 18.7 `pnpm acceptance:knowledge:local`
- [x] 18.8 运行 Gate A/B/C 与 cross-gate focused/acceptance suites
- [x] 18.9 `git diff --check`
- [x] 18.10 把所有命令、退出码、关键指标、NOT_RUN/N/A、已知风险和 rollback 结果写入 `implementation-notes.md`
- [ ] 18.11 仅当 proposal Success Criteria、三个 Gate、cross-gate golden cases、兼容测试和 Anti-Fake-Complete 全部满足时，才将 change 标记完成；任一 required check 未通过不得归档
