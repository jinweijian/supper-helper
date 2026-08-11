# fix-answer-fidelity-and-retrieval-quality 设计

## Context

用户的核心问题是“系统拿到了有用内容，但最终回答仍不能解决问题”。现有实现中存在四组可复现的不一致：

1. `result-validator.ts` 以“存在任一 rejected claim”作为结果级降级条件；与此同时，`rag-answerability-service.ts` 按多个 claims 的覆盖并集判断完整性，而 `claimCoversAnswerGoal` 要求单 claim 覆盖全部 `mustAnswerItems`。
2. `presenter.ts` 的 fallback 模板不会渲染真实 `next_action`；`result.summary`、未选 evidence、`unknown`、`missingInfo` 等不同字段又没有经过同一安全投影，导致 rejected 事实或敏感信息可能从侧路重新出现。
3. Preflight model schema 没有稳定保留 `mustAnswerItems`；AnswerGoal 在本地重建/reconcile 后容易回到 `['direct_answer']`。该值只能作为兼容哨兵，不能被误称为真实用户必答项。
4. parent-child chunk 的 heading 已作为 BM25 独立字段参与召回，因此把 heading 再拼进 BM25 body 会重复加权；真正缺少 section context 的是 embedding/rerank 输入。answer span 与 Evidence Judge 还各自维护一套域相关 pattern，造成选择与审核漂移。

本 change 保持统一，因为 AnswerGoal 覆盖、审核冻结、Presentation 和检索 evidence 必须由同一组端到端用例证明“用户最终拿到可执行答案”。为控制风险，实施仍按内部闸门推进，后一闸门不得绕过前一闸门的不变量。

## Constraints

- `DiagnosticRequest.answerGoal` 是用户可见回答目标的唯一权威；`diagnosticObjective` 只服务内部排查，不得进入主答或问题锚点。
- Presentation 只能表达 runtime 冻结的 accepted claims，不能升级 outcome、补写事实或把 `process_note`、`evidence_locator`、`supporting_context` 提升为主结论。
- 每份由 reviewed `DiagnosticResult` 生成的用户 reply 都要通过未审核事实和敏感信息校验，不得只检查首段；Preflight 追问、Case Curator 与 transport/system message 继续走各自现有的安全格式化边界，不伪装成 frozen reviewed reply。
- 无 accepted primary coverage 不得 final；若仍存在相关 accepted fact/inference，fallback 应先给出明确标注的初步判断，而不是用泛化“无法判断”覆盖它。
- 不改变 HTTP response shape、Case JSON shape 或现有 `DiagnosticRequest`/`DiagnosticResult` 字段；新增数据只允许存在于 runtime 内部投影或可重建 artifact。
- runtime 不解析 HTTP DTO；gateway 不做 review/presentation 决策；worker 不直接回复用户或改写 case；agent prompt/config 继续放在 `src/agents/`。
- 请求路径不得自动改写真实知识目录；真实 provider、真实 embedding 和真实知识迁移必须显式 opt-in。

## Goals / Non-Goals

### Goals

- 保证已接受的主答和用户可执行步骤在 model 与 fallback 两条 Presentation 路径都可见。
- 让多个 accepted primary claims 能稳定联合覆盖 `mustAnswerItems`，同时对缺项、冲突和无证据内容保持严格降级。
- 让问题锚点和整个 reply 共享同一事实、安全、脱敏与长度边界。
- 在不重复加权 BM25 heading 的前提下，为 embedding/rerank 补充 section context，并让多步骤摘录“完整或 abstain”。
- 用默认离线、确定性、可比较基线和 Anti-Fake-Complete 证据证明改动解决了用户问题。

### Non-Goals

- 不改变 Experience → Knowledge → MCP → Worker 的来源顺序。
- 不开放 Presentation model 自由撰写用户回复；model 仍只做冻结 ID 的受限排序。
- 不修改 Experience 阈值、公共路由或持久化 Case schema。
- 不引入新的外部模型、向量数据库、协议或凭据类型。
- 不在本 change 中执行真实生产知识目录迁移；只实现并验证显式、安全、可回滚的迁移路径。

## Contract Freeze

### Terminology

- **compatibility sentinel**：`DIRECT_ANSWER_ITEM`/`direct_answer`。只在 model 分解不可用时维持旧行为，不是用户可见问题分解，不得显示给用户。
- **claim-local rejection**：错误可完全归因于单个 claim，删除该 claim 后其余结果仍可独立验证。
- **result-global blocker**：会破坏整个结果的覆盖、一致性、身份完整性或用户可见安全边界。
- **reviewed selection**：从 validated result 得到的 runtime-only accepted IDs、coverage、candidate outcome 与结构化 blocker 集合。
- **safe frozen answer projection**：将 reviewed selection 物化、统一脱敏并完成必要降级后的唯一用户可见内容集合。它不是公共 API，也不写入 Case JSON。
- **canonical text**：知识 child 的纯正文 `text`，用于 provenance、answer span 和 BM25 body。
- **retrieval text**：由 section path + canonical text 确定性派生的 `retrieval_text`，仅用于 embedding/rerank。

### Reviewed selection and safe frozen projection

Review 与 Presentation 之间固定为两阶段合同：

1. validated result → reviewed selection；
2. reviewed selection → safe frozen answer projection。

安全物化后的内部投影至少包含：

```ts
interface SafeVisibleClaimSegment {
  claimId: string;
  type: "fact" | "inference" | "assumption" | "unknown";
  role: "primary_answer" | "supporting_context" | "next_action" | "unknown";
  text: string;
  evidenceIds: string[];
}

interface SafeVisiblePromptSegment {
  kind: "unknown" | "missing_info";
  text: string;
  source: "accepted_unknown_claim" | "validated_missing_info";
  review: "accepted_non_factual_prompt";
}

interface SafeVisibleEvidenceSegment {
  evidenceId: string;
  text: string;
  claimIds: string[];
}

interface SafeFrozenAnswerProjection {
  outcome: "ask_user" | "partial" | "final" | "escalate";
  answerTarget: string;
  primary: SafeVisibleClaimSegment[];
  preliminary: SafeVisibleClaimSegment[];
  actionable: SafeVisibleClaimSegment[];
  supporting: SafeVisibleClaimSegment[];
  requiredVisibleClaimIds: string[];
  evidence: SafeVisibleEvidenceSegment[];
  prompts: SafeVisiblePromptSegment[];
}
```

该结构只说明语义，不要求公开或持久化同名类型。实现可以拆分为多个 runtime 内部对象，但必须保持同样的不变量。最终 renderer 的生产签名只能接收 safe frozen projection、persona 和受限 layout plan，不得接收 `DiagnosticResult`、全量 claims、summary、全量 evidence 或 worker trace。

## Decisions

### D1：局部拒绝与全局阻断分离，审核只保持或降级

以下错误属于 claim-local rejection：

- 单个 fact 引用不存在、低置信或空 evidence；
- 单个 claim 缺少合法 `role`/`answers`；
- 单个 claim 的类型、evidence 引用或文本违反 claim contract，且不影响其他 claim 身份。

以下情况属于 result-global blocker：

- accepted primary coverage 无法覆盖全部 `mustAnswerItems`；
- 上游 Evidence Review 已产生结构化、显式的 conflict blocker（例如 Knowledge Evidence Judge 的 `conflicts`/`conflicting_knowledge`），且该 blocker 尚未解决；
- evidence/claim ID 不唯一或结果级结构损坏，无法确定引用身份；
- 任一必显内容不能通过整份回复的安全/未审核事实校验；
- worker result 本身要求 escalate，或存在不能通过补充用户信息解决的安全/完整性阻断。

局部 claim 被删除后重新计算覆盖。局部拒绝本身不自动降级；但它若导致覆盖缺失，则覆盖缺失成为全局阻断。`result-validator` 不得用自然语言关键词猜测两条 claim 是否矛盾；本 change 只消费上游已有的结构化 conflict signal，并通过 runtime-only review context（blocker code、受影响 evidence identity 和来源阶段）传递，不新增 `DiagnosticResult` 公共字段。缺少结构化 conflict signal 时不允许为测试硬编码文本冲突规则。

审核 outcome 规则固定为：

1. 先把 worker status/recommendation 映射成现有 candidate outcome；审核不得把 candidate `partial`、`ask_user` 或 `escalate` 提升为 final。
2. candidate 已是 `escalate`，或存在不能靠用户补充解决的安全/结果身份 blocker 时，冻结为 escalate；该规则优先于普通 `missingInfo`。
3. candidate 为 `ask_user` 时，有已验证且用户可安全补充的 `missingInfo` 则保持 ask_user；问题字段无效时降为 partial，不得升为 final。
4. candidate 为 `partial` 时保持 partial，除非第 2 条要求 escalation。
5. candidate 为 `final` 时，只有主答覆盖完整且没有 result-global blocker 才保持 final；否则有已验证且用户可补充的 `missingInfo` 则降为 ask_user，其余降为 partial（第 2 条已先处理 escalation）。

这使 validation 成为“ceiling-preserving”：只能保留或降低上游 outcome，不能借清洗结果反向升级。

### D2：主答采用稳定联合覆盖，不再要求单 claim 全覆盖

`mustAnswerItems` 使用确定性规范化后的精确字符串作为 coverage ID，但 producer 的 `claim.answers` 只是候选覆盖声明，不能单独授予 coverage。Runtime 通过现有 `evidence-coverage` model-assisted agent seam 发起与 producer 输出分离的 bounded batch review，并生成 runtime-only `AnswerCoverageReview`：

- 每个 reviewed turn 至多调用一次；输入安全规范化的完整 `answerGoal.resolvedQuestion`、全部 must-answer items，以及下述 source-neutral runtime segments；不得直接传 `DiagnosticResult`、raw `Evidence.summary/source`、provider payload、trace、完整 `retrieval_text` 或全量未选 evidence；
- 对每个 claim→item binding 独立判断是否由 claim 文本与 evidence 支持；
- 同时判断哪些 candidate primary claims 必须共同出现才能回答完整 `resolvedQuestion`，而不仅是 producer 声明的 item 集合；
- 输出 reviewed bindings、`fullQuestionClaimIds`、`full|partial|none|unknown`、bounded missing elements 和 reason codes；`fullQuestionClaimIds` 必须是输入中由 reviewer 判定受直接 evidence 支持的 primary fact/inference IDs，且 `full` 时必须非空；
- reviewer 不可用、输出 malformed/unknown 或存在未覆盖问题要素时，一律不能 final。

跨来源 reviewer 输入固定为 runtime-only 结构，不复用或修改公共 `Evidence` shape：

```ts
interface CoverageClaimSegment {
  claimId: string;
  type: "fact" | "inference" | "assumption" | "unknown";
  role: "primary_answer" | "supporting_context" | "next_action" | "unknown";
  candidateAnswers: string[];
  text: string;
  evidenceIds: string[];
}

interface CoverageEvidenceSegment {
  evidenceId: string;
  kind: "workspace" | "mcp" | "manual" | "knowledge" | "log";
  text: string;
  freshness:
    | "current_knowledge_v4"
    | "current_worker_run"
    | "current_mcp_call"
    | "current_user_message"
    | "current_log_excerpt"
    | "revalidated_current_source";
}
```

materializer 只接收当前 claim 直接绑定且已通过既有 evidence validation 的内容，先做 Unicode/空白规范化、secret/path/internal-source redaction，再生成最多 20 个 claim segments、40 个去重 evidence segments；claim/evidence 每项最多 1000 Unicode code points，review payload 总文本最多 24,000 code points。不得按字符截断语义单元；任一 final-required claim/evidence 超界、清洗为空、freshness 无法证明或超过总预算时不给 coverage 并阻断 final。模型只看到稳定 ID、kind/freshness enum 和安全文本，不看到 raw source locator。

来源资格固定为：

- `knowledge`：只接受当前请求固定的 active v4 generation 中 strict-eligible、非 `undersized_unmergeable` 的 canonical answer span；
- `workspace`：当前 Worker run 新产生并已验证的 bounded evidence 可标 `current_worker_run`；Experience replay 必须通过 workspace read-only resolver port 以既有结构化 source identity 重新读取当前内容，否则 direct-ineligible；
- `mcp`：当前 turn 的 allowlisted read-only call 经 normalizer/evidence-envelope 验证后可标 `current_mcp_call`；Experience replay 只有在既有结构化 selector/arguments 足以通过同一 allowlist 与 read-only MCP resolver 重新执行并重新归一化时才可标 `revalidated_current_source`，否则 direct-ineligible；
- `manual`：只有直接绑定当前 `sourceMessageIds` 的用户原文安全片段可标 `current_user_message`；历史 manual evidence 不可 direct replay；
- `log`：只有当前 run 内经结构化选择、脱敏和边界校验的 excerpt 可标 `current_log_excerpt`；历史日志不可 direct replay；
- `history` 与 `unknown` 永不生成 `CoverageEvidenceSegment`，只能作 investigation context。

`src/agents/evidence-coverage.md` 与 `registry.json` 负责该 non-user-facing reviewer 的 model contract/config；`src/runtime/answer-coverage-review-service.ts`（或等价 runtime service）负责批处理上限、schema 校验、失败降级和结果归一化。Knowledge、RAG Answerability、Worker、MCP、Experience/Experience replay 必须进入同一 coverage-review contract。不得直接信任 producer 自报的 `answers`，也不得由 producer 与 reviewer 共用同一次 model 输出。

eligible primary 仅包括：

- 已 accepted；
- `role=primary_answer`；
- claim 类型为 `fact` 或 `inference`；
- `answers` 至少声明一个当前 `mustAnswerItems`，且 independent `AnswerCoverageReview` 接受对应 claim→item binding。

冻结算法保持原始 claim 顺序：

1. `uncovered = mustAnswerItems`。
2. 顺序遍历 eligible primary；当 reviewed binding 覆盖至少一个尚未覆盖 item 时，将其加入 `primaryClaimIds` 并移除对应 `uncovered`。
3. 将 reviewer 返回的合法 `fullQuestionClaimIds` 合入 `primaryClaimIds`，按原始 claim 顺序稳定去重；这允许一个不新增 item 的 primary claim 在确实补足同一 item 内的条件、时效或限制时成为必显主答。
4. `uncovered` 为空才算 item coverage 完整；`primaryClaimIds` 是稳定、可复现的 greedy item-cover set 与 reviewer-required full-question set 的并集。
5. 既不增加 reviewed item coverage、也不在合法 `fullQuestionClaimIds` 中的冗余 primary claim 不进入直接回答集合，可按 supporting 规则处理；model 的 `directAnswerClaimIds` 必须与 frozen `primaryClaimIds` 完全一致（顺序可按 contract 固定，集合比较前先稳定去重）。
6. `uncovered` 为空仍不是 final 的充分条件；`AnswerCoverageReview` 还必须对完整 `resolvedQuestion` 返回 `full`、`missingElements=[]`，且所有合法 `fullQuestionClaimIds` 都已进入 `primaryClaimIds`。unknown ID、非 primary role、unsupported evidence 或空的 full set 都使 review malformed 并阻断 final。

RAG Answerability、Knowledge/MCP/Experience/Worker claim producer、result validator、review gate 与 Presentation 必须使用相同 item 字符串；所有 source 的最终 coverage 都以 reviewed bindings 和 full-question review 为准。禁止一处求并集、另一处要求单 claim 全覆盖，也禁止 producer 自报 item 后直接视为已覆盖。

兼容回退时 `mustAnswerItems=[DIRECT_ANSWER_ITEM]`，所有旧 producer 可继续声明该哨兵，但 final 仍必须通过对完整 `resolvedQuestion` 的 independent `AnswerCoverageReview`；哨兵不进入用户可见文本。

### D3：Presentation 前安全物化唯一的用户可见投影

Review Gate 先从 validated result 派生 ID selection，再由安全投影模块物化文本：

- `answerTarget`：仅从可信的 `answerGoal.resolvedQuestion` 派生。
- `primaryClaimIds`：D2 的稳定覆盖集合。
- `preliminaryClaimIds`：非 final 时，先选择 accepted、`role=primary_answer`、类型为 fact/inference 且至少有一个 reviewer-accepted binding 指向当前必答项的 claim；若没有相关 primary，仍保留有 reviewer-accepted binding 的 `supporting_context` fact/inference。supporting fact 标为“已确认线索”，supporting inference 标为“推断线索”；两者都不得放入 direct-answer IDs、计入 primary coverage 或样式化为主/最终结论。稳定顺序，合计最多 3 条；`process_note`、`evidence_locator` 和 `unknown` 永不进入该集合。
- `actionableClaimIds`：accepted `next_action` 且至少有一个 reviewer-accepted binding 指向当前必答项；兼容哨兵路径仍须通过完整 `resolvedQuestion` 的 action relevance review；稳定去重，最多 5 条。
- `supportingClaimIds`：accepted supporting fact/inference 且至少有一个 reviewer-accepted binding 指向当前必答项；稳定去重，最多 3 条。
- `requiredVisibleClaimIds`：冻结的 primary/preliminary、actionable 和已通过安全投影预检的 supporting 集合的稳定并集。
- `evidence`：只取上述 selected claims 直接引用且已验证的 evidence，物化为有界脱敏 excerpt/summary + evidence ID + bound claim IDs；不得从 result 全量 evidence 或 summary 推断。renderer 不得按 ID 回查 raw evidence。
- `prompts`：`unknown` 只来自 accepted `role=unknown` claim；`missing_info` 只来自通过形状、安全和长度校验的 `DiagnosticResult.missingInfo`。此外，独立的 non-user-facing `VisiblePromptSafetyReview` 必须确认经确定性 secret/path 清洗后的候选字符串只表达未知/请求，不夹带未审核的原因、影响、状态或已执行动作；它只做 accept/reject，不重写文本。review unavailable/malformed/unknown/拒绝时该字符串不可见，若因此没有可用 ask-user prompt 则按 D1 重新冻结为 partial/escalate。每个可见 prompt 都带 source 与 `accepted_non_factual_prompt` review provenance。

`VisiblePromptSafetyReview` 的执行边界冻结为：`src/runtime/visible-prompt-safety-review-service.ts`（或等价 runtime service）通过新登记的 `src/agents/visible-prompt-safety.md` model-assisted agent seam，每个 turn 最多发起一次批量调用；输入仅含安全化的 `resolvedQuestion`、最多 10 个稳定 candidate ID/source/text（`unknown` 与 `missingInfo` 各最多 5 个、每项最多 300 code points），不含 raw result、summary、evidence、trace 或未脱敏 secret/path；输出仅为每个 ID 的 `accept|reject|unknown` 与 bounded reason code。schema 失败、超时、provider 失败或缺少任一 ID 的决定时，该批未获明确 accept 的 prompt 全部不可见。不得以自然语言关键词或 source kind 代替此语义审核。

超过上限的 claim 不进入投影，并记录数量型审计事件，不记录敏感原文。用户可见文本边界固定为：primary/preliminary/actionable claim 每条最多 1000 Unicode code points，supporting claim 每条最多 600，`unknown`/`missingInfo` 各最多 5 条且每条最多 300，固定 generic guidance 最多 300。renderer 不得按字符截断 claim：超过边界的 required primary/actionable 在冻结前成为明确 blocker；超过边界的 supporting/unknown/missingInfo 被排除并记录 reason，若因此失去可用 ask-user 问题则按 D1 状态表落 partial。配置 key/value、命令、编号步骤、否定词和授权状态必须保持语义原子性。

安全物化控制流固定为：

1. validated result 生成 candidate IDs/outcome；
2. candidate required segments 执行 D5 安全投影；
3. required primary/actionable 无法安全物化时加入 result-global blocker，并按 D1 状态表重新冻结一次 outcome/selection；
4. 物化最终安全 segments 与 prompts；
5. renderer 只接收不可变的 safe frozen projection。

`result.summary` 仅保留为输入审计信息，不能直接成为用户主答、fallback 结论或 evidence 选择来源。rejected/unselected claim、未绑定 evidence 与 raw `DiagnosticResult` 对 renderer 不可达。

若不存在安全的 actionable claim，renderer 可以追加明确标为“通用建议”的无事实操作模板；该模板不得暗示已经诊断出原因，也不得包含写操作。

### D4：model plan 只排序冻结投影，失败矩阵明确

Presentation model 不拥有 `answerTarget`、outcome、required claims 或 evidence 边界。它只能基于 safe projection 返回允许的 section 顺序和非顺序性 supporting ID 顺序；frozen primary sequence 与 actionable sequence 不可重排。任何自由文本均非权威并被忽略。runtime 对 plan 先做稳定去重，再按下表处理：

| 违规 | 处理 |
| --- | --- |
| JSON/数组/字段类型错误 | 致命，使用 deterministic fallback |
| `directAnswerClaimIds` 含未知 ID、缺少 frozen primary 或集合不相等 | 致命，使用 fallback |
| `claimIds` 缺少任一 `requiredVisibleClaimId` | 致命，使用 fallback |
| 可选位置出现未知 accepted claim ID | 删除该 ID，继续复验 |
| 选择 `process_note` 或 `evidence_locator` | 删除该 ID，继续复验 |
| 重复 claim/evidence ID | 稳定去重后重新验证 |
| 额外、未被 selected claim 引用的 evidence | 删除该 evidence |
| selected factual claim 所需的 frozen evidence 缺失或未知 | 致命，使用 fallback |
| 清洗后没有可用 claim | 致命，使用 fallback |

“清洗只删不增”适用于 model plan；runtime 预先冻结的 required projection 不是从 model plan 补入的。只要 model 遗漏 required 内容，就直接 fallback，由 fallback 完整渲染同一 frozen projection。

### D5：整份回复共享一个安全投影与结构化事实边界

新增/抽取纯 runtime 模块（建议 `presentation-projection.ts` 与 `presentation-redaction.ts`），`presenter.ts` 只负责编排格式与 persona 标签。以下所有用户可见字段必须逐项经过同一管线：

- 问题锚点；
- primary/preliminary/supporting claim；
- `next_action`；
- `unknown`；
- `missingInfo`；
- 通用建议和安全 connective text。

固定处理顺序：

1. Unicode/空白规范化；
2. secret/token/credential 形态屏蔽；
3. 绝对路径中段和内部 knowledge source 屏蔽；
4. 单项数量/长度限制；
5. 对 bounded unknown/missing-info candidates 执行 D3 的单次批量 `VisiblePromptSafetyReview`；
6. 对 claim segments 做不改变事实的 persona 简化并物化安全 segments；accepted prompt text 本身不得被 persona 重写，只能放进封闭的追问标签/结构模板；
7. 拼装整份 reply；
8. 结构化校验每个 factual/action segment 都能反向映射到 safe projection 中的 accepted claim ID，且每个 evidence identity 直接绑定该 claim；每个 unknown/missing-info segment 都有 accepted non-factual prompt review；
9. 对整份 reply 做 secret、内部 trace/provider payload 与路径最终扫描。

可保留配置 key、普通文件名、接口名、错误类型名、用户可操作的设置名/页面名；但若它们本身命中 secret 形态或属于内部知识源，安全规则优先。绝对路径只可保留安全文件名，不保留用户目录或内部目录层级。

persona 适配不得改变 claim 的因果、肯否、数值、操作对象或执行状态。安全 connective text 仅限封闭模板集中的标签和结构词，例如“针对你的问题”“初步判断”“下一步”“仍需确认”；不得加入原因、影响、恢复方法或声称动作已执行。由于 model 不写自由回复且 renderer 不接收 raw result，“未审核事实”由 segment provenance/claim ID 结构化保证，不依赖不可复现的自然语言事实扫描；最终全文扫描只承担可确定的 secret/path/trace/provider-payload 检测。

任一必显项无法安全投影时，视为 result-global blocker 并降级；不得只删除关键主答后仍声称 final。

### D6：问题锚点由 runtime 派生，model 值不可信

对 reviewed `DiagnosticResult` 的 Presentation，`answerTarget` 只从 `answerGoal.resolvedQuestion` 派生：

- 折叠空白和控制字符；
- 先走 D5 的 secret/路径处理；
- 最多保留 160 个 Unicode code points；
- 不得包含 `diagnosticObjective`；
- 若清洗后为空，使用不带事实的固定短句“针对你当前的问题”。

model 返回的同名字段不参与渲染；如为兼容而接收，只能以长度/哈希形式进入审计。model 与 fallback 两条 reviewed-result 路径都由 renderer 在首段使用同一 anchor。Preflight follow-up、Case Curator 与 transport/system errors 不依赖 Review projection，也不在此强制 anchor 范围内。

### D7：Preflight 产生有界必答项，reconcile 不覆盖

model-assisted Preflight 可选返回 `mustAnswerItems`。确定性 reconcile 规则：

1. 输入必须是数组，原始数量为 1–5。
2. 每项必须是字符串；trim、折叠内部空白后长度为 1–80 Unicode code points，不含控制字符或 secret-shaped 内容。
3. 每个规范化 item 必须是规范化本地 `resolvedQuestion` 的连续子串；这条保守 scope proof 防止形状合法但模型凭空新增工具路由、排查过程或无关目标。不能证明连续来源时整个集合回退 sentinel，不做自然语言语义猜测。
4. 按首次出现稳定去重；去重后仍至少 1 项。
5. 独立的 runtime-only `AnswerGoalCompletenessReview` 必须比较完整 `resolvedQuestion` 与 proposed item set，确认所有用户答案义务均被代表且 `missingElements=[]`；该 reviewer 不得与 item proposer 共用同一次输出。reviewer unavailable/malformed/unknown、少报任一子问题或报告 missing element 时整个集合回退 sentinel。
6. 数组类型错误、超上限、任一元素非法/越界、去重后为空或 completeness review 不通过时，**整个集合**回退 `[DIRECT_ANSWER_ITEM]`，不部分采纳。
7. input-review prompt 同时要求 item 是 `resolvedQuestion` 的用户可见子目标，不能写排查过程、工具路由或 `diagnosticObjective`；prompt 约束不能替代第 3 条 scope proof 与第 5 条独立完整性 review。
8. `rawUserQuestion`、`resolvedQuestion`、`answerObject` 和 source message identities 仍由本地构建；model 无权改写。
9. reconcile 后的 AnswerGoal 只构造一次或显式携带 accepted items，后续 request builder 不得重新生成默认值覆盖它。

执行 seam 固定为：proposer 继续使用现有 Preflight `input-review` 调用；只有 proposed set 通过本地 shape/scope 校验后，`src/runtime/answer-goal-completeness-review-service.ts`（或等价 runtime service）才通过新登记的 `src/agents/answer-goal-completeness.md` 发起一次独立 model call。该调用只接收安全规范化的 `resolvedQuestion` 与 proposed items，输出 `complete|incomplete|unknown`、最多 5 个 bounded `missingElements` 和 reason code，不接收 proposer rationale，也不产生用户文本。runtime 校验 schema 并执行 whole-set fallback；不得把同一次 Preflight 输出中的自评字段当作独立审核。

记录结构化事件时只记录来源（model/fallback）、数量、是否回退和 reason code；不记录 secret 或完整用户问题。

### D8：Experience 只复用结构化已审核 claims

Experience direct replay 不得把历史 assistant reply body 或 `DiagnosticResult.summary` 包装成一个新的 `primary_answer`，也不得直接声明覆盖当前全部 must-answer items。可保持 final eligibility 的 replay 必须同时满足：

- source run 仍有结构化 `DiagnosticRequest.answerGoal`、`DiagnosticResult.claims/evidence` 与合法 role/answers；
- source result 使用当前 deterministic validator 重新验证；
- source 与 current 的规范化 `resolvedQuestion`、`answerObject` 和 `mustAnswerItems` 分别完全一致，不做自然语言 alias 映射；两者都使用 compatibility sentinel 只满足 item identity，不能替代 resolvedQuestion/answerObject 一致性；
- 只复用 source run 中重新 accepted 的结构化 claims 及其直接绑定 evidence，并保留 fact/inference/role；
- 来自 knowledge 的 evidence 必须通过 retrieval port 在当前 active v4 generation 重新解析 source/evidence identity并重新确认 eligibility；随后用“历史 claim 文本 + 当前重新解析的 canonical evidence”重新执行 independent claim-support/AnswerCoverageReview。不得为此向 Case JSON 新增 generation 字段。相同 identity 的内容/hash 已变化且不再支持历史 claim、无法重新解析、artifact provenance 缺失、v3 或 rebuild-required时只能作 investigation context。
- 来自 workspace/MCP 的历史 evidence 必须按 D2 通过对应 read-only resolver port 重新取得当前安全内容并重新审核；既有 Case 数据不足以构造结构化 current resolver 时直接降为 investigation-only。历史 `manual`/`log`/`history`/`unknown` evidence 一律不能授予 replay coverage。

旧历史回复、缺少 role/answers 的 source claim、无法证明 artifact provenance 的经验仍可帮助检索或升级 Worker，但不能成为 frozen primary/direct answer。该限制不改变 Case JSON shape；runtime 从现有 source run 数据重算 eligibility，并只传安全结构化结果进入 D3。

### D9：parent-child v4 分离 canonical text 与 retrieval text

v4 child artifact 语义固定为：

- `chunking_strategy = parent-child-v4`；
- child `artifact_version = 4`；`KnowledgeIndexManifest.version` 与 `KnowledgeVectorManifest.version` 仍表示各自 schema version，未改变 schema 时保持 1，不得被批量改成 4；
- `text`：canonical body，不含派生 heading prefix；
- `section_path`：原始规范化标题路径；
- `retrieval_text`：`bounded(section_path.join(" > "), 240) + "\n" + text`；section path 为空时等于 `text`；
- `text_hash`：保留现有字段名，但语义是 child identity hash，对 canonical text、section path、source block IDs、child order 和 chunking strategy 的稳定序列化计算，不得误称为“仅正文 hash”；
- `retrieval_text_hash`：对 `retrieval_text` 计算，用于 embedding/vector compatibility。

读写类型可以把 v4 新字段声明为 optional 以读取旧 JSONL，但 v4 writer 必须完整写出。下游使用规则：

- BM25：继续使用独立 heading field + canonical `text`，不得把 `retrieval_text` 再放进 body；
- embedding 和 rerank：使用 `retrieval_text`；
- answer span、excerpt、evidence 展示和 provenance：只使用 canonical `text`；
- Evidence Pack、Case JSON、日志和 Presentation：不得携带完整 `retrieval_text`，只允许现有 `section_path` 与 bounded canonical span/excerpt。

`minChars` 收敛规则：

- 同 section 尾 child 小于最小值时，优先与前一 sibling 合并；
- 若合并超过 `maxChars`，在同 section 的句子/Markdown block 边界重平衡，尽量让两侧均满足范围；
- 不跨 section、不截断 source block provenance；
- section 内只有一个不可再拆/合并的小 child 时保留，并记录 artifact health reason，而不是伪造或丢弃内容。
- 任何仍小于 `minChars` 且无法安全合并/重平衡的 child（包括孤立 child 与尾 child）必须标记 `undersized_unmergeable` 并仅可用于 investigation；不得仅因 artifact version 为 v4 就获得 strict direct-answer eligibility。

### D10：v3 只读兼容，v4 generation 指针式原子发布

- 任何 strategy/version 不是当前 v4 的 child，即使持久化了 `legacy:false`，reader 也必须计算为 `legacy=true`。
- legacy child 可用于调查性召回和运维诊断，但严格 direct-answer eligibility 始终为 false，并产生 `rebuild_required` health/trace reason。
- 请求路径不自动 rebuild、不写真实用户目录。
- generation 布局固定为 `knowledge/indexes/generations/<generation-id>/`，其中保存该代 chunks、keyword/BM25 index、index manifest、vectors、vector manifest/build report 和 `generation-manifest.json`。generation manifest schema 从 1 起，显式记录 generation ID、`chunkArtifactVersion=4`、strategy、mode、各文件 hash、previous generation 与完成状态。
- 显式 rebuild 由 application 用例编排并在开始时记录 `expectedActiveGenerationId`；knowledge 模块负责 generation 构建/校验并提供 knowledge-owned publisher port/文件适配器，provider adapter 通过既有 port 注入。application 不直接操作 lock、manifest 或 pointer 文件。
- knowledge generation publisher adapter 以原子创建 `knowledge/indexes/publish.lock`（或等价跨进程排他原语）获得单 writer 权限；未获得者 bounded fail/busy，不得并发覆盖。持锁后重新读取 `active.json`，只有它仍等于 candidate 的 `expectedActiveGenerationId` 才写入 final generation manifest 的 `previousGenerationId`、将目录标为不可变 complete 并发布；否则以 `generation_conflict` 失败，candidate 保持 inactive，由 application 决定是否显式重试。
- 发布只原子替换 `knowledge/indexes/active.json` 指针：先在同目录写临时指针并 flush/fsync，再 rename；reader 每个请求只解析一次 active generation 并在整个请求中固定使用它。并发 reader 已解析的旧 generation 可继续完成，不会看到混合代际。publisher 在 finally 释放自己持有的 lock；崩溃残留 lock 只能由验证 owner/进程/age 的显式恢复用例处理，普通请求不得偷锁。
- 旧平面 `knowledge/indexes/*.json*` 被识别为 legacy flat generation，可读但 strict-ineligible。崩溃留下的 incomplete generation 不被 active pointer 引用，健康检查报告并由显式维护清理。
- rebuild manifest 必须声明配置模式。embedding 明确禁用时，经过完整校验的 v4 BM25-only artifact set 可以原子发布；embedding 已启用/被请求时，任一 vector 缺失或不兼容都使整个 rebuild 失败并保留旧 artifact。不得把“不完整 vector + 新 chunks/BM25”作为成功发布，也不得混用 v3/v4 vector。
- 现有 v3 parent frontmatter 仍可作为 canonical source 被 v4 builder 读取；child artifact manifest 是 direct-answer eligibility 的权威。新发布/重新切片的 parent 写 v4 marker，旧 parent marker 通过显式 migration/republish 渐进更新，不在读取时改写。

回滚由 application 用例编排，knowledge publisher adapter 同样必须获取 publish lock，并用 expected-active CAS 确认当前 generation 后，才把 `active.json` 原子切回 generation manifest 中的 previous validated generation；至少保留当前与前一完整 generation。不得把“重新运行成功”作为唯一回滚方案。

### D11：answer span 完整或 abstain，Evidence Judge 不重复做域分类

`selectAnswerSpan` 只在 canonical text 上工作，使用查询 token 覆盖、段落边界、编号/列表连续性、条件/能力/动作等通用结构信号评分，不包含学员、教师、课程等业务域名词。

输出必须满足：

- 连续 1–3 个完整句子，或语义等价的连续 Markdown 语句单元；
- 最多 500 Unicode code points；
- 是 canonical text 的可定位连续片段；
- 多步骤说明只有在所有必需步骤都能完整落入边界时才返回。

若完整说明需要超过 3 个语句单元或 500 字符，函数返回 `undefined`，candidate 只作 investigation context；不得截断后伪装成完整 answer span。无匹配同样返回 `undefined`。

Evidence Judge 删除第二套业务域 `ANSWER_BEARING_PATTERNS`。它只验证：

- answer span 是否存在并来自 canonical evidence；
- evidence/claim 引用、完整性、置信度与 AnswerGoal coverage；
- 超界、截断或不存在 span 时阻止严格直答。

标题 prefix 不得被单独选作 answer span。

### D12：worker 必须把可执行内容放进结构化 claim

Claude worker prompt 与 contract tests要求：

- 用户可执行的排查/修复步骤使用 `role=next_action`；
- `answers` 至少引用一个相关 `mustAnswerItems`（兼容路径可引用 sentinel）；
- 事实性步骤引用 accepted evidence；假设、未知和待确认内容显式区分；
- summary/process note 不能成为步骤的唯一载体；
- 没有安全、证据支持的 action 时不虚构；
- 删除、覆盖、部署、写配置等需授权动作只作为“待人工确认/执行”的建议，不得声称已经执行，也不得由 read-oriented worker 擅自执行。

### D13：验收以离线基线和用户可见 golden case 为准

默认验收环境：

- 使用 `mkdtemp` 临时知识 workspace；
- 通过生产 composition/factory 的正式依赖注入点使用 fake model/embedding/rerank provider，不允许改走只供测试的平行实现；
- 注入“有值但禁止读取”的 poisoned SecretRef/env resolver，secret resolver read count 必须为 0；
- 网络 sentinel 期望调用数为 0；
- 不读取真实凭据，不写用户真实知识目录；
- 固定使用 `test/fixtures/retrieval/production-eval-50.json` 记录 before/after。

同一固定 fixture 上，Recall@5、MRR、direct precision、no-hit abstention、must-escalate 均不得低于改动前基线；新增多步骤完整性、域外文本、501 字符、四步骤不可完整容纳、Markdown 列表、无匹配、heading 不得成为 span 等定向用例必须全部通过。

端到端 golden cases 至少覆盖：

1. worker 主答 + 配置 key + `next_action` 在 model/fallback 两路径均出现；
2. 一个 supporting claim 被拒，但联合 primary coverage 完整时保持 final；
3. primary coverage 缺项时不得 final，相关 accepted inference 以“初步判断”显示；
4. rejected fact 不能从 summary、unknown、missingInfo、evidence 或后续段落泄漏；
5. anchor、路径、secret、内部 knowledge source 在整份回复中安全；
6. v3 readable-but-ineligible，v4 原子 rebuild 成功/失败回滚；
7. 多步骤 span 完整或 abstain，不输出截断伪答案。

真实 provider/真实知识库验收只能由唯一具名开关 `SUPER_HELPER_REAL_ACCEPTANCE=1` 触发，并单独记录 `PASS`、`FAIL` 或 `NOT_RUN`；没有该开关时，即使环境中存在真实凭据，acceptance harness 也不得读取或联网。用户明确要求真实端到端验收后，harness 必须走正式 `/api/chat`、会话持久化、runtime、真实 worker/provider、独立 review 与 Presentation 路径，验证多项 AnswerGoal 覆盖、代码证据、整份回复安全和 reviewed `final_answer`，并在 finally 删除验收 case、关闭临时 server。`NOT_RUN`、partial 或知识质量 gate 失败均不能记为完成证据。该 gate 只约束验收命令，不改变用户正常配置下的生产 provider 行为。

## Module Ownership

- `src/runtime/`：AnswerGoal reconcile、source-neutral coverage segments/freshness 判定编排、review outcome、frozen projection、Presentation plan validation、最终安全扫描；只通过 port 请求当前来源重验。
- `src/application/`：显式 knowledge rebuild/publish/rollback 用例编排、generation lifecycle decision 和 provider port 协调；不直接操作 artifact 文件、lock、manifest 或 pointer。
- `src/agents/`：input-review、`answer-goal-completeness`、`evidence-coverage`、`visible-prompt-safety` 与 presentation 的 model contract/config，并与 `registry.json` 配对；这些 reviewer 不产生用户可见文本。
- `src/workers/`：worker adapter prompt、结构化输出映射及 workspace current-evidence read-only resolver adapter；不直接回复用户。
- `src/mcp/`：按既有 allowlist/permission 执行当前 read-only MCP call，并在结构化 selector 仍可用时提供 replay revalidation adapter；不决定 coverage/outcome。
- `src/knowledge/`：v4 chunk/artifact generation 的构建、读取、兼容、校验，以及 knowledge-owned generation publisher port/文件适配器（lock、manifest、pointer、rollback 原语）；不拥有跨模块用例入口。
- `src/retrieval/`：BM25/embedding/rerank 输入、answer-span 与 evidence mapping。
- `src/observability/`：只转换和展示结构化 reason/count，不决定审核或迁移流程。
- `src/gateway/`：保持 DTO/序列化，不新增业务决策。
- `src/cli.ts` / CLI command：保持薄入口，只解析参数并调用 application 用例；不得自行拼接 artifact 或 provider。

若 `presenter.ts` 继续同时承担选择、脱敏和格式化，应先抽取纯 runtime 模块；只有在 `implementation-notes.md` 中证明文件仍满足边界和可维护性时才允许例外。

## Migration and Delivery Order

1. **Gate A — 回答投影**：先写 RED tests，落 D1–D6；验证局部拒绝、联合覆盖、投影、plan 矩阵、全回复脱敏与两条 Presentation 路径。
2. **Gate B — AnswerGoal**：写 Preflight/reconcile/所有 producer-consumer 与 Experience replay 的 RED tests，落 D7–D8 与 D12；保证 exact item identity、sentinel 兼容和历史结果不伪造覆盖。
3. **Gate C — 知识检索**：记录固定基线，写 artifact/span RED tests，落 D9–D11；在临时目录验证 v3/v4 generation 与原子 pointer publish。
4. **Cross-gate acceptance**：运行 D13 golden cases、全部仓库验证和模块边界检查；把命令、退出码、关键指标写入 `implementation-notes.md`。

每个 gate 只有在对应 RED evidence、GREEN evidence 和兼容性证据齐全后才能标记完成。单个 task 打勾、编译通过或真实 provider 未运行都不足以关闭 change。

## Risks / Trade-offs

- **知识直答减少、worker 升级增加**：真实必答项和完整 span 更严格。接受该成本，以固定基线和升级率事件监控。
- **回复变长**：actionable/supporting 内容有数量和单项长度上限；optional 超限记录 omitted count，required primary/actionable 超限触发显式 blocker，不能静默截断。
- **可执行标识符暴露**：secret/path/internal-source 规则优先；customer 只做不改变事实的简化。
- **v4 双文本增加 artifact 体积**：只存派生短前缀，且不进入 Case/evidence/log；收益是 embedding/rerank 具备主题上下文。
- **model 分解漂移**：本地问题字段不可改写，输出有界且可整体回退；结构化 reason 监控 fallback/升级率。
- **独立审核增加调用与延迟**：must-answer proposer 复用现有 Preflight call，但 completeness review 另有一次独立调用；coverage 与 visible-prompt review 分别按 turn 有界批处理。任一 reviewer 不可用时走 sentinel、非 final 或隐藏 opaque prompt 的保守路径，不以跳过审核换取直答。
- **清洗规则复杂**：用显式 fatal/droppable matrix 和 property-style fixtures 防止“容错”变成越权。

## Resolved Decisions

- span 上限固定为 500 Unicode code points、最多 3 个连续语句单元；不能完整容纳即 abstain，不按 persona 改变。
- `mustAnswerItems` 上限固定 5 项、单项 80 Unicode code points；非法集合整体回退。
- must-answer proposer 复用现有 Preflight model 调用；`AnswerGoalCompletenessReview` 使用独立、non-user-facing 的 `answer-goal-completeness` model call，不能与 proposer 共用输出。确定性 shape/scope 校验、独立完整性结论与 whole-set fallback 共同构成唯一采纳边界；reviewer unavailable/malformed/unknown 时回退 sentinel。
- `AnswerCoverageReview` 统一复用扩展后的 `evidence-coverage` agent seam，并与所有 claim producer 分离；`VisiblePromptSafetyReview` 使用独立登记的 `visible-prompt-safety` agent seam。二者均由 runtime 做有界批处理、schema 校验和保守失败处理。
- 一个 OpenSpec change 内按三个 gate 交付，不再拆分；最终以跨 gate 用户可见验收判定完成。
