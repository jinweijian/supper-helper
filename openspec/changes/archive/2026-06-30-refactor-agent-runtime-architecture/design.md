## Context

The project already documents a strong agent model: super helper owns context, Claude Code is a diagnostic tool, every turn passes through a Preflight Gate, worker output is structured, and the Agent reviews evidence before replying to the user. The implementation does not yet mirror those concepts as stable code boundaries.

Current pressure points:

- `src/agent.ts` owns user-turn lifecycle, case creation, persona handling, preflight, model preflight, request building, worker dispatch, follow-up dispatch, result review, presentation, event logging, and several utility policies.
- `src/server.ts` owns HTTP routing, settings mutation, model connectivity tests, session serialization, log formatting, and direct agent construction.
- `src/claude-worker.ts` owns the worker interface, Claude CLI process execution, session locking, prompt generation, tool policy, output parsing, and failure-to-result conversion.

OpenClaw's relevant lesson is not to copy its exact surface area, but to make the runtime architecture explicit: gateway/transport, agent runtime, sessions, model providers, tools/capabilities, and plugins/adapters are separate layers with clear contracts. For super helper MVP, this should be a bounded refactor that preserves CLI, HTTP API, storage shape, and chat behavior.

## Goals / Non-Goals

**Goals:**

- Turn the documented agent concepts into code-level modules with explicit ownership.
- Make a user turn understandable as a runtime pipeline: receive input, load session, preflight, build request, dispatch run, review evidence, present reply, persist events.
- Separate pure decision logic from side effects such as file storage, HTTP responses, model calls, and child processes.
- Keep the current MVP behavior stable while extracting boundaries.
- Create seams for future MCP tool adapters, queue-backed workers, multiple channels, and multiple agent profiles.
- Improve testability by giving preflight, request building, worker parsing, review, presentation, session persistence, and route serialization independent tests.

**Non-Goals:**

- Do not implement the full OpenClaw Gateway, WebSocket protocol, channel routing, plugin marketplace, or multi-agent broadcast model in this change.
- Do not change the current CLI commands or local HTTP endpoints.
- Do not migrate the case storage format unless a later implementation task explicitly requires a backward-compatible migration.
- Do not introduce new external dependencies for the architecture refactor.
- Do not change the Claude Code safety posture; the first pass remains read-oriented and behavior-preserving.

## Decisions

### 1. Use a runtime core plus ports/adapters

The refactor should introduce a `runtime` layer that owns the diagnostic turn pipeline and depends on ports for storage, model access, worker execution, configuration lookup, and event recording.

Target shape:

```text
src/runtime/
  diagnostic-runtime.ts
  turn-runner.ts
  request-builder.ts
  preflight-gate.ts
  review-gate.ts
  presenter.ts
  ports.ts

src/sessions/
  case-repository.ts
  file-case-repository.ts
  context-builder.ts

src/workers/
  diagnostic-worker.ts
  claude/
    claude-code-worker.ts
    claude-cli.ts
    claude-prompts.ts
    claude-output-parser.ts
    claude-policy.ts

src/gateway/
  http-server.ts
  routes/
    chat-routes.ts
    session-routes.ts
    settings-routes.ts
    log-routes.ts
  dto.ts

src/observability/
  diagnostic-events.ts
  log-blocks.ts
```

Alternative considered: keep `SuperHelperAgent` as the main class and only move helper functions into files. That would reduce file length but leave ownership unclear. The runtime-plus-ports model makes dependencies visible and matches the agent architecture the docs already describe.

Alternative considered: copy OpenClaw's full Gateway/runtime/plugin directory model now. That is too large for this MVP and would mix architecture cleanup with product expansion.

### 2. Treat the current HTTP server as a lightweight gateway

The current local HTTP server should become `gateway/http-server.ts`. It should parse requests, call application services, and serialize responses. It should not make preflight decisions, build log blocks inline, mutate model provider data directly, or know Claude-specific worker details.

This mirrors the OpenClaw idea that a gateway owns transport and routing while the agent runtime owns the agent turn. For MVP, "gateway" means HTTP routes only; WebSocket and external chat channels remain future work.

### 3. Keep session context owned by super helper

The session layer should expose a repository-style port for cases, messages, runs, and events. The runtime uses that port; worker adapters never become long-term memory owners.

The existing `FileMemoryStore` can become the first adapter behind this repository. The storage shape may remain the same, but the API should move away from scattered direct `addLogEvent` calls inside every branch of the agent pipeline. A small event recorder can translate runtime phase events into persisted `DiagnosticLogEvent` records.

Alternative considered: keep `FileMemoryStore` as the direct dependency everywhere. That preserves behavior but keeps storage coupled to orchestration and makes future database or multi-tenant storage harder.

### 4. Split diagnostic worker contract from Claude CLI mechanics

The stable worker port should remain close to the current interface:

```ts
interface DiagnosticWorker {
  diagnose(request: DiagnosticRequest): Promise<DiagnosticWorkerResponse>;
}
```

Claude-specific concerns should move behind the adapter:

- CLI argument construction
- read-only tool policy
- session lock/retry
- prompt generation
- stdout/stderr capture
- output parsing
- failure-to-`DiagnosticResult` conversion

This makes it possible to later add MCP-backed workers, queue workers, or mock workers without changing the runtime pipeline.

### 5. Separate model provider access from agent policy

The runtime should depend on a model provider port for model-driven preflight and review. Prompt construction and JSON parsing for model preflight/review should live near the runtime gate that uses it, not in the transport layer or worker adapter.

The existing `OpenAICompatibleModelClient` can stay as the first provider adapter. Provider selection should be resolved during runtime construction, not inside every turn branch.

### 6. Make review and presentation explicit

Evidence review and user-facing presentation are currently interleaved. They should become separate steps:

- Review gate: validates whether the worker result can support a final, partial, ask-user, or escalation outcome.
- Presenter: turns the reviewed outcome into a persona-aware user-facing reply.

The model-driven review can still produce both outcome and reply, but the runtime should treat that as one review strategy behind a clear boundary. Rule-based fallback remains required.

### 7. Preserve behavior through staged migration

The first implementation pass should be extraction-first, not redesign-first:

1. Move route DTO/log helpers out of `server.ts`.
2. Move Claude prompt/parser/policy/process helpers out of `claude-worker.ts`.
3. Extract preflight/request-builder/context-builder/review/presentation helpers out of `agent.ts`.
4. Introduce `DiagnosticRuntime` as the orchestrator while keeping `SuperHelperAgent` as a compatibility facade.
5. Update tests around the new modules.
6. Only after compatibility tests pass, simplify or remove the old facade.

This order keeps behavior stable and gives rollback points after each module extraction.

## Risks / Trade-offs

- [Risk] The refactor may become a broad rewrite instead of an extraction. -> Mitigation: keep CLI, HTTP endpoints, storage shape, and test snapshots stable during the first pass.
- [Risk] New abstractions may be too generic for the MVP. -> Mitigation: introduce ports only where there is already a real boundary: storage, worker, model provider, event recording, transport.
- [Risk] Tests may overfit current strings and block safe extraction. -> Mitigation: add focused behavioral tests for decisions and contracts before moving presentation copy-heavy tests.
- [Risk] Runtime events could become duplicated or noisy. -> Mitigation: define stable phase names and centralize event recording in one module.
- [Risk] OpenClaw terminology could make the project feel larger than it is. -> Mitigation: use OpenClaw as a reference model, but keep super helper names and MVP scope.

## Migration Plan

1. Create the OpenSpec artifacts for the architecture contract.
2. Add contract tests for runtime behavior that must not change.
3. Extract pure helpers from `src/claude-worker.ts` into `src/workers/claude/*`.
4. Extract log block and route DTO helpers from `src/server.ts` into `src/gateway/*` and `src/observability/*`.
5. Extract request/context/review/presentation helpers from `src/agent.ts` into `src/runtime/*` and `src/sessions/*`.
6. Introduce `DiagnosticRuntime` and adapt `SuperHelperAgent` to delegate to it.
7. Run `pnpm test` after each extraction group.
8. Update `docs/architecture/overview.md` and `docs/architecture/agents.md` after the code structure exists.

Rollback strategy: each extraction should preserve public exports or keep a compatibility re-export. If a step fails, revert only that extraction group and keep previous groups that still pass tests.

## Open Questions

- Should the compatibility facade remain named `SuperHelperAgent` long-term, or should callers eventually depend directly on `DiagnosticRuntime`?
- Should log event phase names become a formal enum in `domain.ts`, or remain string-based to keep migration low-friction?
- Should settings/model mutation become its own application service in the first implementation pass, or stay in gateway routes until runtime extraction is complete?
- When MCP support becomes active, should MCP tools be worker adapters, runtime tools, or a separate capability registry injected into the runtime?
