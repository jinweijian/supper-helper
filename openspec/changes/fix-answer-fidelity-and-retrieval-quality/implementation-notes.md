# fix-answer-fidelity-and-retrieval-quality 实现证据

## 当前状态

- OpenSpec 方案整改：已完成；严格结构校验与仓库文档 lint 已通过（仅证明方案文档有效，不代表生产实现完成）。
- 生产代码实现：Gate A/B/C 与 cross-gate 离线生产组合已实现并通过最终仓库验证。
- 代码审查：已完成原实现者自审并修复 generation 竞态、审核错误脱敏/矛盾输出、
  active pointer 路径与元数据校验、锁初始化失败清理和模块体积越界；非原实现者反向审计仍未执行。
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

## 真实 provider / 真实知识目录

默认状态：NOT_RUN（这是中性状态，不是通过）。

唯一验收开关：`SUPER_HELPER_REAL_ACCEPTANCE=1`。未设置时即使环境存在凭据也不得读取或联网。

| 验收 | 授权/开关 | 状态 | 脱敏证据 |
| --- | --- | --- | --- |
| Real model | 用户未授权；`SUPER_HELPER_REAL_ACCEPTANCE` 未设置 | NOT_RUN | 未建立真实请求、未产生日志 |
| Real embedding/rerank | 用户未授权；`SUPER_HELPER_REAL_ACCEPTANCE` 未设置 | NOT_RUN | 未读取 provider secret；离线验收使用 poisoned env |
| Real knowledge rebuild | 用户未授权；`SUPER_HELPER_REAL_ACCEPTANCE` 未设置 | NOT_RUN | 仅使用 `mkdtemp` 临时目录 |

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
| 独立 reviewer 反向审计 | `[待实现；需包含 reviewer、日期、commit/diff identity、逐项结论、findings/关闭证据]` | NOT_RUN |

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

### 独立 reviewer 记录

- Reviewer / 执行主体：`[待实现，必须非原实现者]`
- 日期：`[待实现]`
- Reviewed commit / diff identity：`[待实现]`
- Spec → test → production path 逐项结论：`[待实现]`
- Findings：`[待实现]`
- 关闭证据：`[待实现]`

## 最终命令

| 命令 | 退出码 | 结果摘要 |
| --- | ---: | --- |
| `openspec status --change fix-answer-fidelity-and-retrieval-quality` | 0 | 4/4 artifacts complete |
| `openspec validate fix-answer-fidelity-and-retrieval-quality --strict` | 0 | Change is valid |
| `pnpm lint` | 0 | Docs lint passed |
| `pnpm typecheck` | 0 | TypeScript + Vue typecheck passed |
| `pnpm build` | 0 | Vite + build tsconfig passed |
| `pnpm test` | 0 | 484/484 passed |
| `pnpm audit:answer-fidelity:mutations` | 0 | 15/15 production seam mutations killed，原文件全部恢复 |
| `pnpm acceptance:knowledge:local` | 0 | 1/1 passed；poisoned env、无真实开关 |
| `pnpm acceptance:answer-fidelity:offline` | 0 | 1/1 passed；完整 production composition，network/secret reads 0 |
| Gate A/B/C focused suites | 0 | 126/126 passed |
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

状态：ABC 实现、兼容验证、离线验收与原实现者代码审查 PASS；change closure 仍为
`NOT_READY_TO_ARCHIVE`。

剩余阻断项：tasks 17.6 要求的非原实现者独立反向审计。真实 provider/真实知识目录保持
合规 `NOT_RUN`，不是阻断离线 ABC 结论，也不计为通过。完成独立审计前不得归档 change。
