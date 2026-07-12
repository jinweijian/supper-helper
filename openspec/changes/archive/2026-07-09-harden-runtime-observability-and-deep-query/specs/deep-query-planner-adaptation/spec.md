## ADDED Requirements

### Requirement: Artifact targets SHALL be driven by knowledge module candidates
The deep query planner SHALL infer artifact targets primarily from `route.moduleCandidates` via a `module → artifactTargetFamily` mapping table, falling back to regex-based inference only when module candidates are empty.

#### Scenario: Module candidate maps to artifact target family
- **WHEN** `route.moduleCandidates` contains `marketing-theme`
- **THEN** the inferred artifact targets SHALL include `template`, `widget`, and `config` (not the generic `service` fallback)

#### Scenario: Module candidate maps to service-oriented family
- **WHEN** `route.moduleCandidates` contains `ai-companion`
- **THEN** the inferred artifact targets SHALL include `service` and `config`

#### Scenario: Empty module candidates fall back to regex inference
- **WHEN** `route.moduleCandidates` is empty
- **THEN** the planner SHALL fall back to the existing regex-based `inferArtifactTargets` logic, with `service` as the final fallback

#### Scenario: Code escalation signals supplement module candidates
- **WHEN** `route.codeEscalationSignals` contain terms matching known artifact families
- **THEN** those families SHALL be merged with module-candidate-derived targets, deduplicated

### Requirement: Likely paths SHALL adapt to project type metadata
The deep query planner SHALL select `likelyPaths` patterns based on a project-type field from knowledge workspace metadata, with `generic` as the default type preserving existing `src/**` patterns.

#### Scenario: Symfony project type uses web/themes and app/config paths
- **WHEN** the knowledge workspace metadata declares project type `symfony`
- **THEN** `likelyPathsFor(['template'])` SHALL return patterns like `web/themes/**/*.twig`, `app/config/**/*.yml`, `src/Bundle/**/*.php` instead of `src/**/*template*`

#### Scenario: Node project type uses src and lib paths
- **WHEN** the knowledge workspace metadata declares project type `node`
- **THEN** `likelyPathsFor(['service'])` SHALL return patterns like `src/**/*service*`, `lib/**/*service*`

#### Scenario: Generic project type preserves existing behavior
- **WHEN** the knowledge workspace metadata is absent or declares `generic`
- **THEN** `likelyPathsFor` SHALL return the existing `src/**` patterns, preserving backward compatibility

#### Scenario: Missing project type metadata does not block planning
- **WHEN** the knowledge workspace metadata does not include a project type field
- **THEN** the planner SHALL default to `generic` and proceed without error

### Requirement: Anchor terms SHALL filter 2-gram noise and keep semantic terms
The deep query planner SHALL filter `anchorTerms` to remove 2-gram sliding-window noise (e.g., "销主", "题中", "中关"), keeping only meaningful Chinese terms (length ≥ 2 with semantic value) or English identifiers.

#### Scenario: 2-gram noise is filtered out
- **WHEN** `route.keywords` contains 2-gram sliding-window results like `["营销", "销主", "主题", "题中", "中关", "关闭"]`
- **THEN** the resulting `anchorTerms` SHALL exclude "销主", "题中", "中关" and SHALL retain "营销", "主题", "关闭"

#### Scenario: Glossary terms are whitelisted
- **WHEN** the knowledge glossary contains a term that would otherwise be filtered
- **THEN** that term SHALL be retained in `anchorTerms` regardless of the 2-gram filter

#### Scenario: Anchor terms are not duplicated in constraints verbatim
- **WHEN** the planner builds `DiagnosticRequest.constraints` with the "优先使用 anchor terms" line
- **THEN** the constraints SHALL list only filtered semantic anchor terms, not the raw 2-gram list

### Requirement: Deep query plan shape SHALL separate semantic fields from legacy fields
The `DiagnosticRequest.context.deepQuery` SHALL expose `artifactTargets`, `likelyPaths`, and `anchorTerms` as semantic structures, with legacy array shapes retained only for backward-compatible read of old cases.

#### Scenario: New case uses semantic deep query shape
- **WHEN** the runtime creates a new `DiagnosticRequest` with deep query context
- **THEN** `deepQuery.likelyPaths` SHALL be an object keyed by project type (e.g., `{type: "symfony", patterns: [...]}`) or a typed array, not a raw `string[]` of `src/**` patterns

#### Scenario: Legacy case with raw likelyPaths array remains readable
- **WHEN** a case JSON created before this change contains `deepQuery.likelyPaths: string[]`
- **THEN** the runtime SHALL read it as legacy data without error but SHALL NOT use it as runtime input for new planning
