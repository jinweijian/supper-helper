## ADDED Requirements

### Requirement: Root-level implementation files SHALL be migrated to owning modules
The implementation files `src/model.ts`, `src/preflight.ts`, `src/storage.ts`, and `src/model-smoke-test.ts` SHALL be migrated to their owning module directories (`src/providers/model/`, `src/runtime/`, `src/sessions/`, `src/providers/model/`), with deprecation re-exports at the original paths for one minor version.

#### Scenario: model.ts migrates to providers/model
- **WHEN** the migration is complete
- **THEN** `src/providers/model/adapter.ts` SHALL contain the `OpenAICompatibleModelClient` implementation, and `src/model.ts` SHALL contain only `export * from './providers/model/adapter.js'` with a `@deprecated` comment

#### Scenario: preflight.ts migrates to runtime
- **WHEN** the migration is complete
- **THEN** `src/runtime/preflight-decision.ts` SHALL contain the `preflight` and `isSafetyPermissionDecision` logic, and `src/preflight.ts` SHALL contain only a deprecation re-export

#### Scenario: storage.ts migrates to sessions
- **WHEN** the migration is complete
- **THEN** `src/sessions/file-memory-store.ts` SHALL contain the `FileMemoryStore` implementation, and `src/storage.ts` SHALL contain only a deprecation re-export

#### Scenario: Importers use new paths
- **WHEN** a developer updates an importer of a migrated file
- **THEN** the importer SHALL import from the new module path (`../providers/model/adapter.js`, `../runtime/preflight-decision.js`, `../sessions/file-memory-store.js`), not the deprecated root path

#### Scenario: Deprecation re-exports are removed after one minor version
- **WHEN** one minor version has passed since the migration
- **THEN** the root-level deprecation re-export files SHALL be deleted, and any remaining importers SHALL be updated to the new paths

### Requirement: Oversized files SHALL be split by responsibility boundary
The files `src/ui.ts` (2990 lines), `src/knowledge/quality.ts` (855 lines), `src/onboarding/service.ts` (806 lines), `src/runtime/event-recorder.ts` (683 lines), and `src/setup-ui.ts` (642 lines) SHALL be split into responsibility-bounded sub-modules, preserving public exports via aggregator index files.

#### Scenario: ui.ts splits by page region
- **WHEN** `src/ui.ts` is split
- **THEN** `src/ui/main-screen.ts`, `src/ui/setup-drawer.ts`, `src/ui/components.ts`, `src/ui/styles.ts` SHALL each own a page region, and `src/ui/index.ts` SHALL re-export the public rendering entry point with unchanged HTML string output

#### Scenario: knowledge/quality.ts splits by audit responsibility
- **WHEN** `src/knowledge/quality.ts` is split
- **THEN** `src/knowledge/quality/audit.ts`, `quality/report-io.ts`, `quality/gate.ts`, `quality/chunk-map.ts` SHALL each own one responsibility, and `src/knowledge/quality/index.ts` SHALL re-export the public API unchanged

#### Scenario: onboarding/service.ts splits by service concern
- **WHEN** `src/onboarding/service.ts` is split
- **THEN** `src/onboarding/draft-service.ts`, `review-service.ts`, `run-service.ts`, `secrets-service.ts` SHALL each own one concern, and `service.ts` SHALL remain a narrow composition entry

#### Scenario: event-recorder.ts splits by phase group
- **WHEN** `src/runtime/event-recorder.ts` is split
- **THEN** `src/runtime/event-recorder/{conversation,preflight,knowledge,review,curator,worker}.ts` SHALL each own a phase group, and `event-recorder/index.ts` SHALL aggregate the `CaseRuntimeEventRecorder` class with unchanged public methods

#### Scenario: Split preserves public exports
- **WHEN** any split is complete
- **THEN** the public exports of the original file SHALL remain available at the original import path, and `pnpm typecheck && pnpm test` SHALL pass without importer changes

### Requirement: Gateway SHALL NOT orchestrate retrieval or knowledge health business
The `src/gateway/dto.ts` and `src/gateway/routes/knowledge-routes.ts` SHALL NOT directly orchestrate `buildKnowledgeHealthSummary`, `createConfiguredKnowledgeRetriever`, `initKnowledgeWorkspace`, or `updateKnowledgeIndexWithQuality`; such orchestration SHALL be delegated to `knowledge` or `settings` service modules.

#### Scenario: DTO serialization delegates to knowledge health service
- **WHEN** `serializeSession` needs knowledge health summary
- **THEN** `src/gateway/dto.ts` SHALL call `src/knowledge/health-service.ts` and serialize the result, without directly importing `buildKnowledgeHealthSummary` or `createConfiguredKnowledgeRetriever`

#### Scenario: Knowledge route delegates to knowledge service
- **WHEN** a `/api/knowledge/health`, `/api/knowledge/bind`, or `/api/knowledge/reindex` handler runs
- **THEN** the handler SHALL call the corresponding `knowledge` service method and serialize the response, without inlining pipeline orchestration

#### Scenario: Gateway does not instantiate concrete worker
- **WHEN** `src/gateway/application-context.ts` assembles the runtime
- **THEN** it SHALL receive a `DiagnosticWorker` port instance via dependency injection, not directly `new ClaudeCodeWorker()`

#### Scenario: HTTP response shape remains compatible
- **WHEN** the gateway delegation is complete
- **THEN** the `/api/knowledge/*` response shapes SHALL remain unchanged, and existing compatibility tests SHALL pass
