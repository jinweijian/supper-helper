## Context

上一轮 `add-layered-knowledge-workspace` 已完成企业知识库 MVP：

- `knowledge:init` 能导入 `/Users/king/Documents/knowledge/` 下两个白皮书 DOCX。
- runtime 已接入 Knowledge Router、Knowledge Search、Evidence Judge、Deep Query Planner、Case Curator。
- 真实检索已经能命中白皮书问题；实现细节和 no-hit 问题能升级到 Claude Code worker。

但它仍是 MVP，不是企业级稳定系统。当前高优先级缺口来自用户对完整技术方案的复盘：

1. 白皮书切割质量仍偏弱，且当前 ingest 基本是一次性解析后直接生成 active slice，缺少 source/block/draft/review/publish 的中间过程，存在空片、目录片、重复片、短片、跨主题片、缺页码 provenance、缺 source block 追溯等风险。
2. 检索体系升级需要单独研究，暂不进入执行。
3. Evidence Judge 仍是规则版，语义覆盖、冲突、时效、版本、风险判断不够强。
4. Deep Query / Query Correction 只生成一次上下文，还没有多轮 retry / pivot 闭环。
5. 真实远程模型和 Claude Code 验收需要形成可重复、安全、不泄露 secret 的验收命令。
6. Case Curator 只能生成草稿，还没有 review / approve / reject / active 流程。

本 change 只做 1/3/4/5/6 的后续规划。待用户审核后，再用 `/opsx:apply harden-knowledge-diagnosis-mvp` 执行。

## Goals / Non-Goals

**Goals:**

- 建立知识加工流水线，将原始文档处理拆为 intake、extract、normalize、draft slice、quality audit、repair、review、publish、index、eval，避免低质量 slice 被默默纳入检索。
- 建立知识切割质量审计、修复计划和质量门禁，支持分步处理、人工审核、重跑和回滚。
- 增强 Evidence Judge 的结构化判断，降低泛词误召回、过期知识、冲突知识和高风险问题导致的误答。
- 建立 Deep Query retry / pivot 闭环，在第一次只读代码调查证据不足时可安全换方向再查。
- 建立真实服务验收命令，覆盖本地配置、远程模型、Claude Code、知识直答、no-hit 升级、实现细节升级。
- 建立 solved case review 工作流，让 `review_required` 草稿经审核后才进入 active 知识库。
- 更新过时文档，反映 knowledge-first runtime 已接入。

**Non-Goals:**

- 不实现 BM25、向量检索、hybrid/RRF、reranker、parent-child rerank 或 GraphRAG。
- 不引入外部向量数据库或在线 RAG 服务。
- 不让 Claude Code 或 MCP tool 直接生成最终用户回复。
- 不改变现有 HTTP response shape，除非提供兼容测试。
- 不破坏现有 case JSON shape；新增状态必须通过可选字段、独立 knowledge review 文件或可迁移结构实现。
- 不在 gateway route、worker adapter 或 product Agent prompt 中塞业务流程逻辑。

## Decisions

### 1. Knowledge Processing Pipeline 归属 `src/knowledge/`

Decision:

- 在 `src/knowledge/` 建立 Knowledge Processing Pipeline。流水线是知识库数据层责任，不属于 runtime、gateway、worker 或 product Agent prompt。
- 当前 `knowledge:init` 可以保留一键体验，但内部必须拆为稳定步骤：source intake -> extract blocks -> normalize blocks -> draft parent slices -> audit -> repair plan -> optional auto repair -> review -> publish -> index -> eval。
- 每一步必须产生可追溯的本地中间产物，方便人工查看、其他模型执行基础编码任务、失败后重跑。
- 只有 publish 阶段输出的 active 文档才能进入正式索引。draft、review_required、quality_error 或 rejected 文档不能支撑高置信直答。

Pipeline artifacts:

- `knowledge/_sources/<kind>/<file>`: 原始文件副本。
- `knowledge/_sources/<kind>/<file>.meta.json`: source metadata，包含 source id、sha256、parser、imported_at、原始路径、标题、版本、owner。
- `knowledge/_pipeline/extracts/<source-id>.blocks.jsonl`: 结构化 block 中间层，每行一个 heading/paragraph/list_item/table/toc/header_footer/image_caption/unknown block。
- `knowledge/_pipeline/extracts/<source-id>.extract-report.json`: 解析报告，记录 block 数量、unknown 比例、目录过滤、表格保真、错误。
- `knowledge/_pipeline/normalized/<source-id>.blocks.jsonl`: 清洗后的 block，保留原始 block id、normalized text、section_path、order。
- `knowledge/_pipeline/drafts/<source-id>/...slice.md`: 候选 parent slice，初始 `status: draft`、`quality_status: unchecked`。
- `knowledge/reports/source-quality-report.json`: 原始解析和 normalize 质量报告。
- `knowledge/indexes/chunk-quality-report.json`: parent slice / child chunk 质量报告。
- `knowledge/_pipeline/repair-plans/repair-plan-<timestamp>.json`: 自动修复计划。
- `knowledge/_pipeline/review/<source-id>.review.json`: 人工审核记录。
- `knowledge/_pipeline/publish/publish-report.json`: 发布报告，记录从 draft 到 active 的文档、拒绝项和质量门禁结果。
- `knowledge/reports/eval-report.json`: 问题集评测报告。

Pipeline commands:

- `knowledge init --source-dir <dir>`: 创建目录、复制 source、可选择跑完整 pipeline，但必须留下中间产物。
- `knowledge extract`: 只做 source -> blocks。
- `knowledge slice`: 只做 normalized blocks -> draft slices。
- `knowledge audit`: 只做 source/draft/published/chunk 质量检测。
- `knowledge repair --plan`: 根据 audit 生成 repair plan，不改文件。
- `knowledge repair --apply <plan>`: 执行确定性修复，写修复报告。
- `knowledge review`: 审核 draft/repair 后的 slice，写 review record。
- `knowledge publish`: 将通过审核的 draft slice 发布到正式 `knowledge/whitepapers/...` 或其他正式目录。
- `knowledge eval`: 用黄金问题集验证命中率、answer-bearing rate、false positive 和升级行为。

Rationale:

- codegraph 类工具的价值不是“切一刀”，而是本地有可观察、可审核、可重跑的构建过程。知识库也需要同样的处理过程。
- block 中间层可以区分解析失败、清洗失败、切片失败和检索失败，避免把所有问题混成“检索不好”。
- draft/publish 分离可以避免低质量切片直接进入 active index。
- repair plan 先生成、再应用，可以让其他模型或人工审阅每次修复动作，降低误删资料风险。
- 质量报告必须能独立于聊天运行，方便人工先处理知识库。

Source/block quality issue examples:

- `parser_empty`: 原始文档没有提取出有效 block。
- `too_many_unknown_blocks`: unknown block 比例过高。
- `toc_not_removed`: 目录 block 未被识别或未过滤。
- `header_footer_noise`: 页眉页脚被当作正文。
- `table_lost`: 表格结构丢失或字段和值分离。
- `heading_structure_broken`: 标题层级不连续或 section_path 无法构建。
- `duplicate_paragraphs`: 源解析产生重复段落。
- `source_provenance_missing`: source id、hash、路径或 parser 信息缺失。

Slice quality issue examples:

- `empty_body`: parent slice 没有正文或只有标题。
- `toc_like`: 内容疑似目录、页眉页脚、重复标题。
- `too_short`: 低于最小字符数，不能独立回答。
- `too_long`: 超过 parent slice 上限，需要再切。
- `duplicate_content`: 多个 slice 正文 hash 高度相同。
- `multi_topic_slice`: 一个 slice 混入多个业务主题，应拆分。
- `broken_coreference`: 片段大量使用“该功能/上述/如下图”等指代，离开上下文无法理解。
- `not_answer_bearing`: 片段无法支撑任何明确回答。
- `missing_source_document`: 缺 source provenance。
- `missing_source_block_ids`: 无法追溯到原始 block。
- `missing_section_path`: 缺逻辑章节路径。
- `orphan_chunk`: chunk 找不到 parent slice。
- `low_signal_terms`: related_terms / headings 缺少可检索业务词。

Severity:

- `error`: 不能纳入 active 检索，例如 orphan chunk、缺 parent、无 source provenance。
- `warn`: 可检索但需要人工复核，例如 toc-like、too-short、duplicate。
- `info`: 可优化问题，例如 related_terms 偏少。

State model:

- `imported`: source 已复制并有 metadata。
- `extracted`: 已生成 blocks 和 extract report。
- `normalized`: 已清洗并生成 normalized blocks。
- `draft`: 已生成候选 slice，但尚未审核。
- `quality_warn`: 有 warning，可人工接受或修复。
- `quality_error`: 有 error，默认不能发布。
- `review_required`: 需要人工审核。
- `approved`: 人工审核通过，可发布。
- `rejected`: 人工拒绝，不进入 active index。
- `published`: 已写入正式 knowledge 目录并可索引。

Default behavior:

- MVP 不阻塞初始化成功，但必须输出 warning、report path 和 issue count。
- 后续可通过 `--quality-gate strict` 或配置开启 error 阻塞。

Implementation review addendum:

- `knowledge init` must not silently promote unchecked draft slices to `status: active` or `quality_status: ok`.
- If a one-command compatibility path is kept, it must be explicit, for example `--legacy-active-publish`, and the command output must say that it bypasses normal review. The default path should produce source artifacts, normalized blocks, draft slices, quality reports, and indexes only for already-published formal documents.
- Review and publish are separate state transitions. `knowledge review --action approve` may set `pipeline_status: approved` on a draft, but it must not set the draft Markdown `status: active`; `status: active` belongs only to formal published knowledge written by `knowledge publish`.
- `quality_status: ok` can only be assigned after a quality audit has run and no blocking issues apply. String replacement from `unchecked` to `ok` without reading the audit result is forbidden.
- `knowledge init` and `knowledge update` must accept `--quality-gate warn|strict|off`, default to `warn`, write the report unless `off`, and print issue counts. `warn` exits zero while showing issues; `strict` exits non-zero on error severity.
- `source-quality-report.json` must be generated from actual extract and normalize artifacts. It cannot depend on a pre-existing report file that no command writes.
- `chunk-quality-report.json` must audit derived chunks by reading `chunks.jsonl`, not only parent Markdown. It must detect orphan chunks, missing parent slices, and active parents with no chunk.
- DOCX `table_lost` must be emitted when a DOCX actually contains table XML (`<w:tbl>`), not for every DOCX unconditionally.
- Oversized draft slices must be split into multiple draft files when safe boundaries exist. Adding a marker comment without splitting is only allowed as a warning when no safe boundary exists.
- Evidence Judge score must be calibrated with weighted components that sum to a bounded score. Summing seven 0-1 components and clamping to 1.0 is not acceptable because it destroys threshold meaning.
- Deep Query pivot helpers must be wired into runtime retry orchestration. A pure pivot function alone does not satisfy the retry/pivot requirement.
- The acceptance command must execute behavior scenarios, not only static config checks. Static checks may be one scenario, but direct whitepaper hit, no-hit escalation, implementation-detail escalation, and solved-case curation smoke must also be represented.

Alternatives considered:

- 在 ingest 时直接丢弃低质量 slice。暂不采用：可能误删有价值内容；先报告、再由人工确认。
- 把质量审核交给模型。暂不作为默认：成本、稳定性和隐私不可控；可作为后续可选审计器。
- 只在 `knowledge:update` 时审计正式 slice。拒绝：太晚，错误已经进入正式知识库；必须在 draft 阶段就暴露。

### 2. Evidence Judge 采用“确定性规则 + 可选语义评估”分层

Decision:

- 保留当前本地确定性规则作为最低安全层。
- 增加更细的 score breakdown：`relevance`、`coverage`、`source_authority`、`freshness`、`version_match`、`agreement`、`actionability`、`ambiguity_penalty`、`risk_penalty`。
- 增加 `judge.rationale` 和 `judge.blockers`，便于日志和测试解释。
- 如配置了模型，可增加 bounded model-assisted semantic check，但它只能输出结构化 judge 辅助字段，不能直接回复用户。

Must-block signals:

- 实现细节、接口路径、文件路径、日志、表名、配置项、当前项目/代码库、follow-up 指代。
- 生产事故、数据修复、支付、权限、安全。
- 只有目录片/空片/低质量片命中。
- active 与 deprecated/archived/review_required 文档冲突。
- 文档过期且问题依赖当前实现或当前产品状态。

False-positive controls:

- 如果 top hit 只匹配泛词，例如“课程/配置/功能/怎么”，但缺少业务实体或标题覆盖，应降低 answer_score。
- 如果 query module 和 top hit module 不一致，且没有 alias/taxonomy 支撑，应要求补检或升级。
- 如果 evidence excerpt 不包含可回答动作或规则句，应标记 `missing_info: ["可回答证据句"]`。

Alternatives considered:

- 完全模型化 Judge。拒绝：会让安全边界依赖模型稳定性，也更难测试。
- 继续只用当前规则。拒绝：泛词召回和白皮书噪音会导致误答风险。

### 3. Deep Query Correction 由“上下文提示”升级为“受限重试控制”

Decision:

- 在 runtime 中维护 deep query attempt 状态，最多执行有限次数，默认最多 2 次 worker run。
- 第一次 worker 结果如果证据不足、missingInfo 指向未查到、或 review 要求继续，Query Correction 可选择下一轮 pivot。
- retry 仍构造标准 `DiagnosticRequest`，通过现有 worker port 派发。
- correction 结果只进入 `DiagnosticRequest.context.deepQuery` 和 constraints，不改变 Claude Code 只读策略。

Attempt state:

```ts
{
  attempt: 1,
  maxAttempts: 2,
  artifactTargets: ["scheduler"],
  anchorTerms: ["学习提醒", "8点"],
  triedQueries: ["scheduler reminder"],
  failedReasons: ["no scheduler evidence"],
  nextPivot: "queue_callback_state",
  stopReason?: "max_attempts" | "sufficient_evidence" | "needs_user" | "human_escalation"
}
```

Pivot families:

- scheduler -> queue / callback / state_machine
- route -> controller / service / config
- payment -> order / refund / permission / audit log
- permission -> auth / role / policy / tenant scope
- config -> env / settings / feature flag / admin UI

Stop conditions:

- 已获得足够 evidence。
- 达到 `maxAttempts`。
- 风险高，需要人工。
- 下一步需要用户提供 traceId、tenant、环境或时间范围。

Alternatives considered:

- 让 Claude Code 自行多轮探索。拒绝：会丢失 super helper 的审计和停止条件。
- runtime 无限 retry。拒绝：成本不可控，也可能污染会话。

### 4. 真实验收作为 CLI / script 能力，不写入普通单测

Decision:

- 增加本地 acceptance 命令或脚本，例如 `npm run accept:knowledge` 或 `node dist/cli.js accept knowledge`。
- 验收命令应读取当前配置，但输出必须脱敏，不打印 API key、token、cookie。
- 验收覆盖真实远程模型、Claude Code 可执行性、knowledge direct answer、no-hit escalation、implementation detail escalation。
- 普通 CI 仍使用 mock 测试；真实验收由用户本机按需运行。

Acceptance report:

- 输出 JSON 或 Markdown 到 `reports/knowledge-acceptance-<timestamp>.json`。
- 记录每个 scenario 的 pass/fail、caseId、关键日志 phase、worker 是否调用、deepQuery 是否附加。
- 不保存 secret，不保存完整 raw model payload。

Alternatives considered:

- 把真实远程调用放进 `pnpm test`。拒绝：不稳定、成本不可控、依赖本机认证。
- 只靠手工聊天验证。拒绝：不可重复、不可审计。

### 5. Case Curator Review 使用知识库内 review record，runtime 只编排状态流

Decision:

- solved case 草稿仍写到 `knowledge/tickets/solved-cases/<module-id>/`，默认 `status: review_required`。
- review 信息可以选择两种方式：
  - 写回 frontmatter 可选字段：`reviewer`、`reviewed_at`、`review_notes`。
  - 或写 sidecar：`<case>.review.json`。
- MVP 优先使用 frontmatter + optional sidecar，避免改 case JSON。
- 审核通过后才允许把 `status` 改为 `active`；拒绝则保持 `review_required` 或转到 unresolved case。
- 每次 review 状态变化必须写 dirty flag 并记录日志。

Review actions:

- `approve`: review_required -> active。
- `reject`: 保持 review_required，写 review_notes 和 rejection reason。
- `convert_to_unresolved`: 移到 unresolved-cases 或生成 unresolved copy。
- `request_edits`: 保持 review_required，提示需要补充 evidence、适用范围或风险说明。

Ownership:

- `src/knowledge/` 负责读写 solved case Markdown、frontmatter、review metadata、dirty flag。
- `src/runtime/` 负责在用户或 API 触发 review 动作时编排日志和状态。
- `src/gateway/` 仅在需要 API 时暴露 DTO。

Alternatives considered:

- 把 review 状态存在 case JSON。暂不采用：会扩大迁移风险。
- 自动把所有 solved case 激活。拒绝：会固化错误结论。

### 6. 文档更新纳入本 change

Decision:

- 更新 `docs/architecture/overview.md` 和 `docs/architecture/agents.md` 中与当前实现不一致的旧段落。
- 新增或更新验收文档，说明 knowledge hardening 的运行命令、报告位置和风险。

Rationale:

- 当前文档仍有“runtime 尚未接入 knowledge”之类上一阶段遗留描述。
- 下一轮执行前必须让架构文档与代码真实状态对齐。

## Risks / Trade-offs

- [Risk] 质量门禁过严导致可用知识无法检索。 -> Mitigation: 默认 warn，不默认 fail；strict gate 需要显式开启。
- [Risk] Judge 过度保守，太多问题升级代码。 -> Mitigation: 保留 answer_score breakdown 和日志，按真实样本调阈值。
- [Risk] Deep Query retry 增加成本和耗时。 -> Mitigation: 默认最多 2 次，且必须有 correction reason。
- [Risk] 真实验收误打印 secret。 -> Mitigation: 输出层统一脱敏，禁止打印 env/config secret 字段。
- [Risk] Review workflow 引入 HTTP API 后 gateway 混入业务逻辑。 -> Mitigation: gateway 只做 DTO；review 决策在 runtime/knowledge。
- [Risk] Case frontmatter 变复杂。 -> Mitigation: 新字段全是可选，frontmatter parser 保持兼容。

## Migration Plan

Phase 1: 文档和 pipeline contract

- 更新架构文档旧描述。
- 定义 source metadata、block、normalized block、draft slice、repair plan、review record、publish report、quality report、eval report schema。
- 明确正式索引只能读取 published/active 文档，draft/review/error 不参与高置信直答。

Phase 2: Source Intake / Extract / Normalize / Draft Slice

- 将当前 `src/knowledge/ingest.ts` 的“一次性解析并写正式 slice”拆为 source intake、block extraction、block normalization、draft slice generation。
- 为真实白皮书生成 `blocks.jsonl`、`extract-report.json`、draft slice，并保持 source block provenance。
- 保持 `knowledge:init` 兼容，但内部调用 pipeline。

Phase 3: Quality Audit / Repair / Review / Publish

- 实现 source/block/slice/chunk 质量审计。
- 实现 repair plan 生成和确定性 auto repair。
- 实现 review record 和 publish gate。
- 接入 `knowledge:init` / `knowledge:update` / 分步 CLI 输出。
- 为真实白皮书生成一次质量基线报告。
- 增加 fixture 覆盖空片、目录片、重复片、orphan chunk、missing provenance、missing source block、跨主题、指代断裂、表格损坏。

Phase 4: Knowledge Eval

- 增加黄金问题集 schema。
- 实现 `knowledge eval`，覆盖 Hit@1/3/5、answer-bearing rate、false positive、no-hit escalation。
- 用当前两份白皮书问题验证真实命中。

Phase 5: Evidence Judge Hardening

- 增加 score breakdown、blockers、false-positive controls。
- 增加过期、冲突、泛词误召回、低质量 slice、高风险等测试。
- 确保直答仍经过 Output Review / Presentation。

Phase 6: Deep Query Retry / Pivot

- 增加 deep query attempt state。
- 在 review 结果证据不足时允许一次受限 retry。
- 增加 scheduler -> queue/callback/state、route -> service/config 等 pivot 测试。

Phase 7: Live Acceptance

- 增加本机验收命令。
- 覆盖模型 provider、Claude Code、知识直答、no-hit 升级、实现细节升级。
- 生成脱敏 acceptance report。

Phase 8: Case Review Workflow

- 增加 review metadata 和状态转换。
- 接入 dirty flag、日志和可选 API。
- 增加 approve/reject/convert/request_edits 测试。

Rollback strategy:

- Pipeline 中间产物位于 `knowledge/_pipeline/` 和 `knowledge/reports/`，可删除后从 source metadata 重建。
- Quality report 是派生文件，可删除重建。
- Publish gate 只移动或复制到正式目录；实现必须保留 draft/review record 便于回滚。
- Judge hardening 可通过配置降级到当前规则。
- Deep Query retry 可通过 `maxAttempts: 1` 关闭。
- Acceptance command 不影响运行时。
- Case review 字段必须可选；旧 solved case 仍可读取。

## Open Questions

- 质量门禁 strict 模式是否要作为默认，还是只在用户显式运行 acceptance 时启用？
- Case review 是否先做 CLI，还是直接做 HTTP API + UI？
- Reviewer 身份在本地单用户模式下用 `local-user`、配置 owner，还是要求显式输入？
- 可选模型辅助 Judge 是否进入这一轮执行，还是只预留接口？
- Live acceptance 是否允许真实调用 Claude Code，还是第一版只验证 Claude CLI 可用并用 mock worker 做行为验收？
