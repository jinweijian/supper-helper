## 1. Baseline and Contract Tests

- [x] 1.1 Run the existing `pnpm test` suite and record the current pass/fail baseline before refactoring.
- [x] 1.2 Add focused tests for preflight decisions that must ask the user without dispatching a worker.
- [x] 1.3 Add focused tests for dispatchable workspace-aware user messages that must produce a structured `DiagnosticRequest`.
- [x] 1.4 Add focused tests for unsupported fact claims being blocked from final presentation.
- [x] 1.5 Add focused tests for `/api/chat`, `/api/session`, `/api/sessions`, `/api/settings`, `/api/settings/model/test`, and `/api/logs` response compatibility.

## 2. Worker Adapter Extraction

- [x] 2.1 Create `src/workers/diagnostic-worker.ts` with the stable diagnostic worker port and response types.
- [x] 2.2 Move Claude system/user prompt generation from `src/claude-worker.ts` into `src/workers/claude/claude-prompts.ts`.
- [x] 2.3 Move Claude read-only tool policy and host command allowlist checks into `src/workers/claude/claude-policy.ts`.
- [x] 2.4 Move Claude CLI process execution, bounded output capture, session busy retry, and shell command rendering into `src/workers/claude/claude-cli.ts`.
- [x] 2.5 Move Claude output parsing and failure-to-`DiagnosticResult` conversion into `src/workers/claude/claude-output-parser.ts`.
- [x] 2.6 Update `src/claude-worker.ts` to become a compatibility export or thin adapter wrapper.
- [x] 2.7 Add unit tests for Claude output parsing, disabled worker fallback, failed execution fallback, and read-only tool narrowing.

## 3. Gateway and DTO Extraction

- [x] 3.1 Create `src/gateway/http-server.ts` and move server startup and route composition out of `src/server.ts`.
- [x] 3.2 Move chat, session, settings, and log route handlers into separate files under `src/gateway/routes/`.
- [x] 3.3 Move public settings, session summary, session serialization, and model settings DTO helpers into `src/gateway/dto.ts`.
- [x] 3.4 Move diagnostic log block rendering helpers into `src/observability/log-blocks.ts`.
- [x] 3.5 Keep `src/server.ts` as a compatibility export for `startServer` until imports are migrated.
- [x] 3.6 Run route compatibility tests and the existing UI string tests after extraction.

## 4. Session and Runtime Boundary Extraction

- [x] 4.1 Create `src/sessions/case-repository.ts` with a repository-style port for cases, messages, runs, and log events.
- [x] 4.2 Adapt `FileMemoryStore` behind a file-backed repository without changing persisted case JSON shape.
- [x] 4.3 Move diagnostic request context construction into `src/sessions/context-builder.ts`.
- [x] 4.4 Create `src/runtime/ports.ts` for runtime dependencies including case repository, model client, worker, config lookup, and event recording.
- [x] 4.5 Move request creation and follow-up request creation into `src/runtime/request-builder.ts`.
- [x] 4.6 Move local/model preflight orchestration into `src/runtime/preflight-gate.ts`.
- [x] 4.7 Move evidence review decision logic into `src/runtime/review-gate.ts`.
- [x] 4.8 Move persona-aware reply formatting into `src/runtime/presenter.ts`.
- [x] 4.9 Add tests for each extracted runtime helper before wiring the full runtime.

## 5. Diagnostic Runtime Wiring

- [x] 5.1 Implement `src/runtime/diagnostic-runtime.ts` as the orchestrator for one user turn.
- [x] 5.2 Preserve `SuperHelperAgent` as a compatibility facade that delegates to `DiagnosticRuntime`.
- [x] 5.3 Wire gateway chat routes through the facade or runtime without embedding preflight, worker, review, or presentation decisions in route code.
- [x] 5.4 Centralize lifecycle event creation through an event recorder while preserving existing log phases and log drawer behavior.
- [x] 5.5 Verify synchronous and asynchronous chat flows use the same runtime pipeline.
- [x] 5.6 Run the full `pnpm test` suite and fix behavior-preserving regressions.

## 6. Documentation and Final Verification

- [x] 6.1 Update `docs/architecture/overview.md` with the implemented runtime, gateway, sessions, worker adapter, and observability layout.
- [x] 6.2 Update `docs/architecture/agents.md` to reference the concrete runtime modules backing Preflight, DiagnosticRequest, worker output contract, and Agent Review.
- [x] 6.3 Update README development notes if import paths or architecture overview changed.
- [x] 6.4 Run `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test`.
- [x] 6.5 Review the final file layout to ensure `src/agent.ts`, `src/server.ts`, and `src/claude-worker.ts` are thin facades or narrowly scoped modules.
