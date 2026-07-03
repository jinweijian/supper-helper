## 1. Dependency Freeze And RED Baseline

- [x] 1.1 Record the implementation baseline: commit `7486b9d`, current statuses of `harden-runtime-retrieval-grounding`、`harden-conversation-evidence-lifecycle` and `upgrade-hybrid-parent-child-retrieval`, plus a fresh full test count. Do not start shared-source edits while another change is actively modifying the same files. Completion evidence: `implementation-notes.md` distinguishes completed code gates from blocked real-source/provider migration tasks.
- [x] 1.2 Add/retain characterization tests for the optimized production path before deletion: field tokenizer/BM25 weights、Parent-Child boundaries、40/40→20→8 budgets、metadata pre-filter、parent grounding、answer span、strict Judge、retrieval trace and resolved-turn behavior. Completion evidence: focused tests pass on the baseline and will detect a simplified replacement.
- [x] 1.3 Add forbidden-surface RED tests in `test/module-boundaries.test.mjs` for `src/embedding/`、compatibility/legacy retrieval、keyword recall、knowledge indexer search exports、root aliases、CLI aliases and old Knowledge query commands. Completion evidence: tests fail for the intended currently existing files/symbols/imports, including dynamic/barrel/generated paths.
- [x] 1.4 Lock current HTTP/UI、config、SecretRef、case JSON and knowledge-health response fixtures before source migration. Completion evidence: gateway/onboarding/session/settings/log/health compatibility tests pass before implementation and are not rewritten to accept shape drift.

## 2. Canonical Retrieval Consumer Migration

- [x] 2.1 Migrate taxonomy and local term rules from `knowledge/indexer.ts` to `knowledge/documents/terms.ts`; add focused deterministic tests for Chinese business terms、registered single-character terms、Latin tokens、punctuation and empty input. Completion evidence: pure term module imports no retrieval/provider/runtime/artifact code.
- [x] 2.2 Refactor `buildKnowledgeHealthSummary` and `gateway/routes/knowledge-routes.ts` to await configured retrieval for query checks while preserving the public health DTO. Completion evidence: initialized、empty、dirty、no-hit、provider-disabled and safe-provider-failure tests execute production configured retrieval.
- [x] 2.3 Refactor `runtime/knowledge-acceptance.ts` to call `prepareKnowledgeDiagnosis` or the production retrieval evaluation service instead of `searchKnowledge`. Completion evidence: acceptance reports distinguish retrieval hit from strict direct eligibility and legacy/incomplete evidence stays investigation-only.
- [x] 2.4 Refactor `cli/command-retrieval.ts` so `retrieval search`、`retrieval debug` and `retrieval eval` all use configured retrieval/runtime evaluation. Completion evidence: tests fail on the current BM25-only `createRetrievalService({ strategies: [createBm25RecallStrategy()] })` wiring and pass after the command reports configured trace/fallback behavior.
- [x] 2.5 Remove `knowledge search` and old query-evaluation `knowledge eval` registration、usage text、`package.json` aliases and old docs; keep `retrieval search|debug|eval` as the only query/debug/eval commands. Completion evidence: CLI tests prove canonical commands work, removed commands have no hidden handler, and knowledge ingestion/vector/migration/publish commands still work.
- [x] 2.6 Migrate or delete `src/knowledge/eval.ts`、`KnowledgeEval*` exports and old knowledge/judge/retrieval tests from `searchKnowledge*` to canonical BM25/Hybrid/strict-grounding entrypoints. Delete tests whose only assertion is compatibility API existence/equality. Completion evidence: coverage still proves filtering、ranking、no-hit、quality/provenance and escalation through production composition.

## 3. Delete Retrieval And Provider Compatibility Code

- [x] 3.1 Remove `includeKeywordCompatibility` from `retrieval/registry.ts`, delete `retrieval/recall/keyword/`, and remove keyword strategy exports. Completion evidence: registry contains one lexical strategy (field-weighted BM25) plus optional embedding, and Hybrid characterization remains green.
- [x] 3.2 Delete `retrieval/compatibility-search.ts`、`retrieval/legacy-rag.ts` and all `searchKnowledge`、`searchKnowledgeWithRag`、`KnowledgeRagSearchQuery`、compatibility keyword declarations/exports. Completion evidence: static/dynamic/import/export scan is empty and typecheck finds no caller.
- [x] 3.3 Remove `knowledge/indexer.ts`; export discovery and index-build APIs directly from their owner modules through `knowledge/index.ts`. Completion evidence: `src/knowledge/` has no reverse dependency on retrieval and no ranking/RAG behavior.
- [x] 3.4 Delete `src/embedding/` and migrate all tests/imports to `providers/embedding` or `providers/rerank`. Completion evidence: no `dist/embedding` declaration/import exists and provider fake-fetch、error、redaction、dimension and smoke tests stay green.
- [x] 3.5 Audit provider/retrieval/knowledge barrels for duplicate ownership after deletion. Completion evidence: each exported symbol has one canonical owner and no barrel reintroduces a deleted path under another name.

## 4. Delete Root And CLI Aliases

- [x] 4.1 Migrate gateway application context/chat typing and runtime worker typing from `agent.ts`/`claude-worker.ts` to `DiagnosticRuntime`、`DiagnosticWorker` and `ClaudeCodeWorker` owner modules. Completion evidence: production gateway/runtime tests pass with aliases physically absent.
- [x] 4.2 Migrate CLI/tests from `server.ts` to `gateway/http-server.ts`, and migrate tests from `SuperHelperAgent` to the canonical runtime/composition entry. Completion evidence: tests exercise the same server/runtime construction as production, not a test-only wrapper.
- [x] 4.3 Delete `src/agent.ts`、`src/server.ts`、`src/claude-worker.ts` and unused root `src/index.ts`; retain only `src/cli.ts` as the root executable entry. Completion evidence: package metadata/build declarations have no dependency on deleted roots.
- [x] 4.4 Delete `cli/doctor-command.ts`、`server-commands.ts` and `status-command.ts`; callers import `command-*` directly. Completion evidence: CLI routing tests and filesystem gates pass.

## 5. Preserve Hybrid, Evidence And Migration Safety

- [x] 5.1 Run focused Parent-Child/Hybrid/retrieval-grounding/runtime-eval suites after each deletion group. Completion evidence: tokenizer、weights、chunk metadata、budgets、filters、scores、trace and strict eligibility show no behavioral diff beyond removed APIs/commands.
- [x] 5.2 Run conversation evidence lifecycle tests after root/runtime import migration. Completion evidence: resolved-turn context、experience rejection、deterministic review、worker failure presentation and final reply validation remain unchanged.
- [x] 5.3 Audit the active Hybrid migration surface and confirm this change did not alter chunks/vector manifests、legacy markers、migration reports、review queues、quality eligibility or blocked/not-run statuses. Completion evidence: diff audit lists zero unauthorized artifact/schema/task completion changes.
- [x] 5.4 Keep default providers disabled/fake; do not run or mark real SiliconFlow/source-review/holdout tasks complete without explicit environment and evidence. Completion evidence: implementation notes preserve upstream blockers honestly.

## 6. Policy And Architecture Documentation

- [x] 6.1 Update `AGENTS.md` and `docs/standards/module-boundaries.md`: remove mandates to preserve old source facades; define one canonical path and require consumer、owner、expiry、migration task and boundary test for any future exception. Completion evidence: no rule asks developers to keep deleted aliases.
- [x] 6.2 Update `docs/standards/development.md` and `docs/architecture/overview.md` with the current Parent-Child/Hybrid/strict-evidence path, canonical entrypoints and source-vs-data migration distinction. Completion evidence: no current-architecture section mentions embedding compatibility、legacy RAG、keyword compatibility or deleted root/CLI aliases.
- [x] 6.3 Update README/package command examples to advertise only `retrieval search|debug|eval` for query/debug/evaluation; preserve knowledge ingestion、vector build、audit、review、publish and migration-report commands. Completion evidence: docs lint passes and stale-command scan excludes archived historical artifacts only.

## 7. Anti-Fake-Complete Audit / 回头重新思考

- [x] 7.1 Trace real runtime、health、acceptance and retrieval CLI calls through route/configured retrieval/Hybrid/strict Judge/resolved-turn; prove no old implementation survives under a neutral rename and no production assertion passes only through mocks. Feed gaps back into artifacts before completion.
- [x] 7.2 Scan filesystem、static/dynamic imports、barrels、package scripts、generated declarations、tests and docs for deleted paths/symbols/commands. Completion evidence: report is empty and boundary tests demonstrably fail when one alias is temporarily reintroduced.
- [x] 7.3 Audit optimized behavior: filters still run before vector similarity/remote submission, parent provenance reaches Judge, provider failure keeps BM25/trace, and no-hit/ineligible evidence cannot direct answer. Completion evidence: production fixtures pass with no threshold/budget relaxation.
- [x] 7.4 Audit privacy/defaults: tests and commands do not network、spend money、use real credentials、write real knowledge workspaces or expose secrets/raw vectors/full documents/unbounded conversations. Record real opt-in as not required and upstream real validation as blocked/not-run where applicable.
- [x] 7.5 Compare external/persisted contracts fixture-for-fixture and inspect active migration files/status. Completion evidence: HTTP/UI/config/case/source/artifact behavior is preserved; only private imports and unshipped duplicate commands intentionally break.

## 8. Verification And Evidence

- [x] 8.1 Fill `implementation-notes.md` with baseline、RED/GREEN commands、deleted surfaces、production-path traces、behavior-preservation evidence、upstream blockers、deviations and remaining risks. Completion evidence: no completed item remains `Pending`.
- [x] 8.2 Run `openspec validate remove-internal-compatibility-surfaces --strict`、`openspec status --change remove-internal-compatibility-surfaces --json`、`pnpm lint`、`pnpm typecheck` and `pnpm build`. Completion evidence: required commands exit 0 and exact output is recorded.
- [x] 8.3 Run focused module-boundary、provider、Hybrid、retrieval-grounding、runtime-eval、conversation-evidence、knowledge、CLI and gateway tests, then `pnpm test`. Completion evidence: zero failures with no network or real credentials.
- [x] 8.4 Start Dashboard locally with isolated `--home`、loopback and `--no-open`; verify `/api/health`、`/api/config`、`/api/knowledge/health` and `/setup`, then stop cleanly. Completion evidence: HTTP status/body and process exit are recorded.
