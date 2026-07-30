## ADDED Requirements

### Requirement: Historical-case model stages SHALL be registered product Agents
The system SHALL define Evidence Source Planner, Historical Case Analyzer, Current Evidence Assessor, and Historical Case Verifier behavior documents under `src/agents/` and pair each runtime stage through `registry.json`.

#### Scenario: Runtime initializes case-investigation services
- **WHEN** Runtime resolves a historical-case model stage
- **THEN** it SHALL load the corresponding centralized Agent config through `resolveAgentConfig`

#### Scenario: Agent registry is exposed
- **WHEN** the sanitized Agent settings endpoint or UI lists Agent roles
- **THEN** it SHALL include the four historical-case Agent identities, stages, summaries, and responsibilities
- **AND** it SHALL not expose prompt content, secrets, Redmine configuration, or model reasoning

### Requirement: Historical-case Agents SHALL not produce user-facing text
Every historical-case Agent registry entry MUST set `mayProduceUserFacingText=false`; only the existing reviewed Presentation boundary may produce the final wording.

#### Scenario: Analyzer or verifier returns model output
- **WHEN** a historical-case Agent returns valid structured JSON
- **THEN** Runtime SHALL treat it as internal planning or verification data
- **AND** it SHALL not store that JSON as a helper message

### Requirement: Historical-case Agent activity SHALL retain true actor identity
Agent-owned lifecycle events SHALL include the responsible historical-case Agent identity, while Redmine MCP and Worker operations SHALL remain labeled as tool/worker activity.

#### Scenario: Source planning is recorded
- **WHEN** Evidence Source Planner starts or completes
- **THEN** the diagnostic event SHALL identify the Evidence Source Planner Agent

#### Scenario: Redmine search is recorded
- **WHEN** Runtime calls the Redmine MCP search tool
- **THEN** the diagnostic event SHALL use the MCP actor
- **AND** it MUST NOT masquerade as a product Agent event

