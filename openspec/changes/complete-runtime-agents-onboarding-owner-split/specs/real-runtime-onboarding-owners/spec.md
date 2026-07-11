## ADDED Requirements

### Requirement: Event phase owners contain real behavior
Each Event Recorder phase owner SHALL construct and record its own production events; marker constants and reverse exports to one giant implementation SHALL NOT satisfy the split.

#### Scenario: A phase owner is removed
- **WHEN** a required phase owner is absent or no longer imported by production aggregation
- **THEN** typecheck or the boundary suite fails

### Requirement: Onboarding services own distinct use cases
Draft, review, run, and secret services SHALL own their relevant validation and repository interactions, while the public facade only composes or delegates.

#### Scenario: Real onboarding HTTP workflow runs
- **WHEN** a draft is saved, validated, run, reviewed, retried, and committed through HTTP
- **THEN** production calls traverse the focused services and persisted state remains compatible

### Requirement: Main Agent contains only global coordination rules
The Main Agent configuration SHALL define identity, AnswerGoal ownership, global evidence/privacy constraints, and Case-scoped memory boundaries without duplicating stage-specific schemas or contradictory session policy.

#### Scenario: Agent docs lint runs
- **WHEN** runtime Agent configuration is validated
- **THEN** per-Case Claude reuse is stated consistently and stage contracts resolve from their registered configs

### Requirement: Structural completion is behavior-based
Boundary tests SHALL verify actual imports, exports, production reachability, and owner size rather than only checking file existence.

#### Scenario: One-line marker owner is introduced
- **WHEN** a claimed owner exports only an unused marker or re-exports a giant implementation
- **THEN** the module boundary test fails
