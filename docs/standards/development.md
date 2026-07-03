# super helper Development Standards

This document is the mandatory development contract for `super helper`.

It exists because this project must behave like a real Agent AI system, not a pile of one-file-one-logic scripts. Future AI coding and human development must preserve the architecture created by the runtime refactor.

## Non-Negotiable Principle

Code must be organized by responsibility and contract.

`docs/standards/module-boundaries.md` 是更细的模块边界合同，负责分层、适配器结构、拆文件规则、CLI 边界，以及 provider / retrieval / knowledge 的职责分离。本文件仍是项目级开发规范；任何改动涉及模块归属或结构拆分时，编码前必须同时阅读这两个文件。

Do not add logic wherever it is convenient. Every change must first answer:

- Which module owns this responsibility?
- What public contract does it consume or expose?
- What tests prove that contract still works?
- Does this change require updating architecture, Agent design, or OpenSpec artifacts?

If the answer is unclear, pause and update the design before writing implementation code.

## Required Development Flow

For every feature, bug fix, or refactor:

1. Identify the affected responsibility: agents, gateway, runtime, sessions, worker, observability, UI, config, or docs.
2. Read the relevant module section in this document, `docs/standards/module-boundaries.md`, and `docs/architecture/overview.md`.
3. Keep compatibility entry points thin.
4. Add or update focused tests at the contract boundary.
5. Run the required verification commands.
6. Update docs when a public contract, module boundary, workflow, or developer rule changes.

For OpenSpec changes, implementation must follow the change artifacts. Do not invent a different design during coding without updating the OpenSpec design or tasks.

## Module Ownership Map

| Area | Owns | Must Not Own |
| --- | --- | --- |
| `src/gateway/` | HTTP server, routes, DTOs, request parsing, response serialization | Preflight, worker dispatch policy, evidence review, final reply formatting |
| `src/settings/` | Settings config merge, SecretRef application, public settings mapping, model/embedding/rerank smoke orchestration | HTTP request/response handling, provider vendor protocol implementation, runtime diagnosis decisions |
| `src/cli/` | CLI `main.ts` dispatch, `command-*` argument interpretation, server command composition, local status/doctor reporting, browser-open helper | HTTP route handling, provider implementations, retrieval strategy, runtime diagnosis decisions, knowledge indexing internals |
| `src/onboarding/` | Setup drafts, validation, run records, progress events, recovery, provider test orchestration, knowledge pipeline orchestration, config commit, local SecretRef storage | HTTP request parsing, product diagnostic runtime, provider adapter implementation, final user replies |
| `src/agents/` | Product Agent configuration documents and `registry.json` stage pairings | Runtime orchestration, HTTP routing, worker execution, persistence |
| `src/runtime/` | Agent turn orchestration, Preflight Gate, request building, review decisions, presentation, lifecycle event recording | HTTP APIs, route DTOs, raw file persistence details, Claude CLI implementation |
| `src/providers/` | Embedding/rerank provider contracts, provider factories, remote provider adapters, provider smoke tests, safe provider error normalization | Knowledge workspace indexing decisions, retrieval strategy, runtime orchestration, HTTP DTO parsing, final replies |
| `src/knowledge/` | Enterprise knowledge workspace schema, templates, Markdown/frontmatter parsing, source metadata, local indexes/artifacts, local vector artifact build/read/compatibility checks | Runtime orchestration, user-facing final replies, Claude Code execution, HTTP route decisions, remote provider API calls, retrieval ranking/rerank decisions |
| `src/retrieval/` | Multi-strategy recall, BM25/embedding recall strategies, candidate fusion, optional rerank, retrieval trace, evidence-pack conversion | User-facing final replies, Evidence Review decisions, HTTP DTO parsing, provider vendor protocol implementation, knowledge artifact writes |
| `src/sessions/` | Case repository ports, file-backed repository export, diagnostic context building | Worker execution, model calls, user-facing final replies |
| `src/workers/` | Diagnostic worker port and worker adapters | Case orchestration, user chat responses, route handling |
| `src/workers/claude/` | Claude prompts, CLI policy, CLI execution, output parsing, Claude adapter | Runtime decisions, user-facing review, HTTP behavior |
| `src/observability/` | Log block rendering and observability transformations | Runtime decisions, worker execution |
| `src/ui.ts` | Browser UI rendering and client-side interactions | Server routes, runtime decisions, worker behavior |
| `src/config.ts` | Config loading, defaults, provider/workspace settings | Runtime orchestration, route decisions |
| `src/domain.ts` | Shared domain types | Implementation behavior |

上表定义目录级 ownership。`docs/standards/module-boundaries.md` 定义目录内部和跨目录的拆分方式。当一个文件开始混合 contracts、factories、adapters、command output 和 business strategy 时，必须按该文档的拆分规则处理，不要继续往最近的文件里堆逻辑。

未来 RAG、hybrid retrieval、candidate fusion、query embedding orchestration、rerank orchestration 都属于 `src/retrieval/` 边界。新增 provider 能力必须进入 `src/providers/<capability>/`，不得继续加深 `src/knowledge/` 与远程 provider adapter 的耦合。

## Canonical Entry Points

The project avoids private compatibility facades. Internal consumers must import owner modules directly:

- Runtime orchestration from `src/runtime/diagnostic-runtime.ts`
- HTTP server startup from `src/gateway/http-server.ts`
- Claude worker adapter from `src/workers/claude/claude-code-worker.ts`
- Provider capabilities from `src/providers/embedding/` and `src/providers/rerank/`

Do not recreate root aliases or command aliases to preserve old private paths. If a public API needs compatibility, document it in OpenSpec with explicit consumers and tests.

## Runtime Contract

`src/runtime/diagnostic-runtime.ts` owns one user turn.

The runtime pipeline is:

```text
Gateway chat route
  -> DiagnosticRuntime.startUserTurn
  -> ResolvedTurnContext builder
  -> Preflight Gate
  -> Experience Agent
  -> Knowledge Router / Retrieval / Evidence Judge / RAG Answerability
  -> DiagnosticWorker port
  -> Result Validator / Review Gate
  -> Presentation / Presenter
  -> RuntimeEventRecorder
  -> CaseRepository
```

Synchronous chat and asynchronous chat must use the same runtime pipeline.

Rules:

- `handleUserMessage` may combine start and complete for synchronous API calls.
- `startUserTurn` may persist the user's message and initial lifecycle events.
- `completeUserTurn` must continue the same runtime pipeline, not duplicate alternate logic.
- `recordTurnFailure` handles async failure recording.
- Runtime code must create `DiagnosticRequest` through `request-builder.ts`.
- Runtime code must map worker output through `review-gate.ts` and `presenter.ts`.
- Runtime code must resolve product Agent configs through `src/agents/registry.json` using `src/runtime/agent-configs.ts`.
- Same-case async turns must be serialized so every accepted user message receives its own helper reply.

## Gateway Contract

Gateway code is transport code.

Route handlers may:

- validate method/path/body
- call runtime or repository methods
- call application services such as `src/settings/service.ts`
- serialize public DTOs
- return HTTP status codes
- compute response metadata such as context usage

Route handlers must not:

- decide whether a message should be dispatched
- construct Claude prompts
- call Claude worker directly
- review evidence
- format final diagnostic conclusions
- merge settings config, apply submitted secrets, or run provider/model smoke tests directly
- mutate case internals outside repository/runtime calls

Public response compatibility must be protected by tests for:

- `/api/chat`
- `/api/session`
- `/api/sessions`
- `/api/settings`
- `/api/settings/model/test`
- `/api/settings/embedding`
- `/api/settings/embedding/test`
- `/api/settings/rerank`
- `/api/settings/rerank/test`
- `/api/knowledge/health`
- `/api/knowledge/bind`
- `/api/knowledge/reindex`
- `/api/logs`

## Session and Persistence Contract

The case session is the source of long-term diagnostic context.

Rules:

- `FileMemoryStore` implements the repository boundary and preserves persisted case JSON shape.
- Session storage scoping belongs in `src/sessions/storage-scope.ts`; gateway/server startup may use the resolved path but must not invent its own workspace-directory naming logic.
- Different active workspaces must use isolated session storage by default. If this behavior changes, update the architecture docs and add compatibility tests.
- Knowledge storage scoping belongs in `src/knowledge/storage-scope.ts` and must use the same workspace-key strategy as session storage. Runtime and CLI code must not invent separate workspace-directory naming logic.
- New runtime code should depend on repository-style methods, not raw JSON files.
- `context-builder.ts` is the only place that constructs `DiagnosticRequest.context`.
- Do not let Claude Code own long-term memory.
- Do not mix cases, users, tenants, workspaces, or runs.

If persisted shape changes, add migration logic and tests.

## Worker Contract

Workers are tools, not Agents.

All worker adapters must implement the `DiagnosticWorker` port from `src/workers/diagnostic-worker.ts`.

Workers receive structured `DiagnosticRequest` and return structured `DiagnosticResult` plus trace. They must not write the final user reply.

Claude adapter rules:

- Prompt generation belongs in `claude-prompts.ts`.
- Read-only policy belongs in `claude-policy.ts`.
- CLI execution belongs in `claude-cli.ts`.
- Output parsing and failure conversion belong in `claude-output-parser.ts`.
- Adapter composition belongs in `claude-code-worker.ts`.

Host commands must remain constrained by `docs/standards/command-whitelist.md`.

## Knowledge Workspace Contract

`src/knowledge/` owns the local enterprise knowledge base skeleton.

Rules:

- Knowledge files live under the resolved knowledge workspace root, outside the inspected project workspace by default. The default configured base is `knowledge.rootDir`, scoped by workspace key, with the editable structure under `<resolved-root>/knowledge/`.
- The active project workspace remains the code/MCP inspection boundary. Do not create or require a `knowledge/` directory inside that project root unless an explicit knowledge root points there.
- Original PDFs and source files belong under `knowledge/_sources/`; they are provenance, not direct answer context.
- Structured Markdown parent slices under `knowledge/faq/`, `knowledge/runbooks/`, `knowledge/whitepapers/`, `knowledge/modules/`, `knowledge/glossary/`, and `knowledge/tickets/` are the canonical editable knowledge.
- `knowledge/indexes/chunks.jsonl`, `keyword-index.json`, and `manifest.json` are derived artifacts and must be rebuildable from parent slices.
- Optional vector artifacts live under `knowledge/indexes/vectors.jsonl`, `vector-manifest.json`, and `vector-build-report.json`. They are derived and must be rebuildable from `chunks.jsonl` plus embedding configuration.
- `src/knowledge/` may build/read vector artifacts and report compatibility, but remote embedding/rerank calls must go through `src/providers/`.
- Runtime knowledge retrieval must call `src/retrieval/` for BM25, embedding recall, fusion, and optional rerank. Do not add vector databases, GraphRAG, Obsidian runtime dependency, runtime vector retrieval, runtime rerank sorting, or model-based final-answer generation inside `src/knowledge/`.
- The knowledge module returns structured evidence packs. It must not produce user-facing final replies.
- Runtime integration must preserve the existing Evidence Review contract before any knowledge evidence reaches the user.

## Agent Evidence Contract

The Agent must not guess.

Product Agent configs live in `src/agents/`:

- `main.md`: main coordinator
- `input-review.md`: input review and Preflight Gate
- `experience.md`: prior-session answer reuse
- `output-review.md`: evidence review
- `presentation.md`: persona-aware final wording
- `registry.json`: stage-to-Agent pairing

Every final answer must pass evidence review:

- Facts require evidence IDs.
- Inferences must be labeled as inferences.
- Assumptions must be labeled as assumptions.
- Unknowns must stay visible.
- Unsupported fact-only conclusions must be blocked, downgraded, or converted into follow-up questions.
- Presentation must express frozen primary answer claim IDs; it must not choose the main answer with phrase lists or question-type enumerations.
- Presentation may only cite evidence IDs referenced by selected accepted claims, and the full visible reply must stay inside accepted claims/evidence/missingInfo. Validating only the first paragraph is not sufficient.
- When evidence is insufficient but accepted fact/inference claims remain, fallback replies must lead with a clearly labeled preliminary judgment and keep the evidence gap visible. A generic downgrade summary must not hide the useful accepted judgment.

Claude Code output is not user-facing until the runtime review step accepts it.

## Observability Contract

Lifecycle events are part of the product contract because the log drawer is the audit layer.

Event creation belongs in `src/runtime/event-recorder.ts`. Log drawer rendering belongs in `src/observability/log-blocks.ts`.

Agent events must include Agent identity metadata so the diagnostic log and loading state can show which Agent handled each step.

Preserve established phases unless a documented migration is added:

- `case_curator_result`
- `case_curator_started`
- `case_review_failed`
- `case_review_result`
- `case_review_started`
- `code_escalation_requested`
- `command`
- `conversation_started`
- `deep_query_pivot_selected`
- `deep_query_retry_requested`
- `deep_query_stopped`
- `diagnostic_request`
- `evidence_coverage_result`
- `evidence_coverage_started`
- `evidence_judge_result`
- `evidence_judge_started`
- `evidence_review_started`
- `evidence_validation_result`
- `experience_candidates_rejected`
- `experience_hit`
- `experience_miss`
- `experience_started`
- `follow_up_diagnostic_requested`
- `input_received`
- `input_review_started`
- `knowledge_answer_selected`
- `knowledge_retrieval_trace`
- `knowledge_router_result`
- `knowledge_router_started`
- `knowledge_search_result`
- `knowledge_search_started`
- `local_preflight_result`
- `model_preflight_failed`
- `model_preflight_overridden_by_local_dispatch`
- `model_preflight_result`
- `model_review_failed`
- `model_review_result`
- `persona_agent_result`
- `preflight_decision`
- `rag_answerability_result`
- `rag_answerability_started`
- `preflight_started`
- `presentation_agent_result`
- `raw_output`
- `resolution_confirmed`
- `turn_failed`
- `user_reply`

Do not scatter ad hoc log event objects through unrelated modules.

## Session Lifecycle Contract

Sessions may be pinned, archived, or deleted.

- Pinned sessions sort before unpinned sessions.
- Archived sessions remain readable but must reject new chat turns.
- Deleted sessions remove the local case file.
- Generic session titles should refresh from the first meaningful user message.

## Testing Contract

Tests should protect contracts, not implementation trivia.

Required coverage by change type:

- Gateway changes: route compatibility tests and response shape tests.
- Runtime changes: preflight, request building, review, presentation, sync/async pipeline tests.
- Agent config changes: registry resolution, `/api/agents`, and docs lint tests.
- Embedding changes: provider factory tests, fake-fetch provider tests, safe error/redaction tests, smoke helper tests, and no-network default test paths.
- Knowledge vector changes: fixture vector build tests, restricted-slice skip tests, manifest/report tests, and compatibility mismatch tests.
- Worker changes: prompt separation, read-only policy, CLI failure conversion, output parsing tests.
- Session changes: repository behavior and context builder tests.
- Observability changes: log block and drawer behavior tests.
- Public API changes: compatibility tests and docs updates.

Before claiming completion, run the strongest feasible verification:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Documentation Contract

Documentation is not optional architecture theater. It is the source of future coding constraints.

Update docs when changing:

- module boundaries
- runtime pipeline
- public API shape
- worker contracts
- persistence shape
- evidence/review rules
- command permissions
- Agent behavior
- OpenSpec workflow

Minimum docs to consider:

- `AGENTS.md`
- `AGENT.md`
- `docs/standards/development.md`
- `docs/architecture/overview.md`
- `docs/architecture/agents.md`
- `docs/prd/README.md`
- `docs/standards/command-whitelist.md`
- related OpenSpec change artifacts

## Anti-Patterns

Do not introduce these patterns:

- A route handler that grows into a mini Agent.
- A worker adapter that knows how to talk to the user.
- A runtime method that parses HTTP or renders DTOs.
- A storage module that calls models or workers.
- A UI event handler that encodes diagnostic decisions.
- A product Agent prompt/config outside `src/agents/`.
- A runtime stage-to-Agent pairing hardcoded outside `src/agents/registry.json`.
- A compatibility facade that becomes the real implementation again.
- A giant file containing gateway, runtime, worker, and presentation logic.
- A final answer generated directly from Claude output without Agent review.

When tempted to add quick logic in the nearest file, stop and route the responsibility to the correct module.
