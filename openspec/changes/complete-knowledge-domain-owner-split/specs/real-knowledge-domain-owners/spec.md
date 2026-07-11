## ADDED Requirements

### Requirement: Knowledge rules and IO have distinct owners
Quality, extraction, slicing, repair, publish, vector, and frontmatter capabilities SHALL separate pure rules/contracts from filesystem and provider-facing orchestration.

#### Scenario: Quality gate is imported
- **WHEN** a consumer imports the quality gate owner
- **THEN** it does not load the complete audit implementation or filesystem report IO through a reverse export

### Requirement: Knowledge artifact behavior is preserved
Real owner migration SHALL preserve existing chunk, manifest, vector, quality report, repair plan, review record, and published document shapes.

#### Scenario: Fixture pipeline runs before and after split
- **WHEN** the same sources complete ingest, audit, publish, index, and retrieve
- **THEN** schema-significant artifact fields and retrieval grounding are equivalent

### Requirement: Shared contracts are capability-scoped
Domain, config, and knowledge types SHALL be split into capability-focused contract files while public aggregators contain no implementation behavior.

#### Scenario: Provider config type is consumed
- **WHEN** a provider or settings module imports its config contract
- **THEN** it need not import unrelated Case, UI, or knowledge pipeline types

### Requirement: Implementation size and reachability are enforced
Production TS/Vue implementation files SHALL remain at or below 300 lines unless an explicit reviewed exception documents responsibility, reason, and production tests.

#### Scenario: Oversized unapproved implementation is added
- **WHEN** the boundary scan finds an implementation file above the limit without a registered exception
- **THEN** lint or tests fail with the path and line count

### Requirement: End-to-end local pipeline is mandatory
Structural completion SHALL be proven by a real temporary-directory pipeline using production services and no external network.

#### Scenario: Full local pipeline acceptance
- **WHEN** fixture sources are ingested, audited, approved, published, indexed, and queried
- **THEN** the final evidence identifies the published parent and source provenance through the new owners
