## 1. Baseline and Boundary Tests

- [x] 1.1 Run the current focused test baseline for embedding, knowledge, runtime, CLI, and gateway compatibility.
- [x] 1.2 Add import-boundary tests that assert `knowledge` does not import `providers`, `runtime` does not import provider factories, and root `cli.ts` does not import business modules.
- [x] 1.3 Add provider-boundary tests that assert rerank files do not live under an embedding provider directory.
- [x] 1.4 Add CLI command-routing tests that capture existing command names, key flags, exit code behavior, and representative output for `knowledge`, `embedding test`, `rerank test`, `status`, `doctor`, and server commands.
- [x] 1.5 Add retrieval behavior tests for BM25-only recall, embedding-only recall, multi-strategy fusion, strategy disablement, single-strategy failure fallback, and optional rerank.

## 2. Provider Module Split

- [x] 2.1 Create `src/providers/errors.ts`, `src/providers/redaction.ts`, and `src/providers/http.ts` with safe provider primitives moved from the existing embedding module.
- [x] 2.2 Create `src/providers/embedding/contract.ts`, `factory.ts`, `smoke-test.ts`, `fake.ts`, and `siliconflow/` adapter/protocol/endpoint files.
- [x] 2.3 Create `src/providers/rerank/contract.ts`, `factory.ts`, `smoke-test.ts`, `fake.ts`, and `siliconflow/` adapter/protocol/endpoint files.
- [x] 2.4 Update `src/embedding/index.ts` to re-export compatible embedding and rerank provider APIs from `src/providers/` during migration.
- [x] 2.5 Update provider tests to import through compatibility exports first, then add direct provider-module tests for the new boundaries.
- [x] 2.6 Run `pnpm typecheck`, `pnpm build`, and `node --test test/embedding.test.mjs`.

## 3. Knowledge Local Artifact Boundary

- [x] 3.1 Split local knowledge artifact helpers into `src/knowledge/indexes/chunks.ts`, `keyword-index.ts`, `bm25-index.ts`, and `vector-index.ts` while preserving existing exported paths and artifact shapes.
- [x] 3.2 Keep document discovery, frontmatter parsing, taxonomy routing, health, and pipeline behavior inside `knowledge` without importing provider modules.
- [x] 3.3 Remove RAG-specific provider types such as `KnowledgeRagSearchQuery` from `src/knowledge/types.ts`.
- [x] 3.4 Keep compatibility exports in `src/knowledge/index.ts` for existing callers until retrieval migration is complete.
- [x] 3.5 Run `node --test test/knowledge.test.mjs test/knowledge-vector.test.mjs test/quality-fixtures.test.mjs`.

## 4. Retrieval Service and Strategies

- [x] 4.1 Create `src/retrieval/types.ts`, `recall/contract.ts`, `registry.ts`, `trace.ts`, and `service.ts`.
- [x] 4.2 Implement `retrieval/recall/keyword/strategy.ts` as a compatibility strategy matching current keyword search behavior.
- [x] 4.3 Implement `retrieval/recall/bm25/tokenizer.ts`, `scorer.ts`, and `strategy.ts` using local chunks or BM25 artifacts.
- [x] 4.4 Implement `retrieval/recall/embedding/strategy.ts` and `vector-search.ts` using the embedding provider contract and compatible vector artifacts.
- [x] 4.5 Implement `retrieval/fusion/rrf.ts`, `dedupe.ts`, and `normalize.ts` for strategy-neutral candidate fusion.
- [x] 4.6 Implement `retrieval/rerank/service.ts` using the rerank provider contract after fusion.
- [x] 4.7 Implement `retrieval/evidence-pack.ts` to convert retrieval candidates into the existing `KnowledgeEvidencePack` shape.
- [x] 4.8 Move `searchKnowledgeWithRag` behavior out of `knowledge/indexer.ts` into retrieval and leave a temporary compatibility wrapper if existing tests require it.
- [x] 4.9 Run `node --test test/retrieval.test.mjs test/knowledge.test.mjs`.

## 5. Runtime Integration

- [x] 5.1 Create `src/runtime/knowledge-diagnosis.ts` to own knowledge route, retrieval service call, Evidence Judge handoff, direct-answer result construction, and code-escalation context attachment.
- [x] 5.2 Create `src/runtime/worker-turn.ts` for worker dispatch, follow-up run creation, and Deep Query retry/pivot behavior currently embedded in `diagnostic-runtime.ts`.
- [x] 5.3 Create `src/runtime/agent-model-review.ts` for model preflight and model review helpers currently embedded in `diagnostic-runtime.ts`.
- [x] 5.4 Reduce `src/runtime/diagnostic-runtime.ts` to turn coordination, queue serialization, case persistence calls, and delegation to focused runtime helpers.
- [x] 5.5 Ensure runtime no longer imports embedding/rerank provider factories or vendor adapters.
- [x] 5.6 Run runtime-focused tests from `test/supper-helper.test.mjs`, including knowledge direct answer, escalation, deep query retry, restricted knowledge, and async same-case turns.

## 6. CLI Command Refactor

- [x] 6.1 Create `src/cli/main.ts` and make root `src/cli.ts` a thin shebang compatibility wrapper.
- [x] 6.2 Rename or add command files using `command-*` prefix: `command-server.ts`, `command-status.ts`, `command-doctor.ts`, `command-knowledge.ts`, `command-retrieval.ts`, `command-provider.ts`, `command-config.ts`, and `command-accept.ts`.
- [x] 6.3 Move existing server/status/doctor command exports to the new file names while preserving `src/cli/index.ts` compatibility exports.
- [x] 6.4 Move knowledge command parsing and output from `src/cli.ts` into `command-knowledge.ts`, delegating business behavior to knowledge service APIs.
- [x] 6.5 Add `command-retrieval.ts` for `retrieval search` and `retrieval debug`, delegating to retrieval service.
- [x] 6.6 Move `embedding test` and `rerank test` into `command-provider.ts`, delegating to provider smoke tests.
- [x] 6.7 Move `init`, `model set`, `workspace set`, and `mcp add` into `command-config.ts`.
- [x] 6.8 Move `accept knowledge` into `command-accept.ts` while preserving acceptance report behavior.
- [x] 6.9 Run CLI-focused tests and representative spawn tests for existing commands.

## 7. Gateway and Settings Boundary Cleanup

- [x] 7.1 Move settings config merge, secret application, model smoke, embedding smoke, rerank smoke, and public settings orchestration behind a settings service outside route handlers.
- [x] 7.2 Keep gateway settings routes limited to body parsing, service calls, status codes, and response serialization.
- [x] 7.3 Ensure `/api/settings`, `/api/settings/model/test`, `/api/settings/embedding/test`, `/api/settings/rerank/test`, and `/api/agents` response shapes remain compatible.
- [x] 7.4 Run settings and public API compatibility tests.

## 8. Documentation and Verification

- [x] 8.1 Update `docs/standards/module-boundaries.md` with the `knowledge`, `retrieval`, `providers`, `runtime`, and `cli/command-*` ownership rules.
- [x] 8.2 Update `docs/architecture/overview.md` with the multi-strategy retrieval flow and provider directory layout.
- [x] 8.3 Update any README or command documentation that references old CLI internals while keeping user-facing commands unchanged.
- [x] 8.4 Run `pnpm lint`.
- [x] 8.5 Run `pnpm typecheck`.
- [x] 8.6 Run `pnpm build`.
- [x] 8.7 Run `pnpm test`; if sandbox blocks local HTTP listening, rerun with approved local test permissions and record the reason.
