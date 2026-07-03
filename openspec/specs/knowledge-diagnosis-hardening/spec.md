## Purpose

Define the local knowledge processing pipeline, quality audit, evidence-judge hardening, deep-query retry, live acceptance, and case review workflow for the `super helper` knowledge-first runtime. The capability covers everything between source ingest and a published, audited slice that can be cited by the Evidence Judge.

## Requirements

### Requirement: Knowledge processing pipeline
The system SHALL process source knowledge through explicit local pipeline stages before published knowledge can be treated as production-ready evidence.

#### Scenario: Pipeline stages are explicit
- **WHEN** source documents are processed
- **THEN** the system records stage outputs for source intake, extraction, normalization, draft slicing, quality audit, repair planning, review, publish, indexing, and evaluation

#### Scenario: One-shot init keeps intermediate artifacts
- **WHEN** `knowledge init --source-dir <dir>` runs in compatibility mode
- **THEN** it may run multiple pipeline stages automatically but still writes source metadata, block extraction artifacts, draft slice artifacts, quality reports, and publish/index reports instead of only writing final chunks

#### Scenario: Pipeline can run step by step
- **WHEN** a user runs step commands such as `knowledge extract`, `knowledge slice`, `knowledge audit`, `knowledge repair`, `knowledge review`, `knowledge publish`, or `knowledge eval`
- **THEN** each command reads the prior stage artifacts, writes only its own stage artifacts, and prints the next recommended command

#### Scenario: Draft content does not become high-confidence evidence
- **WHEN** a slice is in `draft`, `review_required`, `quality_error`, or `rejected` state
- **THEN** the system does not allow that slice to justify a high-confidence direct answer, even if keyword search matches it

#### Scenario: Published content is traceable to source
- **WHEN** a draft slice is published to the formal `knowledge/` tree
- **THEN** it preserves `source_document_id`, `source_block_ids`, `section_path`, source hash provenance, quality status, review metadata, and publish report references

### Requirement: Source intake and extraction artifacts
The system SHALL preserve source documents and extract them into structured blocks before generating slices.

#### Scenario: Source metadata recorded
- **WHEN** a DOCX, Markdown, or supported source file is imported
- **THEN** the system copies it under `knowledge/_sources/<kind>/` and writes metadata containing id, original path, stored path, sha256, source type, parser, imported time, title, owner, product versions, and ingest tool version

#### Scenario: Blocks JSONL generated
- **WHEN** a source document is extracted
- **THEN** the system writes `knowledge/_pipeline/extracts/<source-id>.blocks.jsonl` where each line contains `block_id`, `source_document_id`, `order`, `type`, `text`, optional `heading_level`, `section_path`, and parser details

#### Scenario: Extract report generated
- **WHEN** extraction completes
- **THEN** the system writes `knowledge/_pipeline/extracts/<source-id>.extract-report.json` with block counts by type, unknown block count, skipped table-of-contents count, parser warnings, and fatal extraction errors

#### Scenario: Tables and lists are represented
- **WHEN** the source contains lists or tables
- **THEN** the block layer preserves enough structure to keep labels and values together during slicing, or records a `table_lost` / `list_structure_lost` issue

#### Scenario: Extraction failure is bounded
- **WHEN** a source cannot be parsed
- **THEN** the system records a structured skipped source failure in the ingest report and does not create fake successful slices

### Requirement: Normalization and draft slice generation
The system SHALL clean extracted blocks and generate reviewable draft parent slices before publishing.

#### Scenario: Normalized blocks preserve provenance
- **WHEN** extracted blocks are normalized
- **THEN** the system writes `knowledge/_pipeline/normalized/<source-id>.blocks.jsonl` with normalized text, original `block_id`, `source_document_id`, order, block type, and inherited section path

#### Scenario: Boilerplate is removed or labeled
- **WHEN** normalization detects table of contents, repeated page headers, repeated footers, empty paragraphs, repeated document titles, or navigation-only content
- **THEN** it removes those blocks from slice candidates or labels them so quality audit can explain the decision

#### Scenario: Draft slices are generated outside the active tree
- **WHEN** normalized blocks are sliced
- **THEN** the system writes candidate parent slices under `knowledge/_pipeline/drafts/<source-id>/` with `status: draft`, `quality_status: unchecked`, `source_document_id`, `source_block_ids`, `section_path`, and `chunking_strategy`

#### Scenario: Draft slice is independently understandable
- **WHEN** a draft slice is generated
- **THEN** it includes enough inherited heading and local context that a reviewer can understand the slice without opening the full source document

#### Scenario: Parent-child separation preserved
- **WHEN** child chunks are generated for retrieval
- **THEN** each child chunk links to a parent slice, and final evidence can expand back to the parent slice for answer construction

### Requirement: Repair planning and auto repair
The system SHALL generate auditable repair plans before mutating draft or published knowledge files.

#### Scenario: Repair plan generated without mutation
- **WHEN** `knowledge repair --plan` runs after audit
- **THEN** the system writes `knowledge/_pipeline/repair-plans/repair-plan-<timestamp>.json` and does not change Markdown, blocks, chunks, or published documents

#### Scenario: Repair plan contains concrete actions
- **WHEN** a repair plan is written
- **THEN** each action includes action id, issue ids, target paths, target ids, action type, before/after summary, safety classification, and whether human review is required

#### Scenario: Deterministic repairs can be applied
- **WHEN** `knowledge repair --apply <plan>` runs
- **THEN** the system may apply deterministic actions such as merge adjacent short slices, split oversized slices on heading/list boundaries, remove duplicate draft slices, add inherited section path, add missing related terms, or mark quality-error drafts as review required

#### Scenario: Unsafe repairs require review
- **WHEN** an action would rewrite business meaning, reconstruct a table, merge cross-chapter content, summarize ambiguous prose, or choose between conflicting knowledge
- **THEN** the plan marks the action as review required and the apply command does not perform it automatically

#### Scenario: Repair application is reversible
- **WHEN** a repair is applied
- **THEN** the system writes a repair result report with changed files, previous hashes, new hashes, skipped actions, and rollback notes

### Requirement: Human review and publish gate
The system SHALL require review and publish decisions before draft slices enter the active knowledge index.

#### Scenario: Review record written
- **WHEN** a reviewer approves, rejects, requests edits, or accepts warnings for draft slices
- **THEN** the system writes `knowledge/_pipeline/review/<source-id>.review.json` with reviewer, action, notes, reviewed ids, previous status, next status, timestamps, and quality issues considered

#### Scenario: Publish blocks quality errors
- **WHEN** `knowledge publish` encounters a draft slice with `error` severity quality issues
- **THEN** it refuses to publish that slice unless a review record explicitly accepts the issue under a documented override policy

#### Scenario: Publish writes formal knowledge documents
- **WHEN** a draft slice is publishable
- **THEN** the system writes or updates the formal Markdown document under the correct knowledge directory, sets `status: active`, records `quality_status`, preserves provenance, and marks the index dirty

#### Scenario: Publish report generated
- **WHEN** publish completes
- **THEN** the system writes `knowledge/_pipeline/publish/publish-report.json` with published ids, rejected ids, warning overrides, paths, source ids, and index dirty state

#### Scenario: Index reads published knowledge by default
- **WHEN** `knowledge update` builds manifest and chunks
- **THEN** it indexes formal published knowledge documents by default and excludes `_pipeline/drafts`, `_pipeline/review`, `_pipeline/repair-plans`, and `_sources`

### Requirement: Knowledge slice quality audit
The system SHALL audit generated source blocks, draft parent slices, published parent slices, and derived chunks before treating an ingest as production-ready.

#### Scenario: Quality report generated
- **WHEN** `knowledge init` or `knowledge update` processes source documents or parent slices
- **THEN** the system writes `knowledge/indexes/chunk-quality-report.json` containing inspected source documents, draft slice counts, published parent slice counts, chunk counts, issue counts, severity counts, thresholds, stage summaries, and recommended actions

#### Scenario: Source quality report generated
- **WHEN** source intake, extraction, or normalization runs
- **THEN** the system writes `knowledge/reports/source-quality-report.json` containing parser failures, unknown blocks, table/list preservation issues, heading structure issues, duplicate paragraphs, and source provenance issues

#### Scenario: Empty or heading-only slice detected
- **WHEN** a generated parent slice has no meaningful body content beyond frontmatter, headings, boilerplate, or the source reference block
- **THEN** the quality report records an `empty_body` or `heading_only` issue for that slice and marks it at least `warn`

#### Scenario: Directory-like slice detected
- **WHEN** a generated parent slice appears to be a table of contents, page header/footer, repeated document title, or navigation-only content
- **THEN** the quality report records a `toc_like` issue and includes the slice path for human review

#### Scenario: Duplicate slice detected
- **WHEN** two or more parent slices have substantially identical normalized body text
- **THEN** the quality report records `duplicate_content` with all affected slice paths and the shared content hash

#### Scenario: Provenance issue detected
- **WHEN** a parent slice or chunk lacks `source_document`, `source_document_id`, `section_path`, or a valid parent relationship
- **THEN** the quality report records a provenance issue and marks orphan chunks or missing parent links as `error`

#### Scenario: Source block provenance issue detected
- **WHEN** a draft or published whitepaper slice lacks `source_block_ids` or references source blocks that do not exist
- **THEN** the quality report records `missing_source_block_ids` or `missing_source_blocks` and marks it at least `warn`

#### Scenario: Non-answer-bearing slice detected
- **WHEN** a slice contains context but no product rule, condition, step, outcome, definition, or answer-bearing sentence
- **THEN** the quality report records `not_answer_bearing` and prevents the slice from being the only direct-answer evidence

#### Scenario: Cross-topic slice detected
- **WHEN** a slice contains multiple unrelated headings, modules, or business intents
- **THEN** the quality report records `multi_topic_slice` and recommends splitting or review

### Requirement: Knowledge evaluation questions
The system SHALL support a small local golden-question evaluation set for validating that published slices can be retrieved and used as evidence.

#### Scenario: Evaluation question file loaded
- **WHEN** `knowledge eval` runs
- **THEN** it loads a YAML or JSON evaluation file containing question, expected source document, expected section or keywords, expected hit behavior, and whether the answer should exist

#### Scenario: Hit metrics reported
- **WHEN** evaluation completes
- **THEN** the report includes Hit@1, Hit@3, Hit@5, answer-bearing rate, false positive count, no-hit escalation behavior, and per-question failure reasons

#### Scenario: Existing whitepaper questions pass
- **WHEN** the evaluation runs against the two imported whitepapers
- **THEN** the questions about AI companion learning-day 8 PM reminders and EduSoho course search hit answer-bearing evidence from the expected whitepapers

#### Scenario: No-answer question does not direct answer
- **WHEN** an evaluation question has `should_hit: false`
- **THEN** the system treats a direct answer from weak or unrelated knowledge as a failure and records whether the query escalated correctly

#### Scenario: Failures are attributed
- **WHEN** an evaluation question fails
- **THEN** the report classifies the likely failure as source extraction, normalization, slicing, retrieval, evidence judge, missing source knowledge, or escalation behavior

### Requirement: Knowledge quality gate behavior
The system SHALL make knowledge quality issues visible without silently blocking MVP usage by default.

#### Scenario: Default gate warns
- **WHEN** quality audit finds warnings but no errors under the default quality gate
- **THEN** `knowledge init` or `knowledge update` completes successfully and prints the quality report path, warning count, and top issue categories

#### Scenario: Strict gate blocks errors
- **WHEN** strict quality gate is enabled and the audit finds `error` severity issues
- **THEN** the command exits non-zero, leaves the report on disk, and explains which issue categories must be fixed

#### Scenario: Search avoids fatal-quality evidence
- **WHEN** a document or chunk is marked with fatal quality issues
- **THEN** knowledge search excludes it from answerable evidence or marks it as non-answerable evidence for Evidence Judge

### Requirement: Evidence Judge hardening
The system SHALL produce explainable evidence sufficiency decisions with score breakdowns, blockers, and false-positive controls.

#### Scenario: Score breakdown included
- **WHEN** Evidence Judge evaluates an evidence pack
- **THEN** the result includes `answer_score`, component scores for relevance, coverage, source authority, freshness, version match, agreement, actionability, and penalties, plus a human-readable rationale

#### Scenario: Generic keyword false positive blocked
- **WHEN** evidence only matches generic terms such as "课程", "配置", "功能", "怎么", or "支持" without matching a business entity, module alias, title, or answer-bearing sentence
- **THEN** Evidence Judge lowers the score, adds an ambiguity blocker, and prevents high-confidence direct answers

#### Scenario: Low-quality slice cannot direct answer
- **WHEN** the top evidence has quality issues such as empty body, directory-like content, duplicate content, or missing provenance
- **THEN** Evidence Judge requires additional evidence or code/human escalation rather than using that evidence alone for a final answer

#### Scenario: Conflict and stale evidence blocked
- **WHEN** active evidence conflicts with deprecated, archived, review-required, or stale evidence for the same module and intent
- **THEN** Evidence Judge returns `answerable: false`, lists conflicts or stale blockers, and selects code or human escalation

#### Scenario: High-risk uncertainty blocked
- **WHEN** the question involves production incident, payment, permissions, security, or data repair and evidence leaves unresolved uncertainty
- **THEN** Evidence Judge prevents direct answer even if keyword relevance is high

### Requirement: Evidence claim boundary
The system SHALL preserve the distinction between fact, inference, assumption, and unknown from Evidence Judge through final result construction.

#### Scenario: Unsupported fact downgraded
- **WHEN** a knowledge-derived fact has no evidence id or only low-quality evidence
- **THEN** the final `DiagnosticResult` downgrades it to inference, assumption, or unknown before Output Review

#### Scenario: Unknowns remain visible
- **WHEN** Evidence Judge identifies missing version, tenant, environment, current implementation, or source quality information
- **THEN** the resulting diagnostic output keeps those items in `missingInfo` or unknown claims

### Requirement: Deep Query retry and pivot
The system SHALL support bounded retry and deterministic query correction when the first code escalation does not produce sufficient evidence.

#### Scenario: Attempt state attached
- **WHEN** runtime escalates from knowledge to Claude Code
- **THEN** `DiagnosticRequest.context.deepQuery` includes attempt number, max attempts, artifact targets, anchor terms, likely paths, tried queries, failed reasons, and correction actions

#### Scenario: One safe retry
- **WHEN** the first worker result is partial, has insufficient evidence, or Output Review requests continued diagnosis and correction actions remain
- **THEN** runtime may dispatch one follow-up `DiagnosticRequest` with a pivoted deep query while preserving the same Claude session and read-only constraints

#### Scenario: Scheduler pivot
- **WHEN** the first attempt targets scheduler artifacts and finds no scheduler evidence
- **THEN** Query Correction pivots toward queue, callback, state machine, or state update artifacts before asking the user

#### Scenario: Route pivot
- **WHEN** the first attempt targets route artifacts and finds only endpoint evidence without implementation cause
- **THEN** Query Correction pivots toward controller, service, repository, or config artifacts

#### Scenario: Retry stops safely
- **WHEN** max attempts are reached, high-risk escalation is required, or the next step requires user-provided runtime context
- **THEN** runtime stops retrying and returns a reviewed partial, ask-user, or human-escalation result

### Requirement: Live knowledge acceptance checks
The system SHALL provide a repeatable local acceptance command for validating the real layered knowledge setup without exposing secrets.

#### Scenario: Acceptance command checks config
- **WHEN** the acceptance command runs
- **THEN** it verifies active workspace, model provider activation, knowledge directory presence, source ingest report, Claude Code availability, and read-only worker policy

#### Scenario: Acceptance command checks knowledge direct answer
- **WHEN** the acceptance command asks a configured question whose answer exists in the ingested whitepapers
- **THEN** it records that no worker call was needed and that the final reply cites knowledge evidence

#### Scenario: Acceptance command checks no-hit escalation
- **WHEN** the acceptance command asks a no-hit question with enough workspace signal to dispatch
- **THEN** it records that knowledge evidence count is zero and that deep query correction actions include alias or source-type broadening

#### Scenario: Acceptance command checks implementation escalation
- **WHEN** the acceptance command asks an endpoint, file path, config, log, or current implementation question
- **THEN** it records that Evidence Judge required code escalation and that the worker request kept read-only constraints

#### Scenario: Acceptance report is redacted
- **WHEN** the acceptance command writes its report
- **THEN** the report omits API keys, tokens, raw secrets, cookies, and full model payloads while preserving pass/fail, case id, run id, phases, and evidence summaries

### Requirement: Case curation review workflow
The system SHALL support review of generated solved case drafts before they become active knowledge.

#### Scenario: Draft remains review required
- **WHEN** Case Curator generates a solved case draft
- **THEN** the document remains `status: review_required` and `confidence: medium` until a reviewer approves it

#### Scenario: Approve solved case
- **WHEN** a reviewer approves a solved case draft
- **THEN** the system records reviewer metadata, changes status to `active`, preserves provenance, marks the knowledge index dirty, and logs the review action

#### Scenario: Reject solved case
- **WHEN** a reviewer rejects a solved case draft
- **THEN** the system keeps or sets status to `review_required`, records rejection notes, does not mark it high confidence, and logs the review action

#### Scenario: Convert to unresolved case
- **WHEN** a reviewer decides the draft lacks enough evidence to be a solved case
- **THEN** the system creates or moves the content into `knowledge/tickets/unresolved-cases/<module-id>/`, preserves fact/inference/unknown distinctions, and marks the index dirty

#### Scenario: Review API remains transport-only
- **WHEN** an HTTP API is added for case review actions
- **THEN** gateway code only validates input and serializes DTOs; runtime and knowledge modules own review decisions and file mutations

### Requirement: Observability for hardening workflows
The system SHALL make quality audits, hardened judge decisions, deep query retries, live acceptance checks, and case review actions observable.

#### Scenario: Quality audit logged
- **WHEN** a quality audit runs during ingest or update
- **THEN** logs or command output include issue counts, report path, and whether the gate passed, warned, or failed

#### Scenario: Judge blockers logged
- **WHEN** Evidence Judge blocks a direct answer
- **THEN** diagnostic logs include score breakdown, blockers, missing info, and selected escalation path

#### Scenario: Deep query retry logged
- **WHEN** runtime dispatches a retry or pivot
- **THEN** diagnostic logs include attempt number, previous failed reason, next artifact family, and stop condition when finished

#### Scenario: Case review logged
- **WHEN** a reviewer approves, rejects, requests edits, or converts a case
- **THEN** diagnostic logs include action, reviewer, document id, target path, and resulting status

### Requirement: Documentation alignment
The system documentation SHALL accurately describe the current knowledge-first runtime and the new hardening workflows.

#### Scenario: Runtime docs updated
- **WHEN** this change is implemented
- **THEN** `docs/architecture/overview.md`, `docs/architecture/agents.md`, and related developer docs no longer state that knowledge runtime integration is only future work

#### Scenario: Acceptance docs added
- **WHEN** live acceptance tooling is implemented
- **THEN** documentation explains how to run it, where reports are written, what secrets are redacted, and what failures mean

### Requirement: Compatibility preserved
The system SHALL preserve existing runtime, worker, gateway, session, and knowledge contracts while adding hardening behavior.

#### Scenario: Existing chat APIs compatible
- **WHEN** quality audit, hardened judge, deep query retry, live acceptance, or case review is added
- **THEN** existing `/api/chat`, `/api/session`, `/api/sessions`, `/api/settings`, and `/api/logs` response shapes remain backward compatible

#### Scenario: Existing case JSON readable
- **WHEN** existing case JSON files are loaded after hardening changes
- **THEN** they remain readable without destructive migration

#### Scenario: Knowledge can be disabled or absent
- **WHEN** the active workspace has no usable `knowledge/` directory or knowledge hardening is disabled
- **THEN** runtime preserves the existing Experience -> Preflight -> DiagnosticWorker -> Review -> Presentation flow

### Requirement: Knowledge and worker diagnosis share resolved turn semantics
Knowledge-first diagnosis and worker escalation SHALL consume the same resolved query, facts, claims, hypotheses, and unknowns for a user turn.

#### Scenario: Knowledge evidence is insufficient
- **WHEN** strict knowledge review escalates to a worker
- **THEN** the worker request preserves the resolved query and evidence gaps without turning user hypotheses into known facts

### Requirement: Evidence claim boundary is enforced before final presentation
All knowledge, history, workspace, MCP, manual, and log evidence SHALL pass the same deterministic claim/evidence validation before a final user reply.

#### Scenario: Knowledge result uses invalid evidence ID
- **WHEN** a generated knowledge fact references an evidence ID not present in the result
- **THEN** the final outcome cannot be final and the issue is logged

#### Scenario: History evidence is the only support
- **WHEN** a historical reply is similar but current evidence validation fails
- **THEN** history is labeled as unconfirmed context and normal diagnosis continues

### Requirement: Conversation evidence lifecycle preserves compatibility and isolation
New context, validation, and registry metadata SHALL be additive, bounded, and isolated by tenant, user, case, run, and workspace.

#### Scenario: Existing API client loads session
- **WHEN** session and agent APIs include records created before this change
- **THEN** existing required fields and status values remain compatible and new metadata is optional

#### Scenario: Same workspace contains different users
- **WHEN** Experience or context building runs
- **THEN** messages, runs, evidence, and conclusions from another user or tenant are not included

### Requirement: Pipeline gap closure guardrails
The system SHALL close the implementation gaps found after the first hardening implementation review.

#### Scenario: Init does not bypass review by default
- **WHEN** `knowledge init` imports source documents without an explicit legacy publish flag
- **THEN** it writes intake, extract, normalize, draft, audit, and ingest reports but does not convert unchecked draft slices into active formal knowledge documents

#### Scenario: Legacy publish is explicit and visible
- **WHEN** a user chooses a compatibility option that publishes without human review
- **THEN** the command output and ingest report mark the run as legacy compatibility publish and include the quality report path and unresolved issue counts

#### Scenario: Review approval does not equal active publication
- **WHEN** `knowledge review --action approve` runs for draft slices
- **THEN** the draft frontmatter records an approved pipeline state and review metadata, but active searchable Markdown is only created by `knowledge publish`

#### Scenario: Quality OK requires audit evidence
- **WHEN** a draft or published slice has `quality_status: ok`
- **THEN** the latest quality report for that document or source contains no blocking issue for that status, and the publish report records the audit used

#### Scenario: Source quality report is generated from real artifacts
- **WHEN** extraction and normalization have produced reports
- **THEN** `knowledge audit` writes `knowledge/reports/source-quality-report.json` by reading those reports and converting parser, table/list, heading, duplicate, and provenance warnings into structured issues

#### Scenario: Chunk quality audits derived chunks
- **WHEN** `knowledge audit` runs after `knowledge update`
- **THEN** it reads `knowledge/indexes/chunks.jsonl`, counts inspected chunks, reports orphan chunks whose parent does not exist, and reports active parent slices that produce no chunk

#### Scenario: Oversized slices are split
- **WHEN** normalized blocks for one section exceed the configured parent slice character limit
- **THEN** the slicer creates multiple ordered draft slice files using heading, list, table, or paragraph boundaries; it only emits a manual split warning when no safe boundary exists

#### Scenario: Evidence score remains calibrated
- **WHEN** Evidence Judge computes `answer_score`
- **THEN** component weights produce a score in `[0, 1]` without relying on post-hoc clamping of an over-summed score, and tests prove weak/generic evidence remains below the direct-answer threshold

#### Scenario: Deep Query pivot runs in runtime
- **WHEN** the first code escalation returns partial or insufficient evidence and a deterministic pivot is available
- **THEN** runtime dispatches at most one additional read-only diagnostic request with pivoted artifact targets, records retry events, and stops on max attempts, high risk, worker failure, no new pivot, or user-required context

#### Scenario: Acceptance includes behavior scenarios
- **WHEN** `accept knowledge` runs in mock-worker mode
- **THEN** it executes config checks plus whitepaper direct-answer, no-hit escalation, implementation-detail escalation, and solved-case curation smoke scenarios, and writes pass/fail details for each scenario

### Requirement: Knowledge-first runtime uses retrieval service boundary
The knowledge-first runtime SHALL consume knowledge evidence through the retrieval service instead of owning retrieval strategy selection or provider construction.

#### Scenario: Runtime searches knowledge
- **WHEN** a user question reaches the knowledge-first diagnosis stage
- **THEN** runtime calls the retrieval service with the question, route candidates, persona visibility, workspace context, and retrieval limit

#### Scenario: Runtime receives retrieval evidence
- **WHEN** retrieval returns candidates
- **THEN** runtime converts the retrieval result into the existing knowledge evidence pack shape before Evidence Judge evaluates answerability

#### Scenario: Runtime escalates with retrieval context
- **WHEN** Evidence Judge blocks direct answer or requires code escalation
- **THEN** runtime attaches retrieval evidence and trace context to `DiagnosticRequest.context` without exposing provider internals in the user-facing reply

### Requirement: Runtime does not instantiate retrieval providers
The runtime SHALL NOT directly create embedding providers, rerank providers, or vendor adapters.

#### Scenario: Embedding recall is enabled
- **WHEN** embedding recall is available for a workspace
- **THEN** provider creation happens behind retrieval strategy setup and not inside `DiagnosticRuntime`

#### Scenario: Rerank is enabled
- **WHEN** rerank is available for fused candidates
- **THEN** rerank provider creation happens behind retrieval rerank service and not inside `DiagnosticRuntime`

### Requirement: Existing knowledge diagnosis behavior remains compatible
The retrieval refactor SHALL preserve existing Evidence Judge and presentation behavior while changing the retrieval implementation boundary.

#### Scenario: Knowledge direct answer remains reviewed
- **WHEN** retrieval evidence is answerable
- **THEN** the result still passes Evidence Judge, Output Review, and Presentation before becoming user-visible

#### Scenario: Knowledge absent fallback remains
- **WHEN** the active workspace has no usable knowledge directory or retrieval returns no evidence
- **THEN** runtime preserves the existing Experience -> Preflight -> DiagnosticWorker -> Review -> Presentation flow

#### Scenario: Restricted evidence remains hidden
- **WHEN** retrieval finds evidence that is not visible to the current persona
- **THEN** that evidence cannot be used as a direct user-facing answer and the existing restricted-evidence behavior remains intact

### Requirement: Evidence Judge consumes complete retrieval grounding
The Evidence Judge SHALL base knowledge direct-answer decisions on canonical parent metadata, quality, provenance, freshness, answer span, retrieval trace, and typed blockers rather than matched-term count alone.

#### Scenario: Retrieval migration drops metadata
- **WHEN** a retrieval strategy returns a chunk without the parent metadata required by the Judge
- **THEN** the evidence is incomplete, direct answer is blocked, and the missing fields are observable

#### Scenario: Quality report marks an active document error
- **WHEN** the canonical quality report marks the top active parent as error
- **THEN** the Judge blocks direct answer even if BM25, embedding, or rerank ranks it first

### Requirement: Runtime knowledge observability includes retrieval trace
Knowledge lifecycle logs SHALL include the configured retrieval trace and the strict eligibility rationale used for the final route decision.

#### Scenario: Embedding disabled
- **WHEN** a runtime turn searches knowledge with embedding disabled
- **THEN** logs show BM25 ran, embedding skipped with a safe reason, rerank status, final candidates, and Judge blockers

#### Scenario: Evidence is escalated
- **WHEN** strict eligibility blocks direct answer
- **THEN** the code escalation context preserves evidence IDs, answer spans when present, quality/provenance gaps, strategy scores, and the reason for escalation

### Requirement: Retrieval hardening preserves compatibility
The retrieval grounding change SHALL preserve existing public HTTP responses, existing case JSON readability, default offline behavior, and old knowledge artifact readability.

#### Scenario: Old case is loaded
- **WHEN** a persisted case lacks new retrieval trace or grounding fields
- **THEN** it loads without migration and missing fields are treated as unknown

#### Scenario: Default test suite runs
- **WHEN** `pnpm test` runs without real provider credentials
- **THEN** no paid network request occurs and fake/fixture paths provide deterministic coverage

### Requirement: Configured retrieval reranks parent-level candidates
The configured retrieval pipeline SHALL deduplicate fused child candidates to one representative per parent before rerank, pass at most the configured rerank Top N candidates to the provider, and return at most 8 final evidence results.

#### Scenario: Multiple children share a parent
- **GIVEN** BM25 or embedding recall returns multiple children for the same parent
- **WHEN** configured retrieval prepares rerank input
- **THEN** it keeps one representative candidate for that parent, preserves child hit metadata, and does not spend multiple rerank slots on the same parent

#### Scenario: Default rerank budget is used
- **GIVEN** a fresh config has no explicit rerank Top N override
- **WHEN** configured retrieval creates the reranker
- **THEN** the default Top N is 8 and aligns with the final evidence limit

#### Scenario: Setup or settings UI persists rerank defaults
- **GIVEN** a user submits setup or settings without editing rerank Top N
- **WHEN** the UI serializes the rerank config
- **THEN** it submits 8, not the historical value 2

### Requirement: Rerank score fusion is normalized within the candidate batch
The rerank service SHALL compute final scores from batch-local normalized rerank scores and batch-local normalized RRF scores, with rerank weighted at 0.7 and RRF weighted at 0.3.

#### Scenario: Rerank scores vary
- **GIVEN** rerank returns different scores for candidates that already have RRF final scores
- **WHEN** final scores are calculated
- **THEN** final scores are in the `[0,1]` range and rerank ordering dominates ties or weaker RRF differences

#### Scenario: Rerank scores are all equal
- **GIVEN** all returned rerank scores are equal
- **WHEN** final scores are calculated
- **THEN** the system falls back to RRF ordering instead of inventing rerank separation

#### Scenario: Rerank fails
- **GIVEN** rerank throws, times out, lacks credentials, or returns malformed candidate IDs
- **WHEN** retrieval completes
- **THEN** fused candidates remain available, the trace records a redacted failure or skip reason, and no provider secret or raw request text is exposed

### Requirement: Default semantic recall degrades safely without credentials
The system SHALL default to `knowledge.buildVectorIndex=true` and `embedding.enabled=true`, while keeping no-key and no-network paths usable through explicit skip/degrade behavior.

#### Scenario: Retrieval runs without embedding credentials
- **GIVEN** embedding is enabled by default and no materialized API key exists
- **WHEN** configured retrieval runs
- **THEN** BM25 still runs, embedding is skipped with a safe trace reason, and no network request is attempted

#### Scenario: Onboarding runs without embedding credentials
- **GIVEN** setup defaults enable vector build and embedding but the user has not supplied an embedding key
- **WHEN** onboarding validates, tests providers, plans vector build, and runs the knowledge pipeline
- **THEN** embedding credentials are not a blocking validation error, provider smoke is skipped as `missing_credentials`, vector build is skipped, and keyword/BM25 indexing can still complete

#### Scenario: Existing config explicitly disables embedding
- **GIVEN** an existing config sets `embedding.enabled=false` or `knowledge.buildVectorIndex=false`
- **WHEN** config is loaded
- **THEN** the explicit false value is preserved and defaults do not silently re-enable the provider

### Requirement: Query normalization and alias expansion are shared by recall strategies
Configured retrieval SHALL normalize the user query once at the retrieval service boundary and pass the same normalized query to recall strategies while preserving the original query for rerank.

#### Scenario: Fullwidth and traditional query text is used
- **GIVEN** the user query includes fullwidth ASCII, fullwidth spaces, common traditional Chinese characters, redundant whitespace, or boundary punctuation
- **WHEN** retrieval normalizes the query
- **THEN** recall receives the normalized text, boundary punctuation is stripped, and rerank receives the original user text

#### Scenario: Alias text needs normalization
- **GIVEN** taxonomy aliases contain fullwidth or traditional Chinese text
- **WHEN** a normalized query contains the normalized alias
- **THEN** the normalized alias term is added to `expandedTerms` and BM25 tokenization uses both the normalized query and expanded terms

#### Scenario: No alias matches
- **GIVEN** no taxonomy alias appears in the normalized query
- **WHEN** retrieval runs
- **THEN** no unrelated expanded term is added and the original query remains available for trace/evidence context

### Requirement: Parent-child chunking remains configurable and versioned
The knowledge chunk builder SHALL expose chunking parameters through configuration, split long answer-bearing blocks by sentence/window when possible, and version new artifacts as `parent-child-v3`.

#### Scenario: Chunking options are omitted
- **GIVEN** no custom chunking config is provided
- **WHEN** knowledge chunks are built
- **THEN** defaults are `maxChars=800`, `overlapStrategy=sentence`, `overlapChars=120`, and `minChars=80`

#### Scenario: Long block has sentence boundaries
- **GIVEN** a single source block exceeds `maxChars` but contains Chinese or English sentence boundaries
- **WHEN** chunking runs
- **THEN** it creates bounded overlapping windows instead of marking the entire block as manual-split-only

#### Scenario: Long block has no safe split point
- **GIVEN** a single source block exceeds `maxChars` and has no sentence boundary
- **WHEN** chunking runs
- **THEN** the block is preserved with `manual_split_required` so no answer-bearing text is silently dropped

#### Scenario: Chunk strategy version changes
- **GIVEN** chunks are rebuilt with `parent-child-v3` and `artifact_version=3`
- **WHEN** vector compatibility is checked against v2 vector artifacts
- **THEN** compatibility reports `rebuild-required` for source chunk mismatch and v2 chunks are treated as legacy

### Requirement: Knowledge indexing distinguishes parent evidence from child recall
The knowledge processing pipeline SHALL build provenance-complete child recall artifacts from reviewed published parents while retaining parents as the final evidence unit.

#### Scenario: Published parent is indexed
- **WHEN** an approved parent is published and index update runs
- **THEN** every child maps to the parent and source blocks, and evidence expansion can recover an answer span and canonical source

#### Scenario: Legacy artifact is encountered
- **WHEN** a legacy parent or chunk lacks v2 metadata
- **THEN** compatibility reading succeeds but strict direct-answer eligibility remains false

### Requirement: Quality and evaluation govern hybrid release
Knowledge quality reports and production retrieval evaluation SHALL jointly govern whether a parent/module batch can support direct answer.

#### Scenario: Retrieval metrics pass but quality fails
- **WHEN** expected parents rank correctly but one top parent has blocking quality or provenance issues
- **THEN** the batch remains ineligible for direct answer

#### Scenario: Quality passes but retrieval metrics fail
- **WHEN** parents are quality-clean but holdout recall or ranking misses the required threshold
- **THEN** the batch remains ineligible and the failure is attributed to retrieval

### Requirement: Hybrid migration preserves existing boundaries
Knowledge SHALL own artifact building and local metadata, retrieval SHALL own tokenization/scoring/fusion/rerank orchestration, providers SHALL own vendor protocols, and runtime SHALL own direct-answer decisions.

#### Scenario: Boundary audit runs
- **WHEN** implementation is reviewed
- **THEN** no knowledge module imports provider adapters, no provider imports knowledge, no runtime implements scoring/vendor mapping, and no CLI duplicates the business flow
