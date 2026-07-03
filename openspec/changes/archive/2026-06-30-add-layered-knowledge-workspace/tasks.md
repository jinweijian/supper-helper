## 1. OpenSpec and Architecture Baseline

- [x] 1.1 Review this change's `proposal.md`, `design.md`, and `specs/layered-knowledge-diagnosis/spec.md` before implementation.
- [x] 1.2 Update `docs/standards/development.md` with the new `src/knowledge/` module ownership boundary.
- [x] 1.3 Update `docs/architecture/overview.md` with the layered knowledge-first diagnostic pipeline.
- [x] 1.4 Update `docs/architecture/agents.md` with Knowledge Router, Evidence Judge, and Case Curator responsibilities.
- [x] 1.5 Run `pnpm lint` after documentation-only changes.

## 2. Workspace Schema and Knowledge Templates

- [x] 2.1 Add example workspace knowledge taxonomy files under the appropriate template or fixture location: `modules.yaml`, `aliases.yaml`, `intents.yaml`, and `source-types.yaml`.
- [x] 2.2 Add Markdown templates for FAQ, solved case, unresolved case, whitepaper slice, runbook, module overview, and glossary term.
- [x] 2.3 Define the supported frontmatter enum values for `type`, `source_type`, `confidence`, `status`, and `visibility`.
- [x] 2.4 Add validation fixtures for valid and invalid knowledge documents.
- [x] 2.5 Add lint or unit tests that reject missing required frontmatter fields.
- [x] 2.6 Add source document metadata schema examples for original PDF files under `knowledge/_sources/`.
- [x] 2.7 Extend the whitepaper slice template with `source_document`, `source_document_id`, `source_pages`, `section_path`, and `chunking_strategy`.
- [x] 2.8 Add an evidence chunk JSONL schema example that links each chunk to a parent slice and source document page range.

## 3. Knowledge Module MVP

- [x] 3.1 Create `src/knowledge/` with ports/types for knowledge document metadata, search query, search result, evidence pack, taxonomy, and index state.
- [x] 3.2 Implement filesystem discovery for Markdown files under `knowledge/` without reading `repos/`.
- [x] 3.3 Implement YAML frontmatter parsing with clear validation errors and no runtime dependency on Obsidian.
- [x] 3.4 Implement taxonomy loading for modules, aliases, intents, and source types.
- [x] 3.5 Implement module routing from taxonomy aliases, module keywords, related terms, and user keywords.
- [x] 3.6 Implement MVP keyword search over title, related terms, headings, and Markdown body.
- [x] 3.7 Implement metadata filters for module, intent, source_type, status, visibility, and product_versions.
- [x] 3.8 Implement ranking using source_type weight, confidence, active status, freshness, and keyword match density.
- [x] 3.9 Implement bounded evidence pack creation with coverage counts and safe excerpts.
- [x] 3.10 Add tests for FAQ hit, runbook hit, glossary-only low-confidence hit, deprecated document handling, no-hit search, and bounded result limits.
- [x] 3.11 Implement source document metadata loading for files under `knowledge/_sources/`.
- [x] 3.12 Implement parent slice parsing for whitepaper Markdown generated from PDF or other long-form sources.
- [x] 3.13 Implement derived evidence chunk loading from `knowledge/indexes/chunks.jsonl`.
- [x] 3.14 Implement fallback chunk generation from parent slices when `chunks.jsonl` is missing or marked dirty.
- [x] 3.15 Ensure chunk hits expand to parent slice context before Evidence Judge receives the evidence pack.
- [x] 3.16 Add tests for source document provenance, parent slice parsing, chunk-to-parent expansion, and index rebuild from parent slices.
- [x] 3.17 Implement source directory ingest for `.docx` and Markdown whitepaper files, including source copy, sha256 metadata, parent slice generation, chunk generation, and `ingest-report.json`.
- [x] 3.18 Add tests that `knowledge init --source-dir <path>` imports the two local whitepaper files into searchable parent slices.

## 4. Agent Config and Runtime Workflow

- [x] 4.1 Add `src/agents/knowledge-router.md` with role, responsibility, input contract, output contract, allowed dependencies, and no direct final-reply authority.
- [x] 4.2 Add `src/agents/evidence-judge.md` with structured output and code escalation rules.
- [x] 4.3 Add `src/agents/case-curator.md` with solved case draft rules and default metadata constraints.
- [x] 4.4 Register `knowledge_router`, `evidence_judge`, and `case_curator` stages in `src/agents/registry.json`.
- [x] 4.5 Extend runtime event recording with knowledge routing, knowledge search, evidence judge, code escalation, and curation phases.
- [x] 4.6 Wire runtime so knowledge search runs after Experience Agent miss and before Claude Code dispatch.
- [x] 4.7 Convert answerable knowledge evidence into a `DiagnosticResult` with `EvidenceKind: knowledge`.
- [x] 4.8 Route knowledge-derived results through existing Output Review and Presentation instead of replying directly.
- [x] 4.9 Preserve fallback to the existing Experience -> Preflight -> DiagnosticWorker -> Review -> Presentation flow when knowledge is disabled or absent.
- [x] 4.10 Run `pnpm typecheck` and focused runtime tests after workflow wiring.

## 5. Evidence Judge and Code Escalation

- [x] 5.1 Implement Evidence Judge local rules for answerable, confidence, need_code_escalation, reason, evidence, risks, missing_info, conflicts, and recommended_next_action.
- [x] 5.2 Require code escalation for logs, errors, table names, class names, interface paths, config keys, file paths, implementation detail questions, and current-code verification needs.
- [x] 5.3 Require code or human escalation for production incident, data repair, payment, permission, and security questions.
- [x] 5.4 Detect stale or conflicting knowledge documents and prevent high-confidence direct answers.
- [x] 5.5 Attach knowledge evidence summaries to `DiagnosticRequest.context` when escalating to Claude Code.
- [x] 5.6 Implement Deep Query Planner for clue-led static investigation requests with artifact targets, anchor terms, likely paths, and avoid-assumption guidance.
- [x] 5.7 Implement deterministic Query Correction for no-hit broadening, ambiguous-hit parent expansion, artifact family pivot, and final ask/escalate decisions.
- [x] 5.8 Add tests for direct FAQ answer, direct runbook answer, no-hit escalation, conflicting-doc escalation, stale-doc escalation, implementation-detail escalation, high-risk escalation, and query correction pivot.

## 6. Case Curator

- [x] 6.1 Define the trigger for user confirmation of resolution, either natural-language detection, explicit API action, or both.
- [x] 6.2 Build a curation input from current case messages, normalized question, module, intent, environment info, evidence, runs, claims, final reply, and user confirmation.
- [x] 6.3 Generate solved case Markdown using the required template sections.
- [x] 6.4 Save solved case drafts under `knowledge/tickets/solved-cases/<module-id>/`.
- [x] 6.5 Ensure generated solved cases default to `status: review_required` and `confidence: medium`.
- [x] 6.6 Mark `knowledge/indexes/dirty.flag` or equivalent index metadata after saving a solved case.
- [x] 6.7 Prevent unsupported facts from being written as root cause; preserve fact, inference, assumption, and unknown distinctions.
- [x] 6.8 Add tests for successful solved case generation, default metadata, missing evidence refusal or unresolved-case fallback, restricted visibility cases, and dirty index marking.

## 7. Gateway and Observability

- [x] 7.1 Keep gateway routes as transport-only code if adding APIs for knowledge health, templates, or case resolution.
- [x] 7.2 Extend `/api/logs` rendering to show knowledge router, search, judge, escalation, curation, and index dirty events.
- [x] 7.3 Extend session `agentActivity` derivation to include new Agent stages without breaking existing DTO fields.
- [x] 7.4 Add compatibility tests for existing `/api/chat`, `/api/session`, `/api/sessions`, `/api/settings`, and `/api/logs` response shapes.
- [x] 7.5 Run `pnpm test` after gateway or observability changes.

## 8. Evaluation Fixtures and Acceptance Tests

- [x] 8.1 Add a fixture FAQ that can be found and used as direct knowledge evidence.
- [x] 8.2 Add a fixture runbook that can be found and used as direct knowledge evidence.
- [x] 8.3 Add fixtures for stale, deprecated, and conflicting documents.
- [x] 8.4 Add a fixture user question that identifies module and intent from aliases.
- [x] 8.5 Add a fixture user question that must escalate to code due to endpoint or file path evidence.
- [x] 8.6 Add an end-to-end test that preserves existing Claude Code / CC worker behavior when knowledge is absent.
- [x] 8.7 Add an end-to-end test for solved case curation after user confirmation.
- [x] 8.8 Verify final replies mention evidence sources and do not present unsupported facts.
- [x] 8.9 Add a whitepaper PDF-derived fixture with source metadata, parent slice Markdown, and evidence chunks.
- [x] 8.10 Add an acceptance test where a query hits a chunk, expands to the parent slice, and cites the original source page.

## 9. Advanced Retrieval Preparation

- [x] 9.1 Keep the MVP search API stable enough to later swap ranking internals.
- [x] 9.2 Document how BM25 or inverted index can replace naive keyword ranking.
- [x] 9.3 Document how vector retrieval and hybrid search would attach scores to the existing evidence pack shape.
- [x] 9.4 Document how reranker and parent-child retrieval would preserve source document references.
- [x] 9.5 Document GraphRAG prerequisites without implementing GraphRAG in MVP.
- [x] 9.6 Document attachment方案中的 staged retrieval path: local files -> BM25/inverted index -> vector -> hybrid/RRF -> reranker -> parent-child -> GraphRAG.

## 10. Final Verification

- [x] 10.1 Run `pnpm lint`.
- [x] 10.2 Run `pnpm typecheck` after TypeScript changes.
- [x] 10.3 Run `pnpm build` after build-affecting changes.
- [x] 10.4 Run `pnpm test` after runtime, gateway, worker, session, agent, or knowledge behavior changes.
- [x] 10.5 Review final file layout to ensure gateway, runtime, agents, sessions, workers, observability, and knowledge ownership boundaries are preserved.
- [x] 10.6 Confirm this change is now implementation scope and runtime edits preserve module ownership boundaries.
