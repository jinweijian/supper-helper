# Implementation Notes

## Baseline And Dependencies

- Code baseline: `7486b9d feat: 强化知识检索与会话证据链路`.
- Pre-edit baseline: `pnpm test` passed with `247/247` offline tests.
- `harden-runtime-retrieval-grounding`: already complete; this change preserved configured retrieval envelopes, strict Judge and production retrieval eval.
- `harden-conversation-evidence-lifecycle`: already complete and being archived/synced outside this change; resolved-turn behavior stayed covered by conversation lifecycle tests.
- `upgrade-hybrid-parent-child-retrieval`: offline code path remains complete, while real source review/publish, SiliconFlow opt-in and real holdout remain blocked/not-run upstream. This change did not claim or modify those real validation tasks.

## Intentional Breaks And Preserved Contracts

| Area | Expected | Actual Evidence |
| --- | --- | --- |
| Private TypeScript imports/aliases | Removed atomically | Removed root aliases, CLI aliases, old embedding facade, legacy retrieval files and old knowledge search/eval files. Boundary tests verify physical absence. |
| `knowledge search/eval` duplicate CLI | Removed; use retrieval commands | `test/cli-routing.test.mjs` proves removed commands exit without hidden handlers and `retrieval debug` uses configured trace. |
| `retrieval search/debug` composition | Uses configured retrieval, not BM25-only service | `src/cli/command-retrieval.ts` now uses `createConfiguredRetrievalService`; boundary test rejects manual BM25-only wiring. |
| HTTP/UI response shapes | Preserved | Full gateway/session/UI tests pass, including public API response shape and knowledge health endpoints. |
| Config/SecretRef/case JSON | Preserved | Settings, onboarding secrets, session store and case store tests pass; no config or case JSON schema changes. |
| Canonical knowledge source | Preserved | Knowledge pipeline, quality, publish, migration-report and vector tests pass with existing artifact schemas. |
| Parent-Child/vector/quality/migration artifacts | Unchanged by this change | Hybrid, vector compatibility, migration report and quality fixtures pass; no artifact schema edits were made. |
| Legacy eligibility | Remains fail closed/investigation-only | Strict Judge, old chunk grounding and runtime escalation tests pass; non-grounded or stale evidence cannot direct answer. |

## RED / GREEN Evidence

| Area | RED | GREEN |
| --- | --- | --- |
| Forbidden source surfaces | Added tests failed against existing `src/embedding/`, legacy retrieval, keyword recall and alias files before deletion. | `test/module-boundaries.test.mjs` passes and scans `src`, `dist`, current docs, README, AGENTS and package scripts. |
| Canonical health/acceptance retrieval | Existing health/acceptance paths still referenced old knowledge search names before migration. | Health receives configured retriever injection; acceptance calls `prepareKnowledgeDiagnosis`; runtime acceptance tests pass. |
| Retrieval CLI consolidation | RED CLI test failed while `knowledge search` still routed and `retrieval debug` lacked configured embedding trace. | CLI tests prove `retrieval debug` reports configured BM25/embedding/rerank trace and removed knowledge commands fail. |
| `retrieval search/debug` configured path | Boundary test rejected manual `createRetrievalService({ strategies: [createBm25RecallStrategy()] })` wiring. | Command now uses `createConfiguredRetrievalService`; boundary and retrieval tests pass. |
| Root/CLI aliases | Files existed and imports still targeted `dist/agent.js`, `dist/server.js`, `dist/claude-worker.js` and `dist/cli/index.js`. | Tests import owner modules directly; alias files are deleted and clean build emits no stale declarations. |
| Hybrid/grounding behavior preservation | Baseline characterization already covered BM25 weights, parent-child grounding, budgets and strict Judge. | Focused Hybrid/grounding/runtime-eval tests and full `pnpm test` pass. |
| Conversation evidence preservation | Baseline conversation lifecycle tests protected resolved-turn and review behavior. | Focused conversation evidence lifecycle tests pass after root/runtime import migration. |

## Production Path Evidence

- Runtime -> configured Hybrid -> strict Judge -> resolved turn: `test/supper-helper.test.mjs`, `test/retrieval-grounding.test.mjs`, `test/runtime-retrieval-eval.test.mjs` and `test/conversation-evidence-lifecycle.test.mjs` pass.
- Knowledge health -> configured retrieval: `buildKnowledgeHealthSummary` accepts an injected configured retriever; gateway/session/CLI callers provide `createConfiguredKnowledgeRetriever(config)`.
- Knowledge acceptance -> production diagnosis/evaluation: `runKnowledgeAcceptance` is async and calls `prepareKnowledgeDiagnosis`; acceptance smoke remains isolated from the real knowledge workspace.
- `retrieval search|debug|eval` -> configured production composition: CLI uses configured retrieval for search/debug and runtime retrieval evaluation for eval.
- Gateway/CLI -> canonical server/runtime/worker owners: production and tests import `DiagnosticRuntime`, `startServer` and `ClaudeCodeWorker` from owner modules.

## Deleted Surfaces

- Deleted source directories/files: `src/embedding/`, `src/retrieval/compatibility-search.ts`, `src/retrieval/legacy-rag.ts`, `src/retrieval/recall/keyword/`, `src/knowledge/indexer.ts`, `src/knowledge/eval.ts`.
- Deleted private root aliases: `src/agent.ts`, `src/server.ts`, `src/claude-worker.ts`, `src/index.ts`.
- Deleted CLI aliases/barrel: `src/cli/doctor-command.ts`, `src/cli/server-commands.ts`, `src/cli/status-command.ts`, `src/cli/index.ts`.
- Deleted commands/scripts: `knowledge search`, old `knowledge eval`, and `knowledge:eval`.
- Removed old symbols: `searchKnowledge*`, `KnowledgeRagSearchQuery`, `KnowledgeEval*`, keyword compatibility declarations and keyword recall exports.

## Upstream Migration Safety

- Parent-Child/chunks/vector manifest schema diff: no schema changes; Hybrid/vector/migration tests pass.
- Legacy marker/eligibility diff: no eligibility relaxation; old chunks remain readable but cannot invent grounding.
- Migration report/review queue diff: migration-report and review/publish tests pass; no active migration status was changed.
- Real source/SiliconFlow/holdout task status: not run by design. Default tests use fake/fixture providers and disabled remote providers; real validation remains explicit opt-in upstream.

## Anti-Fake-Complete Audit

- Production composition versus mock-only coverage: runtime, health, acceptance and retrieval CLI all route through configured retrieval or production runtime evaluation; tests include gateway and CLI execution, not only direct unit mocks.
- Static/dynamic import, barrel, package, declaration and docs scan: empty for deleted paths/symbols/commands across `src`, clean `dist`, current docs, README, AGENTS and `package.json` (historical `docs/archive/superpowers/**` snapshots excluded).
- Hybrid budgets/filters/grounding/strict Judge regression: focused tests cover 40/40 recall, Top 20 rerank input, Top 8 final budget, metadata prefilters, parent provenance and fail-closed evidence.
- Privacy/defaults: verification uses disabled/fake providers, temporary workspaces and no real credentials; smoke dashboard used isolated `--home` and loopback.
- External/persisted contracts: public HTTP routes, UI snapshots, config, SecretRef, session/case persistence and knowledge artifacts stayed compatible; only private imports and duplicate unshipped commands intentionally break.

## Verification Evidence

| Gate | Command | Result |
| --- | --- | --- |
| OpenSpec strict validation | `openspec validate remove-internal-compatibility-surfaces --strict` | Exit 0, `Change 'remove-internal-compatibility-surfaces' is valid` |
| OpenSpec status | `openspec status --change remove-internal-compatibility-surfaces --json` | Exit 0, schema `spec-driven`, artifacts done |
| Lint | `pnpm lint` | Exit 0, docs lint passed |
| Typecheck | `pnpm typecheck` | Exit 0 |
| Build | `pnpm build` | Exit 0, clean `dist` rebuild |
| Focused tests | `node --test test/module-boundaries.test.mjs test/providers.test.mjs test/embedding.test.mjs test/hybrid-retrieval.test.mjs test/retrieval-grounding.test.mjs test/runtime-retrieval-eval.test.mjs test/conversation-evidence-lifecycle.test.mjs test/knowledge.test.mjs test/judge-fixtures.test.mjs test/retrieval.test.mjs test/cli-routing.test.mjs test/fs-routes.test.mjs test/onboarding-http.test.mjs test/supper-helper.test.mjs` | Exit 0, `201/201` |
| Full tests | `pnpm test` | Exit 0, `243/243` |
| Local Dashboard smoke | spawned `node dist/cli.js dashboard --home <tmp> --bind loopback --port 0 --no-open` | Exit 0 after SIGTERM; `/api/health`, `/api/config`, `/api/knowledge/health`, `/setup` all returned `200` |

## Deviations And Remaining Risks

- Additional private barrel `src/cli/index.ts` was deleted because it only preserved internal command alias imports and caused stale `dist/cli/index.js` usage in tests.
- `knowledge/health` no longer imports retrieval directly; callers inject a configured retriever so knowledge remains free of retrieval/provider ownership.
- Full test count changed from `247` to `243` because old compatibility existence/equality tests were removed with the private APIs they covered.
- Historical `docs/archive/superpowers/**` planning snapshots still mention old paths; current architecture scans exclude that archive-like history and current docs no longer advertise old entrypoints.
- Real SiliconFlow/source-review/holdout validation remains not run without explicit credentials/environment; no task in this change depends on it.
