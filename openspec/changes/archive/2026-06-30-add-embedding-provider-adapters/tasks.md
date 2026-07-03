## 0. Mandatory Apply Workflow / 必须先执行的实施纪律

- [x] 0.1 Load and follow `openspec-apply-change`, `test-driven-development`, `systematic-debugging`, and `verification-before-completion`.
- [x] 0.2 Update `implementation-notes.md` with OpenSpec context, SiliconFlow official docs verification, the real embeddings smoke result, and each RED/GREEN checkpoint before marking tasks complete.
- [x] 0.3 Keep the implementation scoped: SiliconFlow is the only real provider; Gemini/Qwen/MiniMax/rerank are README extension notes or safe unsupported scaffolds.
- [x] 0.4 Preserve module boundaries: `src/embedding/` owns provider calls/errors/factory, `src/knowledge/` owns vector artifacts/compatibility, `src/config.ts` owns defaults/loading, and `src/cli.ts` parses/delegates.

## 1. Planning and Scope Update

- [x] 1.1 Read proposal, design, spec, tasks, development standards, technical architecture, agent design, `src/agents/README.md`, and `src/agents/main.md`.
- [x] 1.2 Record that this change excludes BM25, hybrid/RRF, runtime rerank sorting, GraphRAG, external vector DBs, and final-answer generation from embedding output.
- [x] 1.3 Record SiliconFlow official docs evidence for embeddings and rerank, including endpoint/auth/request/response/dimensions behavior.
- [x] 1.4 Run the real SiliconFlow embeddings smoke test with `.key` and record sanitized output only.

## 2. Provider Contract and SiliconFlow Adapter

- [x] 2.1 Write focused RED tests for default SiliconFlow config, provider factory, fake provider compatibility, SiliconFlow fake-fetch success, missing credentials, provider errors, malformed response, and dimension mismatch.
- [x] 2.2 Add `siliconflow` to the embedding provider contract and default config while keeping embedding disabled by default.
- [x] 2.3 Implement `SiliconFlowEmbeddingProvider` using configured `baseUrl` or `endpoint`, bearer auth, `model`, `input`, optional `dimensions`, batch splitting, timeout, safe error normalization, and usage aggregation.
- [x] 2.4 Keep MiniMax/Gemini/Qwen as unsupported/docs-required scaffolds or remove them from active factory behavior; do not implement real network calls for them.
- [x] 2.5 Add `runEmbeddingSmokeTest` and tests that it returns provider/model/dimensions/distance/ok/duration/safe error without raw vectors or secrets.

## 3. Knowledge Vector Artifacts

- [x] 3.1 Write focused RED tests for `chunks.jsonl` -> embedding input conversion, restricted chunk skip, vector JSONL output, vector manifest, build report, compatibility success, mismatch rebuild-required, absent artifacts, and stale text hash detection.
- [x] 3.2 Add vector paths/types for `vectors.jsonl`, `vector-manifest.json`, and `vector-build-report.json`.
- [x] 3.3 Implement `buildKnowledgeVectorIndex` using the provider factory path and ensure restricted chunks are not sent to the provider and raw chunk text is not persisted in reports.
- [x] 3.4 Implement vector artifact readers and compatibility checks.

## 4. CLI and Local Smoke

- [x] 4.1 Write focused RED CLI tests for `embedding test`, disabled embedding, fake provider success, SiliconFlow-safe output, `knowledge vector build`, invalid provider, and no raw vector/chunk text output.
- [x] 4.2 Add `super-helper embedding test` and `super-helper knowledge vector build` command routing with config values and per-command flag overrides.
- [x] 4.3 Add package scripts only if they wrap build + CLI and do not enter `pnpm test` real network paths.
- [x] 4.4 Run fake smoke and fake vector build fixture and record artifact paths/counts.

## 5. End-to-End Knowledge and Runtime Acceptance

- [x] 5.1 Run the provided `knowledge init` flow against `~/Documents/knowledge` and the configured knowledge root.
- [x] 5.2 Run `knowledge update`, `knowledge vector build`, and representative `knowledge search` queries to prove slicing/indexing artifacts exist.
- [x] 5.3 Run or extend acceptance to cover direct knowledge hit, no-hit Deep Query escalation, and implementation-detail escalation to the Claude Code worker request path with advisory code-search hints.
- [x] 5.4 Confirm `embedding.enabled: false` keeps keyword-only behavior and default commands do not call remote providers.

## 6. Documentation and Final Verification

- [x] 6.1 Update `docs/standards/development.md` and `docs/architecture/overview.md` for the `src/embedding/` and local vector artifact boundaries.
- [x] 6.2 Update README from zero setup through SiliconFlow key/config, embeddings smoke, knowledge init/update/vector build/search, service run, acceptance checks, and extension notes for rerank/Gemini/Qwen.
- [x] 6.3 Run `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, focused embedding tests, focused knowledge-vector tests, fake smoke, fake vector build, and OpenSpec status.
- [x] 6.4 Complete the anti-fake-complete audit in implementation notes and mark tasks only with matching evidence.
