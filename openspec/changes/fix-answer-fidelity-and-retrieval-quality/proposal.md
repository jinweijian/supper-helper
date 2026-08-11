# fix-answer-fidelity-and-retrieval-quality

## Why

用户反馈“回答了但不能解决问题”。代码核实后，这不是单一文案问题，而是同一条用户可见答案链路上的三个合同失配：

1. **审核结果与最终表达失配**：一个无效 supporting claim 会连坐降级整个结果；Presentation fallback 用固定 persona 套话替代已接受的 `next_action`；当前脱敏逻辑会误删配置 key、文件名等可执行信息；model plan 的局部错误又会导致整份计划被丢弃。
2. **AnswerGoal 与覆盖判定失配**：`mustAnswerItems` 长期只有兼容哨兵 `direct_answer`；RAG Answerability 按多 claim 覆盖，而 result validator 要求单个 claim 覆盖全部必答项；Preflight 重建 AnswerGoal 时还可能覆盖 model 分解结果。更关键的是，item proposer 和 claim producer 可以分别少报子问题或夸大 `answers`，由同一输出自证完整。结果是“看似通过覆盖检查，实际没有回答用户每个问题”，或“多个正确 claim 合起来已回答，却被错误降级”。
3. **检索文本与证据摘录失配**：BM25 已单独索引 heading，但 embedding、rerank 仍主要使用无 section path 的正文；碎片 chunk 未按 `minChars` 收敛；answer span 与 Evidence Judge 各自维护域相关规则，容易把多步骤内容压成单句或在域外文档上失效。

三类失配最终都表现为同一个用户问题：上游 worker 或知识库存在可用信息，用户拿到的回复却不完整、不对题或不可执行。因此本 change 保持统一，不再拆分；但以内部阶段闸门隔离风险，只有端到端用户问题通过后才算完成。

## What Changes

- **冻结 AnswerGoal 覆盖合同**：model-assisted Preflight 可提出 1–5 个有界必答项，独立 `AnswerGoalCompletenessReview` 再核对完整用户问题；非法、不完整或 reviewer 不可用时整体回退兼容哨兵。所有 producer/consumer 使用相同 item 字符串，但 producer `answers` 仅为候选；独立 `AnswerCoverageReview` 必须验证 claim→item binding 与完整 `resolvedQuestion`，accepted `primary_answer` claims 才可按稳定顺序联合覆盖。
- **统一跨来源 coverage 输入**：Knowledge、Worker、MCP 和当前用户/日志证据先转换为 runtime-only、脱敏、有界并带 freshness enum 的 claim/evidence segments；raw `Evidence.summary/source`、provider payload、trace、完整 retrieval text 和未选 evidence 不进入 reviewer。无法证明当前性、超界或无法安全化的证据不给 coverage。
- **区分局部 claim 失败与全局结果阻断**：局部无效 claim 只被移除；只有主答覆盖缺失、上游结构化 conflict blocker、结果级合同损坏或用户可见安全校验失败才阻断 final。审核不以文本关键词猜冲突，只能保持或降低 worker outcome，绝不升级。
- **引入运行时安全物化的用户可见投影**：先从 validated result 冻结 IDs/outcome，再物化、脱敏成 renderer 唯一可见的安全 segments。renderer 不再接收 raw `DiagnosticResult`；model 只能排列允许的 section/非顺序 supporting 内容，不能遗漏必显内容、重排 primary/action sequence、提升 outcome 或补写事实。
- **统一整份回复的安全投影**：问题锚点、主答、supporting、next action、unknown 和 missing info 全部走同一脱敏与结构化 segment provenance 校验；opaque unknown/missing info 还要经过独立、有界批处理的 `VisiblePromptSafetyReview`。保留真正可执行的配置 key、文件名、接口名和错误类型，继续屏蔽 secret、绝对路径中段、内部知识源与 trace。
- **升级 parent-child v4 artifact**：canonical `text` 保持纯正文；新增派生 `retrieval_text`/`retrieval_text_hash`，仅供 embedding 与 rerank 使用 section-path 上下文。BM25 继续使用独立 heading field + canonical body，避免标题重复加权；answer span 只从 canonical text 截取。无法安全合并/重平衡的 undersized child 仅用于 investigation。
- **统一域中立 answer-span 合同**：检索层基于查询覆盖和通用结构选择连续 1–3 句、最多 500 字符；无法完整容纳步骤时不截成伪完整答案，而是作为 investigation-only。Evidence Judge 不再维护第二套业务域关键词。
- **强化 worker actionable 合同**：排查或修复步骤必须作为带 `answers` 与 evidence 边界的 `next_action` claim 输出；不得藏在 summary/process note，也不得虚构或声称已执行需人工授权的写操作。
- **关闭 Experience 旁路**：历史 reply body/summary 不得包装成覆盖当前全部 items 的主答；只有 normalized `resolvedQuestion`、`answerObject`、items 全部精确相等，且结构化 claims/evidence 对当前来源重新验证后，才能保持 direct replay eligibility。Knowledge 必须重解 current v4 canonical evidence；Workspace/MCP 必须通过对应 read-only current resolver；历史 manual/log/history/unknown 只可 investigation。即使 evidence identity 相同，历史 claim 也必须对当前内容重新通过 support/full-question review。
- **冻结并发发布语义**：application 只编排 rebuild/publish/rollback/retry；knowledge-owned publisher adapter 通过跨进程 writer lock 与 expected-active CAS 原子切换 generation。两个 publisher 竞争时只允许一个成功，冲突方不得覆盖 pointer 或伪报成功。
- **建立默认离线验收与防假完成闸门**：固定 production eval fixture、定向回归用例、临时知识目录、fake provider 和网络调用计数均纳入任务；真实 provider/真实知识库只能显式 opt-in，未运行不能记作通过。

## Internal Delivery Gates

本 change 不拆分，但按以下三个闸门顺序交付：

1. **回答投影闸门**：审核去连坐、冻结投影、完整回复脱敏、model/fallback 同源渲染。
2. **AnswerGoal 闸门**：必答项解析、稳定联合覆盖、所有来源与审核消费者语义一致。
3. **知识与检索闸门**：v4 artifact、generation 指针式发布/回滚、域中立 span、Evidence Judge 单一职责。

三个闸门最终必须共同通过端到端 golden cases；只完成其中一段不能关闭本 change。

## Capabilities

### New Capabilities

- `question-anchored-reply`: reviewed DiagnosticResult 的用户回复锚定当前 AnswerGoal，并从运行时安全物化的 accepted 投影中完整呈现主答与可执行步骤；model 与 fallback 路径遵守同一事实、安全和脱敏边界。

### Modified Capabilities

- `deterministic-output-review`: 区分 claim-local rejection 与 result-global blocker；主答按 accepted primary claims 联合覆盖；生成 renderer-only safe projection 并定义 model plan 的可丢弃/致命错误矩阵。
- `diagnostic-agent-runtime`: model-assisted Preflight 提出可证明来自 resolvedQuestion 的有界 `mustAnswerItems`，独立审核其完整性；各答案来源统一声明 candidate `answers` 并接受独立 coverage review，Experience 只能复用 exact-goal、对当前 evidence 重新支持的 structured 内容。
- `parent-child-knowledge-index`: 引入 v4 canonical/retrieval 文本分离、`minChars` 收敛、legacy 直答禁用与 immutable generation + active pointer 发布。
- `retrieval-evidence-contract`: evidence 只暴露 section path 与 canonical bounded span，不泄漏完整 `retrieval_text`；多步骤摘录与 Judge 完整性边界统一。

## Success Criteria

- worker 返回的 accepted `next_action` 在 model plan 和 fallback 两条路径都可见，且配置 key/文件名等操作信息未被误删。
- reviewed DiagnosticResult 回复开头安全地锚定 `answerGoal.resolvedQuestion`；整份可见回复不含 rejected/unselected claim、secret、内部路径、trace 或 provider payload。
- 多个 accepted `primary_answer` claims 的 reviewer-accepted bindings 联合覆盖全部必答项，且 frozen primary 包含 reviewer 判定回答完整 `resolvedQuestion` 所必需的全部 evidence-supported claim IDs 时才可保持 final；producer 自报全覆盖、reviewer unknown/失败、required ID 非法或缺项时不得 final，且存在相关 accepted fact/inference 时先显示“初步判断”。
- 当前 Worker workspace evidence 与 allowlisted read-only MCP evidence 可经同一 source-neutral coverage contract 保持合法 final；raw summary/secret/path 不进入 reviewer。Experience 中无法由当前 resolver 重验的非知识 evidence 不得 direct replay。
- 固定 `production-eval-50.json` 上 Recall@5、MRR、direct precision、no-hit abstention 和 must-escalate 均不低于改动前记录基线；新增多步骤、域外文档、无完整 span 用例全部通过。
- v3 artifact 可读但始终 `legacy=true` 且不可用于严格直答；无法安全收敛的 undersized v4 child 也不可严格直答。v4 rebuild 生成不可变 generation，只由 knowledge-owned publisher 在 writer lock + expected-active CAS 下原子切换 `active.json`；失败、崩溃或双 publisher 竞态不暴露混合代际或丢失更新。
- 在用户显式授权的真实配置下，`/api/chat` → runtime → 真实 worker/provider → review → Presentation 端到端验收必须覆盖多项问题、代码证据与整份回复安全，并最终形成 reviewed `final_answer`；任一必需 reviewer/provider 为 `NOT_RUN`、知识证据质量失败或结果停留在 partial 时不得关闭 change。
- HTTP response shape、Case JSON shape、`DiagnosticRequest`/`DiagnosticResult` 现有字段保持兼容。

## Impact

- **Runtime**：`result-validator.ts`、`review-gate.ts`、`preflight-service.ts`、`answer-goal.ts`、`rag-answerability-service.ts`、`experience-agent.ts`、`review-presentation.ts`、`presenter.ts`，并抽取 source-neutral coverage materializer、安全物化投影/脱敏模块，使 reviewer/renderer 不可达 raw result。
- **Agents / Workers**：更新 `src/agents/input-review.md`、`evidence-coverage.md`、`presentation.md`，新增 non-user-facing `answer-goal-completeness.md` 与 `visible-prompt-safety.md` 并登记 `registry.json`；更新 `src/workers/claude/claude-prompts.ts` 与对应 contract tests。
- **Application / Knowledge / Retrieval / Source adapters**：application 层拥有显式 rebuild/publish/rollback/retry 用例；knowledge 提供 generation 构建/校验和 publisher port/文件适配器，独占 lock/manifest/pointer IO；retrieval 每请求只解析一次 active generation，并使用明确的 BM25/embedding/rerank 与 answer-span 合同；workspace worker 与 MCP adapter 只提供当前来源的 read-only revalidation，coverage 决策仍在 runtime。
- **运维**：旧 v3 继续只读；不会在请求路径自动改写用户知识目录。升级通过显式 generation rebuild 完成，失败保留旧 pointer，可原子回滚。
- **成本**：真实必答项会提高严格度，可能减少知识直答并增加 worker 升级；must-answer completeness 需要独立 review call，claim coverage 与 opaque visible prompts 使用按 turn 有界的独立 batch review。增加的模型调用与延迟是以回答完整性、安全性优先的预期取舍，必须通过调用计数、结构化 reason 与离线基线监控；reviewer 失败时保守回退，不得跳过审核。
- **外部依赖**：不新增外部 API、协议或凭据类型；真实模型/embedding 仅复用现有 adapter 和 SecretRef/env 配置。
