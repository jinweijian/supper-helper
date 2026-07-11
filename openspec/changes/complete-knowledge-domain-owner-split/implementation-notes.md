# Implementation Evidence

## Structural baseline and RED

- RED: `pnpm build && node --test test/knowledge-domain-owner-reachability.test.mjs`; 4/4 failed for missing real Quality owners, oversized Knowledge implementations, mixed shared aggregators, and missing local acceptance.
- Initial in-scope giants included Quality audit 857, Knowledge types 639, Redmine 460, Repair 440, Extract 401, Publish 381, Vector 355, Domain 352, Frontmatter 330, Chunks 331, Slicer 321, Templates 320, Ingest 315, Config 361.
- `quality/gate.ts`, `report-io.ts`, and `chunk-map.ts` were reverse re-exports of the giant audit owner.
- Existing fixtures froze quality/source/extract/normalize/draft/repair/review/publish/chunk/manifest/vector/source metadata and config/Case shapes before migration.

## Quality owners

- Flow: audit discovery/orchestration → source rules → slice rules/heuristics → chunk rules → aggregation. Report IO, gate and chunk map are independent leaves.
- Lines: audit 90, source rules 119, slice rules 98, heuristics 53, chunk rules 47, aggregation 62, report IO 37, gate 24, chunk map 22, index 8.
- No focused owner imports or reverse-exports `audit.ts`; direct gate/report imports do not load the audit implementation.
- Quality report keys remain `version/workspaceRoot/knowledgeRoot/generatedAt/thresholds/inspected/stageSummaries/severityCounts/issueCounts/issues/recommendedActions/gate`.

## Pipeline owners and artifact compatibility

- Extract/normalize: 236/180 lines. Frontmatter parser/YAML/value validation/serializer: 59/32/44/21.
- Slicer/renderer: 208/117. Chunks/utils/contracts: 241/80/23. V2 legacy reads and V3 sentence-window tests pass.
- Repair executor/plan: 247/183. Publish/review: 264/119. Shared serializer preserves review/publish frontmatter bytes semantically.
- Vector service/utils: 269/92; fingerprint, stale artifact, V2/V3 and restricted-chunk tests pass.
- Ingest/naming: 295/22. Templates/catalog/examples: 198/107/17. Redmine card/mapping: 290/173.
- CLI and Onboarding continue importing stable Knowledge public symbols. Knowledge imports no Runtime/Gateway/Worker or remote provider adapter.

## Shared contracts

- `domain.ts` is a 3-line aggregator over base 84, case 27 and diagnostic 247.
- `config.ts` is a 4-line aggregator over contracts 86, defaults 106, IO 87 and resolution 89.
- `knowledge/types.ts` is a 3-line aggregator over core 172, pipeline 222 and artifact/retrieval 250.
- Public names and defaults remain compatible; full Provider/Settings/Runtime/Sessions/Onboarding/Knowledge compilation plus config atomic/default and legacy Case tests pass.

## Real local acceptance

- `pnpm acceptance:knowledge:local`: 1/1 passed, no network or credentials.
- A real temporary project/source/knowledge directory traversed production ingest → extract → normalize → slice → audit → approve → publish → keyword/chunk index.
- Observed one source and at least one draft, active published parent, indexed document and chunk.
- Production Retrieval returned the active parent with non-empty `source_document_id`, `source_block_ids` and `section_path`.
- The built production CLI audited the same workspace and returned the real report path. No full fixture source is stored here.

## Size exceptions

- All Knowledge/Domain/Config/Vue implementation owners are ≤300 lines. Largest in-scope implementation is Ingest at 295.
- The exact reviewed cross-change exceptions enforced by test and documented in design are: Runtime evidence judge 569, presenter 474, case curator 369, Onboarding runner 359, Runtime knowledge diagnosis 354, knowledge acceptance 348, retrieval evaluation 331.
- No other oversized file is accepted; templates were split instead of registered as a convenience exception.

## Anti-Fake-Complete audit

- Removing `quality/slice-rules.ts`, `knowledge/normalize.ts`, or `contracts/diagnostic.ts` independently makes production TypeScript compilation fail.
- Reverse giant and forbidden layer scans are clean.
- Generated artifacts were proven usable by a subsequent production retrieval; completion is not based on file existence.
- Full suites prove legacy config, Case, quality, chunk/vector, repair/review/publish and Redmine artifacts remain readable; no migration was introduced.
- Quality is reasonable because rules, aggregation and IO are independently replaceable. Pipeline is reasonable because transforms/helpers are separated from orchestration while stable public entries remain. Shared Contracts are reasonable because public aggregators contain no behavior.

## Final verification and risk

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed.
- `pnpm test`: 387/387 passed.
- `pnpm acceptance:knowledge:local`: 1/1 passed.
- Default verification is offline. Remaining structural risk is restricted to the seven exact reviewed exceptions; the gate prevents silent additions or growth.
- LAN remains intentionally unauthenticated for trusted-network testing and is unchanged.
