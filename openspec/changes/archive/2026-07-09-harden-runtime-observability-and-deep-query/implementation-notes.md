# Implementation Notes

## 2026-06-28 Local Hardening Slice

Completed a locally verifiable slice of `harden-runtime-observability-and-deep-query`.

Implemented:

- Redacted and bounded `model_preflight_result.detail.raw` in `src/runtime/event-recorder.ts`.
- Redacted `raw_output.detail.stdout` in `workerTrace`.
- Replaced duplicated diagnostic/knowledge evidence payloads in audit decision events with `evidenceIds` and decision summary fields while retaining `knowledge_search_result` as the evidence dictionary event.
- Added `preflightKnowledgeAnswer` and called it on the knowledge direct-answer path so direct answers also emit `preflight_decision`.
- Documented runtime event phases in `docs/standards/development.md`.
- Added Deep Query module-to-artifact target mapping, project-type path hints, filtered anchor terms, and `projectType` propagation through knowledge code escalation.
- Added glossary document term extraction so Deep Query anchor filtering can preserve glossary-defined short business terms.
- Added log-block evidence ID lookup from the `knowledge_search_result` dictionary without duplicating full evidence objects in persisted decision events.
- Added operations-persona redaction for internal `knowledge/_sources/whitepapers/...` paths while preserving developer-facing technical paths.
- Migrated root model/preflight/storage implementations into owner modules with deprecated root re-exports:
  - `src/providers/model/adapter.ts`
  - `src/providers/model/smoke-test.ts`
  - `src/runtime/preflight-decision.ts`
  - `src/sessions/file-memory-store.ts`
- Moved production importers to owner paths while preserving legacy public import compatibility.
- Added `src/knowledge/health-service.ts` so gateway DTO/routes no longer own knowledge health + configured retrieval composition.
- Added `src/workers/default-worker-factory.ts` and injected the worker factory into `GatewayApplicationContext` so gateway context no longer directly constructs `ClaudeCodeWorker`.
- Documented Deep Query module/project-type behavior in `docs/architecture/overview.md`.
- Documented OpenSpec-scoped deprecation re-export rules in `docs/standards/module-boundaries.md`.
- Reviewed `AGENTS.md`; no update was needed because its existing module-boundary rules already match the owner-path/deprecation transition.

Contract tests added in `test/runtime-hardening.test.mjs` cover:

- model preflight raw redaction and bounding
- worker raw stdout redaction
- evidence ID references for knowledge answer/review logs
- full evidence object persistence only in `knowledge_search_result`
- log-block evidence ID lookup from the search dictionary
- legacy logs with embedded evidence detail still render
- unknown phase fallback rendering
- module-driven Deep Query artifact targets
- `symfony` project type path hints and `generic` fallback
- anchor noise filtering and glossary preservation
- glossary term extraction from glossary knowledge documents
- documented runtime event phases
- runtime `knowledge.projectType` propagation
- operations/developer persona behavior for internal whitepaper source paths
- root deprecation re-export import compatibility
- gateway knowledge health / worker construction boundary checks

Verification run during this slice:

- `pnpm build && node --test test/runtime-hardening.test.mjs`
- `node --test test/runtime-hardening.test.mjs test/supper-helper.test.mjs`
- `node --test test/runtime-hardening.test.mjs test/module-boundaries.test.mjs test/supper-helper.test.mjs`

## 2026-07-09 Structural Split Follow-Up

Completed the public entrypoint split for the deferred oversized files:

- `src/ui.ts` now re-exports through `src/ui/index.ts`, with `src/ui/main-screen.ts` as the render owner and UI boundary files under `src/ui/`.
- `src/setup-ui.ts` now re-exports `src/ui/setup-screen.ts`, with setup UI boundary files under `src/ui/`.
- `src/knowledge/quality.ts` now re-exports through `src/knowledge/quality/index.ts`, with audit/report/gate/chunk-map boundary files.
- `src/onboarding/service.ts` now stays a thin compatibility entrypoint and re-exports the service implementation through onboarding service boundary files.
- `src/runtime/event-recorder.ts` now re-exports through `src/runtime/event-recorder/index.ts`, with phase-group boundary files under `src/runtime/event-recorder/`.

Also added `src/redaction.ts` as the neutral secret-redaction owner. `src/providers/redaction.ts` remains a provider-facing compatibility export, while observability and runtime logging consume the neutral helper directly.

Contract tests added in `test/module-boundaries.test.mjs` cover:

- split source file presence
- original facade thinness
- old and new public exports resolving to the same symbols
- byte-for-byte `renderApp()` and `renderSetupApp()` output compatibility
- observability avoiding provider-owned redaction imports

## Deferred Scope / Follow-Up Debt

Additional oversized files to feed into later OpenSpec changes:

- `src/knowledge/types.ts`
- `src/runtime/evidence-judge.ts`
- `src/knowledge/repair.ts`
- `src/knowledge/extract.ts`
- `src/knowledge/publish.ts`
- `src/runtime/case-curator.ts`
- `src/onboarding/runner.ts`
- `src/knowledge/vector-index.ts`
- `src/knowledge/slicer.ts`
- `src/knowledge/templates.ts`
- `src/runtime/knowledge-acceptance.ts`
- `src/knowledge/ingest.ts`
- `src/config.ts`
- `src/knowledge/frontmatter.ts`
- `src/runtime/retrieval-evaluation.ts`

Follow-up tasks:

- Remove deprecation re-export compatibility shims one minor version after root migrations land and consumers have moved to owner paths.
