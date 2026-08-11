# fix-answer-fidelity-and-retrieval-quality 实现证据

## 当前状态

- OpenSpec 方案整改：已完成；严格结构校验与仓库文档 lint 已通过（仅证明方案文档有效，不代表生产实现完成）。
- 生产代码实现：Gate A/B/C 与 cross-gate 离线生产组合已实现并通过最终仓库验证。
- 代码审查：已完成原实现者自审与非原实现者四轮反向审计；最终审计 Critical、Important、
  Minor 均为 0，所有 production path 为 PASS，结论 Ready。
- tasks 勾选：以 `tasks.md` 和本文件的 RED/GREEN 证据为准；任何任务不得仅因文档已补齐而标记完成。
- 说明：本文件是后续实现的证据账本，不是预填的完成声明。`[待实现]`、`NOT_RUN` 和 `N/A` 必须保留真实含义。

### 方案整改验证（非实现完成证据）

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `openspec validate fix-answer-fidelity-and-retrieval-quality --strict` | 0 | Change is valid |
| `openspec status --change fix-answer-fidelity-and-retrieval-quality` | 0 | 4/4 artifacts complete |
| `pnpm lint` | 0 | Docs lint passed |
| delta spec Scenario GIVEN/WHEN/THEN 完整性扫描 | 0 | 5 个 spec、146 个 Scenario、0 个缺失 |

## 记录规则

每个实现任务至少记录：

1. RED：命令、退出码、目标失败断言、失败原因确实对应未实现行为。
2. GREEN：命令、退出码、通过断言、实际修改文件。
3. REFACTOR/兼容：相关回归命令、公共 shape/模块边界影响。
4. 若使用真实 provider 或真实知识目录，单独记录授权、开关和脱敏结果；不得粘贴 secret、完整 payload、完整知识正文或 `retrieval_text`。

只有“命令 + 退出码 + 可核对断言/指标”齐全才是完成证据。文字“已验证”不构成证据。

## 合同冻结摘要

| 合同 | 冻结决策 |
| --- | --- |
| Review ceiling | 审核只能保持或降低 worker outcome，不能升级 |
| AnswerGoal completeness | Preflight proposer 复用既有调用；独立 `answer-goal-completeness` call 审核完整问题义务；失败整组回退 sentinel |
| Primary coverage | producer `answers` 仅为 candidate；独立 `evidence-coverage` batch reviewer 产出 bindings + `fullQuestionClaimIds`，frozen primary 是 greedy item-cover 与 full-question-required IDs 的原顺序并集 |
| Coverage input | runtime-only source-neutral claim/evidence segments；20 claims、40 evidence、每项 1000、总计 24000 code points；只传 stable ID、safe text、kind/freshness，不传 raw Evidence 字段 |
| Compatibility fallback | `[DIRECT_ANSWER_ITEM]` 是不可见 sentinel，不是真实问题分解 |
| Visible source | 两阶段 selection → safe materialized projection；renderer 不接收 raw DiagnosticResult |
| Model Presentation | 只排序 frozen IDs；遗漏 required 内容或 direct-answer mismatch 即 fallback |
| Whole-reply safety | anchor、claims、actions、unknown、missingInfo、generic guidance 统一脱敏和最终扫描 |
| Opaque prompt review | runtime 每 turn 至多一次、最多 10 项调用 `visible-prompt-safety`；只 accept/reject 已清洗 ID，失败则不可见 |
| V4 artifact | canonical `text` 与派生 `retrieval_text` 分离；BM25 不重复使用 heading prefix |
| Undersized child | 无法安全合并/重平衡时保留并标记 `undersized_unmergeable`，但仅 investigation、strict-direct-ineligible |
| Experience | normalized resolvedQuestion + answerObject + items 全部精确相等；Knowledge/Workspace/MCP 必须 current-source revalidate，历史 manual/log/history/unknown 仅 investigation |
| Atomic publish | application 编排；knowledge-owned publisher 以 cross-process lock + expected-active CAS 切换 immutable generation 的单一 `active.json` |
| Span | canonical body 连续 1–3 单元、≤500 code points；不完整则 abstain |
| Migration | v3 可读但 strict-ineligible；显式临时构建、校验、原子切换、可回滚 |

如实现需要改变任一冻结决策，先更新 proposal/design/spec/tasks，再在“偏差与决策”记录理由；不得只在代码中静默偏离。

## 0. 改动前复现与基线

### 2026-07-27 执行环境

- 基线 commit：`0fc42fc002978f88d4d964dd8593518709b8a0c0`；执行分支为用户明确授权的 dirty `master`。
- 固定评估 fixture hash：`ca1f94256cd6dc7254ab57882f88be941a98df5a`。
- 为避免读取本机配置、SecretRef 或真实 provider，评估同时显式传入
  `--workspace /Users/king/my/super-helper` 与
  `--knowledge-root /Users/king/my/super-helper/test/fixtures/knowledge`。CLI 因两个路径均显式提供而使用
  `defaultConfig()`；测试知识目录没有可用向量/父子 artifact，configured search 以 offline 模式运行，
  `offline=true`，没有网络请求。
- 基线前 `pnpm build` 退出码 0。相关既有回归
  `node --test test/retrieval-grounding.test.mjs test/answer-goal.test.mjs test/runtime-hardening.test.mjs test/turn-presentation-integrity.test.mjs`
  退出码 0，52/52 通过；这些既有测试没有覆盖下表所列新合同，因此不能替代后续 RED。

### 0.1 失效机制复现

| 失效机制 | RED 命令 | 退出码 | 关键失败断言 | 状态 |
| --- | --- | ---: | --- | --- |
| supporting rejection 连坐 | `rg -n "rejectedClaimIds.length\|resultCanConclude" src/runtime/result-validator.ts` | 0 | `rejectedClaimIds.length > 0` 直接参与 result-global downgrade，supporting rejection 会连坐 primary | REPRODUCED |
| fallback 吞 `next_action` | `rg -n "formatReviewFailureFallback\|ruleBasedReviewAndFormat\|DiagnosticResult" src/runtime/{review-presentation,presenter}.ts` | 0 | fallback 重新接收 raw `DiagnosticResult` 并自行选择内容，没有 frozen required-action 合同；当前 dirty presenter 的多项列表改动只能缓解展示，不能证明 action 完整性 | REPRODUCED |
| renderer 可达 raw result | 同上 | 0 | `renderPresentationPlan`、`ruleBasedReviewAndFormat`、persona renderer 均直接接收 `DiagnosticResult` | REPRODUCED |
| Preflight items 被默认值覆盖 | `rg -n "buildAnswerGoal\\(" src/runtime/preflight-service.ts` | 0 | reconcile 后两处重建 AnswerGoal；`buildAnswerGoal` 固定写入 sentinel | REPRODUCED |
| Preflight 少报用户子问题 | `sed -n '60,155p' src/runtime/preflight-service.ts` | 0 | proposer contract 无 must-answer items，且没有独立 completeness review | REPRODUCED |
| single-claim / union coverage 冲突 | `sed -n '90,140p' src/runtime/result-validator.ts` | 0 | `claimCoversAnswerGoal` 要求单 claim 覆盖全部 items，不支持 accepted claim union | REPRODUCED |
| producer `answers` 过度标注 | 同上 | 0 | deterministic validator 直接信任 `claim.answers`，没有独立 reviewer-accepted binding | REPRODUCED |
| 非 Knowledge evidence 无法进入统一 coverage / raw evidence 泄漏 | `rg -n "summary|source|retrieval_text|trace" src/runtime/{evidence-coverage,rag-answerability}-service.ts` | 0 | coverage seam 为 Knowledge 专用结构且直接发送 evidence `summary`，没有 source-neutral safe materializer | REPRODUCED |
| opaque prompt 夹带未审核事实 | `rg -n "missingInfo|unknownClaims" src/runtime/presenter.ts` | 0 | unknown/missingInfo 可直接进入回复，没有独立 visible-prompt safety review | REPRODUCED |
| v3 `legacy=false` 绕过 | `rg -n "artifact_version !== 3|parent-child-v3" src/knowledge/{migration,vector-index}.ts` | 0 | v3 被当作 current strict artifact；当前合同没有 v4 generation identity/hash | REPRODUCED |
| undersized v4 child 获得 strict 直答 | `rg -n "minChars|manual_split_required|strict" src/knowledge src/retrieval` | 0 | 当前没有 `undersized_unmergeable` strict-ineligible 元数据/过滤合同 | REPRODUCED |
| 域相关 span/Judge 漂移 | `rg -n "ANSWER_BEARING_PATTERNS|学员|课程" src/retrieval/answer-span.ts src/runtime/evidence-judge.ts` | 0 | span 与 Judge 各自维护含教培词的 answer-bearing pattern | REPRODUCED |
| Experience 历史 reply 自报全覆盖 | `rg -n "sourceReplyId|sourceRun|answers:" src/runtime/experience-agent.ts` | 0 | 历史 run 被包装为当前 primary，`answers` 直接取当前全部 items | REPRODUCED |
| Experience 同 identity 当前内容已不支持旧 claim | 同上 | 0 | 只验证历史 run/result，没有 Knowledge/Workspace/MCP current resolver revalidation | REPRODUCED |
| 平面多文件 artifact 混代发布 | `rg -n "writeFileSync" src/knowledge/indexes src/knowledge/vector-index.ts` | 0 | chunks/manifest/keyword/vector 多文件分别原位写入，没有 immutable generation + 单一 active pointer | REPRODUCED |
| 双 publisher 基于同一 active 丢失更新 | `rg -n "active.json|expected.active|lock|CAS" src/knowledge src/retrieval` | 1 | 没有 active generation、cross-process publish lock 或 expected-active CAS | REPRODUCED |

### 0.2 固定检索基线

Fixture：`test/fixtures/retrieval/production-eval-50.json`

| 指标 | Before | After | 门槛 | 状态 |
| --- | ---: | ---: | --- | --- |
| Recall@5 | 0 | 0 | After ≥ Before | PASS |
| MRR | 0 | 0 | After ≥ Before | PASS |
| Direct precision | 1 | 1 | After ≥ Before | PASS |
| No-hit abstention | 1 | 1 | After ≥ Before | PASS |
| Must-escalate | 1 | 1 | After ≥ Before | PASS |

基线命令：`node dist/cli.js retrieval eval --questions test/fixtures/retrieval/production-eval-50.json --workspace /Users/king/my/super-helper --knowledge-root /Users/king/my/super-helper/test/fixtures/knowledge --report /private/tmp/fix-answer-fidelity-baseline.json`

退出码：`1`（指标门槛未通过，命令正常生成完整报告）

Fixture hash / git identity：`ca1f94256cd6dc7254ab57882f88be941a98df5a` / `0fc42fc002978f88d4d964dd8593518709b8a0c0`

实际 Before 指标：Recall@5 `0`、MRR `0`、direct precision `1`、no-hit abstention `1`、
must-escalate `1`；50 题、22 个 retrieval failure。该基线是显式空测试 corpus 的离线安全下限，
后续 After 必须用相同命令、fixture 和知识目录比较。

After 于 2026-07-29 使用完全相同命令、fixture、workspace 与空测试 corpus 执行；CLI
退出码仍为 1（默认 release threshold 要求全部指标为 1，而该固定 corpus 没有 direct-answer
父文档），但完整 report 正常生成，`offline=true`、50 题、22 个 retrieval failure。五项指标
与 Before 分别相等，因此“不低于基线”检查通过。该结果只证明无回归，不把空 corpus 的
Recall@5/MRR=0 描述为检索质量通过；定向临时知识 workspace 的 production-path 用例另行通过。

### 0.3 兼容基线

- 公共 HTTP chat/session DTO：以当前 dirty master 为基线；既有 chat response shape 不变，另一个在途 change
  已在 session DTO 增加 optional `retryableTurn`。本 change 不得删除或改写该字段。
- Case JSON：继续使用 `StoredCase.messages`、`runs`、`logs` 现有 shape；本 change 不增加必填持久化字段。
- `DiagnosticRequest`/`DiagnosticResult`：公共合同继续由 `src/contracts/diagnostic.ts` 与
  `src/contracts/base.ts` 定义；coverage/projection/generation 新结构必须保持 runtime-only 或
  knowledge artifact-owned，不把新必填字段塞入公共 request/result。
- 旧 v3：`node --test test/retrieval-grounding.test.mjs` 基线退出码 0，其中
  `old chunks remain readable without invented grounding defaults` 通过。整改后保持“可读、investigation-only、
  strict-direct-ineligible”，不得伪造 v4 metadata。

### 0.4 依赖与凭据结论

- 不新增外部 API、协议、provider 或凭据类型。
- model review 复用现有 `AgentModelClient` 和 registry 配对；embedding/rerank 复用现有 adapter。
- 默认验收显式使用 fake/noop/offline seam；未设置 `SUPER_HELPER_REAL_ACCEPTANCE=1` 时不得解析真实
  SecretRef/env、访问网络或重建真实知识目录。
- 本次基线评估 `offline=true`，未读取真实配置或凭据。

### 0.5 OpenSpec 严格校验

`openspec validate fix-answer-fidelity-and-retrieval-quality --strict` 于 2026-07-27 执行，
退出码 0：`Change 'fix-answer-fidelity-and-retrieval-quality' is valid`。

## Gate A — 回答投影

### RED evidence

| Task | 命令 | 退出码 | 目标失败断言 | 状态 |
| --- | --- | ---: | --- | --- |
| 1.x validator/source-neutral independent coverage review | `node --test test/answer-fidelity-gate-a.test.mjs` | 1 | 13/13 按预期 RED：supporting rejection 连坐、union/fullQuestionClaimIds 缺失、producer answers 被直接信任、review unavailable 未阻断、source-neutral materializer 不存在、边界合同缺失、structured blocker/duplicate identity 未全局阻断、outcome reason/state table 不存在 | RED_CONFIRMED |
| 3.x model/fallback/prompt safety | `pnpm build && node --test test/answer-fidelity-provenance.test.mjs test/answer-fidelity-gate-a.test.mjs test/answer-fidelity-presentation.test.mjs` | 1 | 缺少显式 freeze API、可信 provenance resolver、安全 failure formatter 与 plan validation export；8 个目标断言失败 | RED_CONFIRMED |

### GREEN evidence

| Task | 修改文件 | 命令 | 退出码 | 关键通过断言 | 状态 |
| --- | --- | --- | ---: | --- | --- |
| 2.x validation/coverage-materializer/review/projection | `src/runtime/{result-validator,answer-coverage,coverage-evidence-provenance,review-gate,safe-answer-projection}.ts` | `pnpm typecheck && pnpm build && node --test test/answer-fidelity-provenance.test.mjs test/answer-fidelity-gate-a.test.mjs test/turn-presentation-integrity.test.mjs test/module-boundaries.test.mjs` | 0 | 显式 structure→reviewed freeze；缺 coverage review 不可 final；kind 不可自证 freshness；陈旧 run、非只读/非 allowlist MCP、history/unknown 均拒绝；当前 adapter envelope 可 final；raw summary/source marker 不进入 model payload | GREEN |
| 2.2 production materializer entry | `node --test test/answer-fidelity-provenance.test.mjs` | RED 1 / GREEN 0 | RED：`materializeCurrentCoverageReviewInput is not a function`；GREEN：统一入口在 runtime 内解析 Workspace/MCP/manual/log envelopes，history 不可物化，7/7 通过；修改 `src/runtime/answer-coverage.ts`、`src/runtime/review-presentation.ts`、`test/answer-fidelity-provenance.test.mjs` | GREEN |
| 4.x presentation/redaction/visible-prompt review | `src/runtime/{review-presentation,safe-answer-projection,safe-failure-presentation,visible-prompt-safety}.ts` | `node --test test/answer-fidelity-presentation.test.mjs test/turn-presentation-integrity.test.mjs` | 0 | model/fallback 同源渲染；非法 plan 记录 rejected 并 fallback；生产 review 不再 import raw presenter；failure formatter 不接收 DiagnosticResult/Evidence/Claim | GREEN |
| 4.4 raw presenter removal | `node --test test/answer-fidelity-provenance.test.mjs test/conversation-evidence-lifecycle.test.mjs test/runtime-hardening.test.mjs test/supper-helper.test.mjs` | RED 1 / GREEN 0 | RED：静态边界命中 `DiagnosticResult`/`WorkerTrace`/业务关键词分类；GREEN：`presenter.ts` 仅导出 safe projection renderer，Preflight/persona helper 分离，旧 raw formatter 与关键词模板删除，126/126 通过 | GREEN |

### Gate A golden replies

- Model-planned：offline production composition 只返回 ID plan，安全 renderer 输出完整主答、限制、时效与 action。
- Deterministic fallback：同一投影在非法 plan 时输出同一 required 内容集合。
- Rejected-summary leak scan：rejected summary/unused evidence/raw marker 不进入 coverage payload 或 reply。
- Renderer raw-result reachability：`presenter.ts` 只导出 safe renderer；production composition 静态测试无 raw result 路径。
- Producer over-label / reviewer unavailable：仅 reviewer-accepted bindings 授予 coverage；unavailable/malformed 保守非 final。
- Worker/MCP positive coverage / raw evidence payload absence / 1000·20·40·24000 bounds：当前 Worker adapter 与当前 validated allowlisted read-only MCP adapter 已接入；`review production seam permits final only with current adapter provenance...` 与 focused Gate A tests 通过。Knowledge v4/Experience re-resolution 仍待 Gate C/2.4。
- fullQuestionClaimIds production freeze→projection presence：offline acceptance 中同 item 的 scope claim
  由 fullQuestionClaimIds 强制进入 model/fallback 两条路径。
- Opaque prompt fact-injection / batch limit：最多 10 项；unknown/malformed/unavailable 未明确接受的 prompt 不可见。
- Required-segment 1000/1001 boundary：1000 通过，1001 阻断；optional 600/601、prompt 300/301 同样按 whole item 处理。
- 模块边界检查：`node --test test/module-boundaries.test.mjs`，26/26。

Gate A 结论：GREEN。Knowledge current v4、Worker/MCP current envelope、manual/current-log
eligibility 与 Experience current-source resolver 已接入；history/unknown 无旁路。

### `presenter.ts` 边界说明

`presenter.ts` 只保留 safe projection renderer export；worker failure 只接收结构化枚举/状态。
Reviewed DiagnosticResult 的用户可见路径只能经过 `SafeFrozenAnswerProjection`，无 raw
DiagnosticResult/summary/evidence formatter 兼容入口。

### 本轮剩余 Gate A 缺口

- 当前无 Gate A 实现缺口；最终 change 级全仓命令与独立 reviewer 仍在后续 closure gate。

## Gate B — AnswerGoal 与 worker

### RED evidence

| Task | 命令 | 退出码 | 目标失败断言 | 状态 |
| --- | --- | ---: | --- | --- |
| 6.x Preflight/separate completeness review/reconcile/identity | `pnpm build >/dev/null && node --test test/answer-goal-gate-b.test.mjs` | 1 | 新模块/独立 reviewer 尚不存在；随后生产接线 RED 命中 accepted items 被重建覆盖、Experience 历史 reply 包装和 current resolver 缺失 | RED_CONFIRMED |
| 8.x worker actionable contract | `pnpm build >/dev/null && node --test test/worker-action-contract.test.mjs` | 1 | 0/3：prompt 未要求结构化 action safety、parser 接受非结构化 action、answers 未限制为当前精确 item | RED_CONFIRMED |

### GREEN evidence

| Task | 修改文件 | 命令 | 退出码 | 关键通过断言 | 状态 |
| --- | --- | --- | ---: | --- | --- |
| 7.x AnswerGoal + completeness-review chain | `src/runtime/{answer-goal-reconciliation,answer-goal-completeness-review-service,preflight-service,knowledge-experience-resolver}.ts`、`src/agents/answer-goal-completeness.md` | `pnpm build >/dev/null && node --test test/answer-goal-gate-b.test.mjs test/conversation-evidence-lifecycle.test.mjs` | 0 | proposer 与 completeness reviewer 分离；1–5 项、80 code points、连续原文片段、整组 sentinel 回退；exact-goal + current evidence replay；不使用“多久/哪里/怎么”词表 | GREEN |
| 8.x worker prompt/validation | `src/workers/claude/{claude-prompts,claude-output-parser,worker-result-normalizer,coverage-evidence}.ts` | `node --test test/worker-action-contract.test.mjs` | 0 | next_action 必须 evidence-bound、精确 answers、actionSafety/executionStatus；非结构化动作丢弃；需授权动作标为待人工授权 | GREEN |

### Identity trace

- Reconciled items：测试示例 count=2，稳定去重后 identity 不变；日志只记录 source/count/fallback reason，不记录文本。
- Proposer/completeness-review：同一 Preflight proposer call 后独立 completeness call=1；proposer 自评字段不能授予完整性。
- Knowledge/Worker/MCP claims answers：只保留当前 `mustAnswerItems` 的精确 identity。
- Reviewer bindings：producer `answers` 仅是候选；独立 coverage batch 产出 bindings 与
  `fullQuestionClaimIds`，freeze 使用稳定并集。
- Sentinel：兼容回退仍可运行，Presentation 中不可见。
- Experience：resolvedQuestion + answerObject + item set 精确相等，并对 active v4 Knowledge 或
  current Workspace/MCP resolver 重新取证；历史 reply、legacy/stale/unresolvable evidence 均不可 replay。

Gate B 结论：GREEN（focused suite 41/41；最终全仓验收仍在 change 级 gate 执行）

## Gate C — v4 artifact 与 span

### Version/hardcode inventory

| 文件/位置 | 改动前版本 | 处理（更新/兼容保留/N/A） | 证据 |
| --- | --- | --- | --- |
| `src/knowledge/documents/chunk-contracts.ts`、`types/artifacts.ts` | child v3 | 更新 child 为 `artifact_version=4` / `parent-child-v4`；reader union 保留 2/3/4 | `test/knowledge-v4.test.mjs` |
| `src/knowledge/vector-index.ts`、`vector-utils.ts` | child v3；vector manifest schema v1 | embedding/hash 改用 retrieval text/hash；vector manifest `version=1` 兼容保留，不误改为 4 | `test/knowledge-vector.test.mjs` |
| `src/knowledge/migration.ts`、readers | v2/v3 legacy | v3 parent 仍可作为 canonical source；任何非 v4 child 强制 `legacy=true` | Gate C legacy test |
| `src/knowledge/templates.ts`、`slicer-render.ts` | parent marker v3 | 新写 parent marker 更新为 v4；既有 parent 只读兼容 | build/lint |
| fixtures/tests | v2/v3/v4 混合 | v2/v3 仅保留明确 legacy compatibility fixture；current producer fixture 更新 v4 | focused + full suite |
| `generation-manifest.json` | 不存在 | 新增独立 schema `version=1`，记录 child version/strategy、mode、previous、counts、file hashes；不与 child version 混淆 | generation tests |

### RED/GREEN evidence

| Task | RED 命令/退出码 | GREEN 命令/退出码 | 修改文件 | 状态 |
| --- | --- | --- | --- | --- |
| 10–11 v4 artifact/rebuild | `node --test --test-name-pattern="pins one active knowledge generation" test/retrieval.test.mjs` → 1；`--test-name-pattern="rollback participates"` → 1；`--test-name-pattern="validates chunk identity"` → 1；`--test-name-pattern="application rebuild keeps"` → 1 | 同命令均 0；`node --test test/knowledge-v4.test.mjs test/knowledge-vector.test.mjs test/retrieval.test.mjs` → 0 | `src/knowledge/{generation-store,vector-index}.ts`、`src/knowledge/indexes/{build,chunks}.ts`、`src/application/knowledge-rebuild-service.ts`、retrieval recall/service | GREEN |
| 12 answer span/Judge | 新增 1/2/3/4 单元、500/501、list、heading-only、域外文本测试后命中 4 个 RED；新增 safe rebalance test 初次 1 | `node --test test/knowledge-v4.test.mjs test/retrieval-grounding.test.mjs` → 0 | `src/retrieval/answer-span.ts`、`src/runtime/evidence-judge.ts`、`src/knowledge/documents/{chunks,chunk-utils}.ts` | GREEN |

### Rebuild and rollback

- 临时 workspace：全部使用 `mkdtemp`，结束后递归清理。
- V4 chunk count / unique IDs：publisher 校验 manifest count、JSONL count 与唯一 `chunk_id`。
- Rebuild mode：embedding disabled 发布完整 BM25-only；enabled/requested 先在 application 构建完整
  hybrid candidate，任一 provider/vector failure 不激活。
- Generation manifest：schema v1，记录 child artifact 4、`parent-child-v4`、mode、previous、count、dimension 与 file hashes。
- Active pointer：同目录 temp+fsync+rename，只替换 `active.json`。
- Hash：`text_hash` 是 child identity；`retrieval_text_hash` 是实际 embedding input hash。
- Vector：校验 vector manifest count、record count、chunk binding 和维度。
- Lock/CAS：publish 与 rollback 使用同一 cross-process lock；fresh lock 返回 busy；stale lock仅显式 recovery；两个 stale publisher 只有首个成功。
- Reader：`retrieve()` 开始只解析一次 generation ID，所有 recall reader 固定该 ID；激活中途切换不混代。
- Incomplete/crash：缺 complete/manifest/hash 的 generation 不可成为 active。
- Rollback：expected-active CAS + previous generation 完整 hash 校验后原子切回。
- Undersized：安全 merge/rebalance；不可处理者标 `undersized_unmergeable`，strict/remote embedding ineligible。
- Normal request：新增 knowledge tree size/mtime 快照测试，检索前后完全一致。

Gate C 结论：GREEN。固定 50 题 after 指标不低于离线空 corpus 基线；cross-gate
production composition、generation 并发/恢复、路径完整性与最终全仓命令均已通过。

## Cross-Gate 离线验收

环境约束：

- 临时知识目录：`mkdtemp`；两个 runtime 路径和 provider harness 均在 finally 清理。
- Fake model：按 system contract 区分 Preflight proposer、goal completeness、coverage、
  prompt-safety、Presentation；fake embedding/rerank 经 production application/configured retrieval 运行。
- Reviewer call/batch counts：Preflight 2、completeness 2、coverage 2、prompt-safety 0（无
  opaque prompt candidate）、Presentation 2；embedding build batch 1、embedding recall 1、rerank 1。
- Network sentinel expected/actual：`0 / 0`
- Poisoned SecretRef/env resolver read count expected/actual：`0 / 0`
- 真实 env secret 读取：必须为 0

| Golden case | 命令 | 退出码 | 关键断言 | 状态 |
| --- | --- | ---: | --- | --- |
| worker steps 两条 Presentation 路径可见 | `pnpm acceptance:answer-fidelity:offline` | 0 | model plan 与非法 plan fallback 均显示完整主答、时效、限制与两条 action | PASS |
| supporting rejection 不连坐且无回流 | Gate A focused suite | 0 | supporting 局部移除；summary/unused evidence 不回流 | PASS |
| proposer 少报/producer 过标均不能伪造完整覆盖 | Gate A/B focused suite | 0 | completeness 整组 sentinel；coverage 只接受受支持 binding | PASS |
| 同 item 必要条件 claim 由 fullQuestionClaimIds 强制进入两条 Presentation 路径 | offline acceptance | 0 | `primary_config` 与同 item 的 `primary_scope` 均在 model/fallback 可见 | PASS |
| 当前 Worker/MCP evidence 可 final，raw marker 不入 reviewer payload | provenance/MCP production tests | 0 | current validated envelopes 可用；payload 无 raw summary/source/secret/path marker | PASS |
| coverage 缺项显示初步判断 | Presentation focused suite | 0 | partial inference 标注初步判断且不冒充 final | PASS |
| opaque prompt 夹带事实被拒且 outcome 重冻结 | Presentation focused suite | 0 | unavailable/unknown prompt review 不授予可见性 | PASS |
| anchor/secret/path 全回复安全 | offline acceptance + presentation tests | 0 | 回复开头锚定 resolvedQuestion；secret/internal path/trace 不可见 | PASS |
| span 完整或 abstain | Gate C focused suite | 0 | 1–3/list 完整；4 单元/501/heading-only/no-match abstain | PASS |
| v3/undersized ineligible / validated v4 eligible | Gate C focused suite | 0 | legacy 强制 true + rebuild_required；undersized 不可 strict/remote embedding | PASS |
| Experience current evidence 不支持/非知识来源无法重验/同 sentinel 不同问题时不可 replay | Gate B production test | 0 | exact goal + current resolver 才 replay | PASS |
| 双 publisher 只有一个成功且 rollback CAS 正确 | Gate C generation tests | 0 | loser conflict；rollback lock/CAS/hash 校验 | PASS |

## 兼容与文档

| 检查 | 命令/证据 | 结果 |
| --- | --- | --- |
| HTTP response shape | `pnpm test`：`public API routes keep compatible response shapes`、sync/async flow | PASS |
| Case JSON shape | `pnpm test`：`legacy Case JSON remains readable and is rewritten without a wrapper shape` | PASS |
| DiagnosticRequest/Result required fields | `test/supper-helper.test.mjs` 与 Gate A/B contract tests | PASS |
| Agent registry/config pairing（含三类独立 review seam） | `agent registry exposes main and configured sub-agent contracts` | PASS |
| Module boundaries / thin CLI | `test/module-boundaries.test.mjs`、owner line-budget tests | PASS |
| Architecture and migration docs | `pnpm lint` | PASS |

## 真实 provider / 真实知识目录 / 浏览器 E2E

用户于 2026-07-31 明确授权使用已经配置的真实环境进行端到端验收。唯一验收开关仍为
`SUPER_HELPER_REAL_ACCEPTANCE=1`；未设置时命令安全返回 `NOT_RUN`，不读取真实配置、凭据或网络。

新增命令 `pnpm acceptance:answer-fidelity:real` 先构建当前源码，再在随机本地端口启动正式
Gateway，通过 `/api/chat` 提交含两个必答项的只读代码问题，轮询正式 session，检查真实
worker、代码 evidence、必答项覆盖、整份回复安全与 reviewed final。harness 只输出有界状态，
不输出回复正文、provider payload、retrieval text 或凭据，并在 finally 删除验收 case、关闭 server。

| 验收 | 命令/证据 | 状态 | 脱敏结论 |
| --- | --- | --- | --- |
| 无开关安全跳过 | `pnpm acceptance:answer-fidelity:real` | NOT_RUN（退出码 0） | 未进入真实配置/网络路径 |
| 浏览器生产资源与 Gateway workflow | `pnpm test:e2e` | PASS（5/5） | dashboard、setup、问候、瞬态终态、retry 全通过；问候断言不再依赖问题关键词 |
| Real active knowledge | real answer-fidelity harness | PASS | active generation `gen_946a2ce4-8ff3-4c96-b8a8-da6b2f05b06d` |
| Real Claude worker | real answer-fidelity harness | PASS | 配置命令可用，真实执行 exit code 0 |
| Real `/api/chat` 与双问题覆盖 | real answer-fidelity harness | PASS | async chat 接受；两个问题均包含对应 `src/` 代码 evidence |
| 整份用户回复安全 | 首次 FAIL → renderer 边界整改 → 复跑 | PASS | 不含 secret、trace、payload 或 `direct_answer` 兼容标记 |
| Real agent model | real answer-fidelity harness | NOT_RUN | `agent.modelProvider` 未配置，独立 completeness/coverage/prompt/presentation reviewer 不可用 |
| Real embedding | real answer-fidelity harness | NOT_RUN | `embedding.enabled=false` |
| Real rerank | real answer-fidelity harness | NOT_RUN | `rerank.enabled=false` |
| Reviewed final answer | real answer-fidelity harness | FAIL | 真实 worker 有完整答案，但独立 reviewer 不可用，runtime 按合同保守保持 `partial/partial` |

真实知识目录先执行
`SUPER_HELPER_REAL_ACCEPTANCE=1 pnpm knowledge:update -- --workspace /Users/king/my/super-helper --quality-gate warn`，
成功发布并激活上述 v4 generation：764 chunks、parse failure 0。旧 flat artifacts 仍只读保留，
未在请求路径自动改写。

随后两次执行
`SUPER_HELPER_REAL_ACCEPTANCE=1 pnpm accept:knowledge -- --workspace /Users/king/my/super-helper --real-worker --timeout-ms 120000`
均正常完成真实 worker，但 direct-answer 场景未通过。迁移前 blocker 包含
`missing_answer_bearing_sentence`、`low_quality_evidence`、`missing_provenance`；迁移后仍有
`low_quality_evidence`、`missing_provenance`，其中一个场景还保留
`missing_answer_bearing_sentence`。v4 质量报告统计 error=382、warn=423、info=67，主要是
`missing_source_document=381`、`missing_source_block_ids=257`、`not_answer_bearing=142`。
报告文件：

- `/Users/king/.super-helper/knowledge/workspaces/current-project-81b5452b5696/reports/knowledge-acceptance-2026-07-30T16-07-39-533Z.json`
- `/Users/king/.super-helper/knowledge/workspaces/current-project-81b5452b5696/reports/knowledge-acceptance-2026-07-30T16-09-01-324Z.json`

这些 blocker 来自既有 parent slice 缺少 `source_block_ids` 等 provenance，而当前源码 pipeline 已要求
该字段。继续修复真实数据需要重新 slice，并经过人工 review/publish；本轮未自动批准或批量发布
257 个待审核 slice，避免绕过知识审核边界。

### 真实环境最终整改与复验（2026-07-31）

上面的 NOT_RUN/FAIL 是首次验收记录，已由本节最终结果取代。整改严格走正式
extract → normalize → slice → audit → quality-clean review → publish → atomic generation update，
没有把 warning/error 切片冒充人工通过，也没有新增业务关键词匹配。

| 问题 | RED 证据 | 整改 | GREEN 证据 |
| --- | --- | --- | --- |
| provider/knowledge CLI 只读取 SecretRef，不物化文件密钥 | `provider CLI materializes file SecretRefs before smoke tests` 首次报 `loadProviderCommandConfig is not a function`；真实 embedding 报 `missing_credentials` | provider/knowledge CLI 在命令边界物化文件 SecretRef；无可执行凭据时 `knowledge update` 保持 BM25，有凭据时构建 hybrid | focused tests PASS；真实 embedding/rerank smoke PASS |
| `knowledge update` 在 Embedding 启用时仍降级 BM25 | active generation `gen_45ecbd11-1548-4e8a-8b37-0787a663b835` 显示 `mode=bm25_only` | application rebuild 接收 embedding port/config；CLI 只在凭据可执行时注入 provider | active `gen_296306d2-b889-4401-91a0-ef8e6affa961`：hybrid、1098 chunks、257 vectors、1024 dimensions |
| audit 读取旧 flat chunks，误报 149 个 `missing_parent` | `7.4b` 新断言 RED；真实 audit warn=570、`missing_parent=149` | chunk audit 使用 active generation 的 `chunksPath()`；orphan fixture 通过完整 generation 发布注入 | focused tests PASS；`missing_parent=0`，EduSoho direct scenario PASS |
| 重切片遗留旧 draft，且 draft mirror 污染已发布文档质量 | stale draft 与 draft-mirror fixtures RED | 成功重切片后清理本 source 的 stale `.md`；quality map 忽略 `_pipeline/drafts/` issue | focused tests PASS；safe repair 228 applied / 260 review-required skipped |
| DOCX 表格文字被拆成 paragraph，并统一标 `table_lost` | `DOCX extraction preserves table rows as provenance-bearing table blocks` RED | `local-docx-v2` 保留行/单元格为 table block，只有确实无法保留时才报 `table_lost` | focused test PASS；AI source `table_lost` 清零，10 个 quality-clean AI slices 正式发布 |
| 真实 worker 已完整回答但返回 partial | worker prompt contract test RED | 明确“所有 mustAnswerItem 均有 evidence-supported primary 且 missingInfo 为空”必须 concluded/final_answer | worker contract test + 真实 `/api/chat` reviewed final PASS |
| sentinel/内部字段大小写与裸标识可进入可见回复 | Presentation persona safety tests 与真实 E2E RED | safe projection 与 whole-reply renderer 双层、大小写不敏感清理兼容 sentinel、worker trace、provider payload | focused tests + 真实整份回复 safety PASS |
| 系统时钟跳变让真实 E2E 瞬间超时 | 失败 case 只有 user message、无 Run；系统时钟从约 01:28 跳到 03:25 | deadline 改用单调 elapsed clock；非法 timeout 输入回退 300 秒 | `real acceptance deadline uses elapsed monotonic time...` PASS；真实 E2E 随后整体 PASS |
| provider `--home` 夹具可把配置写回真实 storage | 逐文件隔离定位 `test/embedding.test.mjs`；外部 sentinel 被覆盖 | provider smoke 改为只读 load；显式 home 同时限定 config 与 secrets 边界，不调用 `ensureConfig` 保存 | `provider CLI --home is read-only...` PASS；完整 `pnpm test` 后真实配置摘要保持不变 |
| DOCX 同一词跨多个 text run 时被插入空格 | split-run 断言 RED（`AI伴学助手` 被读成带空格文本） | paragraph/table cell 内按 Word run 原序无缝拼接，单元格之间仍使用结构分隔 | DOCX focused test PASS |

真实知识验收最终报告：
`/Users/king/.super-helper/knowledge/workspaces/current-project-81b5452b5696/reports/knowledge-acceptance-2026-07-30T23-19-30-439Z.json`。
六项全部 PASS：配置、AI 白皮书直答、EduSoho 白皮书直答、no-hit 升级、实现细节升级、
solved-case curation smoke。真实 answer-fidelity harness 最终 11/11 PASS：model、embedding、
rerank、active v4 knowledge、Claude worker、chat、worker execution、双问题覆盖、整份回复安全、
reviewed final、case cleanup。

### 最终 diff 真实外部服务复验（2026-08-10 至 2026-08-11）

用户于 2026-08-10 明确授权把完成真实 E2E 所必需的项目代码与检索片段发送到已配置的
model、embedding、rerank 与 Claude 服务。首次复验确认 agent model、embedding、rerank、active v4
generation 与 Gateway 均可用，但 Claude CLI 的全局配置指向 `127.0.0.1:15721`，对应 CC Switch
进程未启动，最小只读 Claude 请求稳定返回 `ConnectionRefused`。后台启动已安装的 CC Switch 后，
端口恢复监听，最小只读 Claude 请求以 exit code 0 完成；未改写全局 Claude 配置或凭据。

恢复外部链路后又发现两个真实 harness 缺口，均按 RED → GREEN 修复：

| 问题 | RED 证据 | 整改 | GREEN 证据 |
| --- | --- | --- | --- |
| Worker 失败只报告笼统状态，无法区分超时/信号/非零退出 | 真实 E2E 仅报告 `real worker did not complete cleanly` | 仅输出有界、脱敏的 exitCode/signal/error 元数据，不输出 stdout/stderr/provider payload | `real acceptance reports bounded worker failure metadata without provider output` PASS |
| harness 总等待时间硬封顶 5 分钟，短于配置的 20 分钟 Worker 预算 | CC Switch 恢复后，正式回复完成前被 harness 超时并清理 case | 默认预算改为 Worker timeout + 5 分钟独立审核余量，最大 30 分钟；显式 override 保留 | `real acceptance timeout includes the configured worker budget and review reserve` PASS |
| session 轮询一次瞬时 `fetch failed` 会直接终止，但 finally 删除请求随后成功 | `/api/chat` 已 202，单次本地轮询瞬断后 overall FAIL | 仅对 fetch 网络型 `TypeError` 在总 deadline 内重试；协议/JSON 错误仍立即失败 | `real acceptance retries only transient fetch polling failures` PASS |
| Worker 引用安全扫描正则源码时，字面 `\\bdirect_answer\\b` 可绕过自然语言词边界清洗 | 真实 E2E 首次复跑仅 `visible_reply_safety` FAIL；focused 用字面正则与 `strict_direct_answer` 稳定复现 | 抽取 runtime 统一 compatibility-sentinel redaction，同时覆盖自然 token、字面正则边界和包含该内部 sentinel 的标识符；projection 与 whole-reply scan 两层复用 | Presentation focused RED 15/16 → GREEN 16/16；真实 E2E 最终 11/11 PASS |

最终 `SUPER_HELPER_REAL_ACCEPTANCE=1 pnpm acceptance:answer-fidelity:real` 退出码 0，11/11 PASS：
真实 model、embedding、rerank、active generation `gen_296306d2-b889-4401-91a0-ef8e6affa961`、
Claude worker、async chat、worker execution、双问题代码证据、整份回复安全、reviewed final 与 case cleanup
全部通过。最终真实知识验收报告为
`/Users/king/.super-helper/knowledge/workspaces/current-project-81b5452b5696/reports/knowledge-acceptance-2026-08-10T23-14-14-759Z.json`，
6/6 PASS。harness 输出未包含凭据、完整 provider payload、完整 retrieval text 或知识正文。

## Anti-Fake-Complete 审计

| 检查 | 命令/方法 | 结果 |
| --- | --- | --- |
| 无 `.only` / 新增 `.skip` / 空断言 | `rg -n "\\.only\\(|\\.skip\\(|test\\.skip|describe\\.skip" test src` | PASS，无命中 |
| Fixture 未被弱化 | `git diff -- test/fixtures/retrieval/production-eval-50.json` | PASS，空 diff |
| Failure injection 能触发失败 | RED 记录 + generation incomplete/conflict/rollback/metadata、review malformed/unknown tests | PASS（已执行范围） |
| Production seam mutations（非反转测试断言） | `pnpm audit:answer-fidelity:mutations`；临时修改 production seam、运行 focused test、`finally`/signal 恢复 | PASS，15/15 mutations killed |
| 所有 version hardcode 已归类 | Gate C `Version/hardcode inventory` 与 `rg` 扫描 | PASS |
| 所有 reply builder 已归类 | Gate A `presenter.ts 边界说明`、module boundary tests | PASS |
| 所有 answer-bearing pattern 已归类 | `answer-span.ts` / `evidence-judge.ts` focused static test | PASS |
| 所有 mustAnswer producer/consumer 已归类 | Gate B identity trace、Gate A/B focused suite | PASS |
| completeness/coverage/prompt reviewer 无 producer 自证旁路 | 独立调用计数、malformed/unavailable/self-certification tests | PASS |
| fullQuestionClaimIds 未被 production freeze/projection 忽略 | offline production composition | PASS |
| source-neutral coverage materializer 无 raw/stale evidence 旁路 | provenance + MCP/Worker production tests | PASS |
| publisher lock/CAS/undersized eligibility 无旁路 | Gate C focused suite | PASS |
| 独立 reviewer 反向审计 | 非原实现者 Codex 子代理（任务 `/root/independent_reverse_audit`）四轮反向审计；最终 identity 与独立反例复测见下节 | PASS，最终 Critical/Important/Minor 均为 0，Ready |

### 代码审查发现与整改

| 严重度 | 发现 | 整改 | 验证 |
| --- | --- | --- | --- |
| Important | Experience current-source 重验先读 active ID、后隐式重读 active chunks，切换时可能混代 | 按首次 generation ID 固定读取，并在返回前再次比较当前 active | Gate B pin/recheck test |
| Important | `activeArtifactPath` 仅检查 `complete.json`，未限制 generation ID 或验证 manifest identity/hash/v4 metadata | 增加安全 ID、manifest/complete identity、hash、必需文件与 v4 metadata 校验 | Gate C incomplete/traversal/rehash-invalid tests |
| Important | completeness/coverage provider 错误与 reason 可携带 secret 或无界文本；coverage 可接受 `full + missingElements` | 统一脱敏/限长，矛盾输出降为 unknown | Gate A/B redaction/contradiction tests |
| Important | publisher 创建 lock 后写 owner 失败会遗留伪 busy lock | 记录是否由本进程创建，初始化失败时清理并返回 `generation_lock_failed` | typecheck/build + generation focused suite |
| Important | 三个 Knowledge owner 超过 300 行 | 拆为 rebalance、generation validation、vector reader owner | owner line-budget + Gate C suite |
| Important | prompt-safety Agent 配置缺失时旧逻辑会默认接受全部 opaque prompts | 缺 seam、空响应或未知响应统一降为 `unknown`，不产生 accepted prompt IDs | `turn-presentation-integrity` unavailable-seam regression |
| Important | active BM25-only generation 缺少向量时，路径解析可能回落到 flat 旧向量 | valid active generation 始终拥有 artifact namespace；缺文件返回当前 generation 内缺失路径 | Gate C stale-flat-vector regression |
| Important | flat v4 artifact 可被误判为当前、参与直接回答或远程 embedding | flat artifact 仅兼容读取并强制 `legacy=true`；只有验证通过的 active generation 可成为 current | Gate C flat-v4 ineligible regression |
| Important | legacy vector builder 与 compatibility check 分多次读取 active pointer，切换时可能混代 | 首次读取后 pin generation ID；发布时使用 expected-active CAS | Gate C provider-race generation-conflict regression |
| Important | 旧 `writeKnowledgeChunks` API 在 active generation 存在时可能原地改写不可变 chunks，且“检查后再解析 active 路径”有 TOCTOU 窗口 | active generation 下拒绝 legacy 写入；legacy writer 固定写 flat 兼容路径，不再解析 active 路径 | Gate C immutable-writer regression + typecheck |
| Important | 真实 partial 回复会把内部兼容 item `direct_answer` 从 answerTarget/renderer 边界暴露给用户 | projection materializer 与 whole-reply renderer 双层删除 sentinel；不替换为另一段内部概念，也不按用户问题关键词判断 | Presentation RED/GREEN + sentinel 不可见测试 |
| Normal | 浏览器问候用例仍断言已删除的“具体问题/报错/功能异常”关键词模板 | 改为验证正式 helper 回复、当前问候文本与“无中断”用户行为 | `pnpm test:e2e` 5/5 |
| Critical | 独立审计发现 standalone provider token 与 trace/provider payload 尾部可穿过整份回复扫描 | 扩展 provider-shaped secret 清洗；先删除带标签 payload，再处理裸标签；清洗后仅剩占位符的 required primary 物化失败并降级 | Presentation payload RED/GREEN；独立 payload-only 反例复测 PASS |
| Critical | Worker `Evidence.summary` 与 MCP raw call text 可自证 coverage | Worker 只接受 `path:start-end` 并由 adapter 重读当前 workspace regular file；MCP 只使用当前 allowlisted read-only validated envelope 的结构化 claims | provenance/MCP production tests + 独立复核 PASS |
| Important | 非 primary claim 未经当前问题 relevance review 仍可显示；coverage 可接受空 binding/full IDs 或 producer 越权 item | coverage materializer 纳入带 exact current `answers` 的 primary/action/supporting；projection 只显示 reviewer binding；schema 强制非空 evidence/item、candidate 子集、非空 primary full IDs | Gate A schema/materializer/presentation tests |
| Important | Experience 伪造当前时间、整 chunk 复用并接受未来验证时间 | 固定 active generation 重解析 current v4 candidate，只取 canonical answer span，保留 parent 时间并要求 ageDays 位于 0..180 | stale/future/span tests + 独立复核 PASS |
| Important | strict quality 在 active 切换后才审核，且同步 publisher 在 prepare 后捕获 expected active | 审核同一 prepared candidate 后才发布；同步/异步路径均在 prepare 前捕获 expected active 并由 CAS 发布 | quality-before-publish、CAS ordering tests + 独立复核 PASS |
| Important | stale lock recovery 未充分校验 owner/active/incomplete generation | 校验 owner schema、正 safe PID、alive/EPERM、expected active 与完整 generation；只清理明确 incomplete/temp | recovery focused tests + 独立复核 PASS |
| Important | model 可重排 primary/action；sentinel 替换文本可见且安全 basename 丢失 | primary/action 永远保持 frozen 顺序；sentinel 删除；内部绝对路径仅保留安全 basename | Presentation order/path/sentinel tests |
| Minor | Worker 为取 41 行先读取完整文件，后续非阻塞修复又暴露 FIFO open 风险 | 使用 `O_NONBLOCK` 打开、fd `fstat` 拒绝非 regular、2MB 上限和固定长度 `readSync` | oversized/FIFO tests；独立 FIFO 约 1ms 返回空 evidence |

### 独立 reviewer 记录

- Reviewer / 执行主体：非原实现者 Codex 子代理，任务 `/root/independent_reverse_audit`，全程只读。
- 日期：2026-08-02（会话开始）至 2026-08-03（审计完成）。
- Reviewed base：`a7d6cdfbfa4e869a1dd21e9ef687b73ffddfa8a4`。
- 最终 reviewed tracked diff identity：SHA-256 `0e0138ab3b0a0da8796ea53556c8e73e78f42b1a691d3e8f2648299727f6b5ff`；审查者同时核对 4 个 untracked 文件逐文件 hash。
- 审计过程：第一轮发现 2 Critical + 7 Important；第二轮发现 1 Critical + 2 Important + 1 Minor；第三轮发现 2 Important；逐项整改后第四轮重新做旁路扫描与反例复测，最终 `Critical=None / Important=None / Minor=None`，结论 `Ready`。

| Production path | 最终独立结论 |
| --- | --- |
| AnswerGoal / 独立 completeness / structured binding | PASS |
| Coverage schema / `fullQuestionClaimIds` / non-primary relevance | PASS |
| Worker/MCP current source-neutral provenance | PASS |
| Experience active v4 / freshness / canonical answer span | PASS |
| Safe projection / whole-reply safety / required materialization | PASS |
| Primary/action order与 sentinel 不可见 | PASS |
| Quality-before-publish / publisher lock / expected-active CAS | PASS |
| Stale-lock recovery | PASS |

最终独立反例复测：FIFO locator 约 1ms 返回空 evidence；payload-only primary 降为
`partial` 并产生 `required_primary_materialization_failed`；>2MB 文件、未来
`last_verified_at` 均被拒绝；同步 publisher 两条路径均在 prepare 前捕获 expected active。

## 最终命令

| 命令 | 退出码 | 结果摘要 |
| --- | ---: | --- |
| `openspec status --change fix-answer-fidelity-and-retrieval-quality` | 0 | 4/4 artifacts complete |
| `openspec validate fix-answer-fidelity-and-retrieval-quality --strict` | 0 | Change is valid |
| `pnpm lint` | 0 | Docs lint passed |
| `pnpm typecheck` | 0 | TypeScript + Vue typecheck passed |
| `pnpm build` | 0 | Vite + build tsconfig passed |
| `pnpm test`（2026-08-03 独立审计 production diff） | 0 | 500/500 passed；测试后真实 provider/workspace 配置保持不变 |
| `pnpm test`（2026-08-11 最终提交前受限沙箱复跑） | 1（环境限制） | 发现并执行 503 项；非监听用例通过，Gateway/MCP/onboarding 等所有失败均为沙箱禁止 `listen 127.0.0.1/0.0.0.0` 的 `EPERM`；申请非沙箱复跑时平台执行额度拒绝，不是代码断言失败 |
| `pnpm audit:answer-fidelity:mutations` | 0 | 15/15 production seam mutations killed，原文件全部恢复 |
| `pnpm acceptance:knowledge:local` | 0 | 1/1 passed；poisoned env、无真实开关 |
| `pnpm acceptance:answer-fidelity:offline` | 0 | 1/1 passed；完整 production composition，network/secret reads 0 |
| `pnpm test:e2e` | 0 | Chromium 5/5 passed |
| `pnpm acceptance:answer-fidelity:real`（无开关） | 0 | NOT_RUN；未读取真实配置/网络 |
| `SUPER_HELPER_REAL_ACCEPTANCE=1 pnpm acceptance:answer-fidelity:real`（2026-07-30 历史实现点） | 0 | 11/11 PASS；仅作历史基准，不替代 2026-08-02 最终 diff 复验 |
| `SUPER_HELPER_REAL_ACCEPTANCE=1 pnpm acceptance:answer-fidelity:real`（2026-08-11 最终 diff） | 0 | 11/11 PASS；真实 model/embedding/rerank/active v4/Claude worker/双问题覆盖/整份回复安全/reviewed final/case cleanup 全通过 |
| `SUPER_HELPER_REAL_ACCEPTANCE=1 pnpm accept:knowledge -- --workspace /Users/king/my/super-helper --real-worker --timeout-ms 120000`（2026-08-11 最终 diff） | 0 | 6/6 PASS；最终报告 `knowledge-acceptance-2026-08-10T23-14-14-759Z.json`，AI/EduSoho direct-answer quality/provenance 均通过 |
| Gate A/B/C focused suites（2026-08-11 最终源码） | 0 | 149/149 passed |
| `node --test test/acceptance-harness.test.mjs`（2026-08-11 最终源码） | 0 | 5/5 passed；failure metadata 脱敏、总预算、瞬断重试、非 2xx fail-fast 均通过 |
| Cross-gate offline acceptance | 0 | 1/1 passed；network/secret reads 0 |
| `git diff --check` | 0 | 无 whitespace error |

## 偏差与决策

当前无实现偏差。后续任何偏差须记录：

- 原冻结合同；
- 发现的事实；
- 候选方案；
- 选择与风险；
- 同步修改的 proposal/design/spec/tasks；
- 新增 RED/GREEN 证据。

## 最终结论

状态：ABC 实现、兼容验证、离线验收、浏览器 E2E、真实外部服务 E2E、真实知识验收与独立反向审计均 PASS；
proposal Success Criteria、三个 Gate、cross-gate golden cases、兼容测试与 Anti-Fake-Complete 全部满足，
change closure 为 `READY_TO_ARCHIVE`。本次只完成并提交 change，不在未收到归档指令时自动归档。

剩余阻断项：无。
