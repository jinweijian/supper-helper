# fix-answer-fidelity-and-retrieval-quality 实现证据

## 当前状态

- OpenSpec 方案整改：已完成；严格结构校验与仓库文档 lint 已通过（仅证明方案文档有效，不代表生产实现完成）。
- 生产代码实现：未开始。
- tasks 勾选：0；任何任务不得仅因文档已补齐而标记完成。
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
| Recall@5 |  |  | After ≥ Before | NOT_RUN |
| MRR |  |  | After ≥ Before | NOT_RUN |
| Direct precision |  |  | After ≥ Before | NOT_RUN |
| No-hit abstention |  |  | After ≥ Before | NOT_RUN |
| Must-escalate |  |  | After ≥ Before | NOT_RUN |

基线命令：`node dist/cli.js retrieval eval --questions test/fixtures/retrieval/production-eval-50.json --workspace /Users/king/my/super-helper --knowledge-root /Users/king/my/super-helper/test/fixtures/knowledge --report /private/tmp/fix-answer-fidelity-baseline.json`

退出码：`1`（指标门槛未通过，命令正常生成完整报告）

Fixture hash / git identity：`ca1f94256cd6dc7254ab57882f88be941a98df5a` / `0fc42fc002978f88d4d964dd8593518709b8a0c0`

实际 Before 指标：Recall@5 `0`、MRR `0`、direct precision `1`、no-hit abstention `1`、
must-escalate `1`；50 题、22 个 retrieval failure。该基线是显式空测试 corpus 的离线安全下限，
后续 After 必须用相同命令、fixture 和知识目录比较。

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
| 3.x model/fallback/prompt safety | `[待实现]` |  |  | NOT_RUN |

### GREEN evidence

| Task | 修改文件 | 命令 | 退出码 | 关键通过断言 | 状态 |
| --- | --- | --- | ---: | --- | --- |
| 2.x validation/coverage-materializer/review/projection | `[待实现]` | `[待实现]` |  |  | NOT_RUN |
| 4.x presentation/redaction/visible-prompt review | `[待实现]` | `[待实现]` |  |  | NOT_RUN |

### Gate A golden replies

- Model-planned：`[待实现，必须脱敏]`
- Deterministic fallback：`[待实现，必须脱敏]`
- Rejected-summary leak scan：`[待实现]`
- Renderer raw-result reachability：`[待实现]`
- Producer over-label / reviewer unavailable：`[待实现]`
- Worker/MCP positive coverage / raw evidence payload absence / 1000·20·40·24000 bounds：`[待实现]`
- fullQuestionClaimIds production freeze→projection presence：`[待实现]`
- Opaque prompt fact-injection / batch limit：`[待实现]`
- Required-segment 1000/1001 boundary：`[待实现]`
- 模块边界检查：`[待实现]`

Gate A 结论：NOT_RUN

## Gate B — AnswerGoal 与 worker

### RED evidence

| Task | 命令 | 退出码 | 目标失败断言 | 状态 |
| --- | --- | ---: | --- | --- |
| 6.x Preflight/separate completeness review/reconcile/identity | `[待实现]` |  |  | NOT_RUN |
| 8.x worker actionable contract | `[待实现]` |  |  | NOT_RUN |

### GREEN evidence

| Task | 修改文件 | 命令 | 退出码 | 关键通过断言 | 状态 |
| --- | --- | --- | ---: | --- | --- |
| 7.x AnswerGoal + completeness-review chain | `[待实现]` | `[待实现]` |  |  | NOT_RUN |
| 8.x worker prompt/validation | `[待实现]` | `[待实现]` |  |  | NOT_RUN |

### Identity trace

- Reconciled items（只记录脱敏示例或 hash/count）：`[待实现]`
- Proposer/completeness-review 独立调用与 call count：`[待实现]`
- Knowledge claims answers：`[待实现]`
- Worker claims answers：`[待实现]`
- Reviewer-accepted bindings / fullQuestionClaimIds / full-question coverage / batch count：`[待实现]`
- Sentinel non-visible assertion：`[待实现]`
- Experience exact resolvedQuestion+answerObject+items / Knowledge-Workspace-MCP current resupport / historical non-resolvable block：`[待实现]`

Gate B 结论：NOT_RUN

## Gate C — v4 artifact 与 span

### Version/hardcode inventory

| 文件/位置 | 改动前版本 | 处理（更新/兼容保留/N/A） | 证据 |
| --- | --- | --- | --- |
| chunk contracts/types | v3 | `[待实现]` |  |
| vector index/manifest | v3 | `[待实现]` |  |
| migration/readers | v2/v3 | `[待实现]` |  |
| templates/slicer | v3 | `[待实现]` |  |
| fixtures/tests | v2/v3 | `[待实现]` |  |

### RED/GREEN evidence

| Task | RED 命令/退出码 | GREEN 命令/退出码 | 修改文件 | 状态 |
| --- | --- | --- | --- | --- |
| 10–11 v4 artifact/rebuild | `[待实现]` | `[待实现]` | `[待实现]` | NOT_RUN |
| 12 answer span/Judge | `[待实现]` | `[待实现]` | `[待实现]` | NOT_RUN |

### Rebuild and rollback

- 临时 workspace：`[待实现；只记录是否为 mkdtemp，不记录敏感用户路径]`
- V4 chunk count / unique IDs：`[待实现]`
- Rebuild mode（embedding-enabled / BM25-only）：`[待实现]`
- Generation ID / generation-manifest schema：`[待实现]`
- Active pointer before/after：`[待实现]`
- Strategy / artifact version：`[待实现]`
- Canonical/retrieval hash validation：`[待实现]`
- Vector dimension/completeness：`[待实现]`
- Atomic switch assertion：`[待实现]`
- Publish lock owner / bounded busy assertion：`[待实现]`
- Expected-active before/publish result / loser conflict：`[待实现]`
- Stale-lock explicit recovery assertion：`[待实现]`
- Undersized-unmergeable direct-ineligible assertion：`[待实现]`
- Concurrent reader single-generation assertion：`[待实现]`
- Incomplete generation ignored assertion：`[待实现]`
- Failure rollback assertion：`[待实现]`
- Normal request zero-write assertion：`[待实现]`

Gate C 结论：NOT_RUN

## Cross-Gate 离线验收

环境约束：

- 临时知识目录：NOT_RUN
- Fake model（proposer/completeness/coverage/prompt-safety/presentation 可区分）/embedding/rerank：NOT_RUN
- Reviewer call/batch counts：`[待实现]`
- Network sentinel expected/actual：`0 / [待实现]`
- Poisoned SecretRef/env resolver read count expected/actual：`0 / [待实现]`
- 真实 env secret 读取：必须为 0

| Golden case | 命令 | 退出码 | 关键断言 | 状态 |
| --- | --- | ---: | --- | --- |
| worker steps 两条 Presentation 路径可见 | `[待实现]` |  |  | NOT_RUN |
| supporting rejection 不连坐且无回流 | `[待实现]` |  |  | NOT_RUN |
| proposer 少报/producer 过标均不能伪造完整覆盖 | `[待实现]` |  |  | NOT_RUN |
| 同 item 必要条件 claim 由 fullQuestionClaimIds 强制进入两条 Presentation 路径 | `[待实现]` |  |  | NOT_RUN |
| 当前 Worker/MCP evidence 可 final，raw marker 不入 reviewer payload | `[待实现]` |  |  | NOT_RUN |
| coverage 缺项显示初步判断 | `[待实现]` |  |  | NOT_RUN |
| opaque prompt 夹带事实被拒且 outcome 重冻结 | `[待实现]` |  |  | NOT_RUN |
| anchor/secret/path 全回复安全 | `[待实现]` |  |  | NOT_RUN |
| span 完整或 abstain | `[待实现]` |  |  | NOT_RUN |
| v3/undersized ineligible / validated v4 eligible | `[待实现]` |  |  | NOT_RUN |
| Experience current evidence 不支持/非知识来源无法重验/同 sentinel 不同问题时不可 replay | `[待实现]` |  |  | NOT_RUN |
| 双 publisher 只有一个成功且 rollback CAS 正确 | `[待实现]` |  |  | NOT_RUN |

## 兼容与文档

| 检查 | 命令/证据 | 结果 |
| --- | --- | --- |
| HTTP response shape | `[待实现]` | NOT_RUN |
| Case JSON shape | `[待实现]` | NOT_RUN |
| DiagnosticRequest/Result required fields | `[待实现]` | NOT_RUN |
| Agent registry/config pairing（含三类独立 review seam） | `[待实现]` | NOT_RUN |
| Module boundaries / thin CLI | `[待实现]` | NOT_RUN |
| Architecture and migration docs | `[待实现]` | NOT_RUN |

## 真实 provider / 真实知识目录

默认状态：NOT_RUN（这是中性状态，不是通过）。

唯一验收开关：`SUPER_HELPER_REAL_ACCEPTANCE=1`。未设置时即使环境存在凭据也不得读取或联网。

| 验收 | 授权/开关 | 状态 | 脱敏证据 |
| --- | --- | --- | --- |
| Real model |  | NOT_RUN |  |
| Real embedding/rerank |  | NOT_RUN |  |
| Real knowledge rebuild |  | NOT_RUN |  |

## Anti-Fake-Complete 审计

| 检查 | 命令/方法 | 结果 |
| --- | --- | --- |
| 无 `.only` / 新增 `.skip` / 空断言 | `[待实现]` | NOT_RUN |
| Fixture 未被弱化 | `[待实现]` | NOT_RUN |
| Failure injection 能触发失败 | `[待实现]` | NOT_RUN |
| Production seam mutations（非反转测试断言） | `[待实现]` | NOT_RUN |
| 所有 version hardcode 已归类 | `[待实现]` | NOT_RUN |
| 所有 reply builder 已归类 | `[待实现]` | NOT_RUN |
| 所有 answer-bearing pattern 已归类 | `[待实现]` | NOT_RUN |
| 所有 mustAnswer producer/consumer 已归类 | `[待实现]` | NOT_RUN |
| completeness/coverage/prompt reviewer 无 producer 自证旁路 | `[待实现]` | NOT_RUN |
| fullQuestionClaimIds 未被 production freeze/projection 忽略 | `[待实现]` | NOT_RUN |
| source-neutral coverage materializer 无 raw/stale evidence 旁路 | `[待实现]` | NOT_RUN |
| publisher lock/CAS/undersized eligibility 无旁路 | `[待实现]` | NOT_RUN |
| 独立 reviewer 反向审计 | `[待实现；需包含 reviewer、日期、commit/diff identity、逐项结论、findings/关闭证据]` | NOT_RUN |

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
| `openspec status --change fix-answer-fidelity-and-retrieval-quality` |  | NOT_RUN |
| `openspec validate fix-answer-fidelity-and-retrieval-quality --strict` |  | NOT_RUN |
| `pnpm lint` |  | NOT_RUN |
| `pnpm typecheck` |  | NOT_RUN |
| `pnpm build` |  | NOT_RUN |
| `pnpm test` |  | NOT_RUN |
| `pnpm acceptance:knowledge:local` |  | NOT_RUN |
| Gate A/B/C focused suites |  | NOT_RUN |
| Cross-gate offline acceptance |  | NOT_RUN |
| `git diff --check` |  | NOT_RUN |

## 偏差与决策

当前无实现偏差。后续任何偏差须记录：

- 原冻结合同；
- 发现的事实；
- 候选方案；
- 选择与风险；
- 同步修改的 proposal/design/spec/tasks；
- 新增 RED/GREEN 证据。

## 最终结论

状态：NOT_RUN。

只有 Success Criteria、Gate A/B/C、cross-gate golden cases、兼容验证、Anti-Fake-Complete 和最终命令全部满足后，才能改为 PASS 并归档 change。
