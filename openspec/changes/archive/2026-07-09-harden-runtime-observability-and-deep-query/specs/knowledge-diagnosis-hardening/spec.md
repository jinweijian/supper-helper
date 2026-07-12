## MODIFIED Requirements

### Requirement: Deep Query retry and pivot
The system SHALL support bounded retry and deterministic query correction when the first code escalation does not produce sufficient evidence. The deep query plan SHALL be driven by knowledge module candidates and project-type metadata, with 2-gram noise filtered from anchor terms, replacing the legacy regex-only and hardcoded `src/**` path assumptions.

#### Scenario: Attempt state attached
- **WHEN** runtime escalates from knowledge to Claude Code
- **THEN** `DiagnosticRequest.context.deepQuery` includes attempt number, max attempts, module-driven artifact targets, filtered anchor terms, project-type-adapted likely paths, tried queries, failed reasons, and correction actions

#### Scenario: Module candidates drive artifact targets
- **WHEN** `route.moduleCandidates` contains a known module such as `marketing-theme` or `ai-companion`
- **THEN** the deep query artifact targets SHALL be derived from a `module → artifactTargetFamily` mapping table, not from hardcoded regex alone

#### Scenario: Project type adapts likely paths
- **WHEN** the knowledge workspace metadata declares a project type such as `symfony` or `node`
- **THEN** `deepQuery.likelyPaths` SHALL use project-type-specific path patterns (e.g., `web/themes/**/*.twig` for symfony) instead of hardcoded `src/**` patterns

#### Scenario: Anchor terms filter 2-gram noise
- **WHEN** `route.keywords` contains 2-gram sliding-window results such as "销主", "题中", "中关"
- **THEN** the deep query `anchorTerms` SHALL exclude those noise terms and SHALL retain only meaningful Chinese terms or English identifiers

#### Scenario: One safe retry
- **WHEN** the first worker result is partial, has insufficient evidence, or Output Review requests continued diagnosis and correction actions remain
- **THEN** runtime may dispatch one follow-up `DiagnosticRequest` with a pivoted deep query while preserving the same Claude session and read-only constraints

#### Scenario: Scheduler pivot
- **WHEN** the first attempt targets scheduler artifacts and finds no scheduler evidence
- **THEN** Query Correction pivots toward queue, callback, state machine, or state update artifacts before asking the user

#### Scenario: Route pivot
- **WHEN** the first attempt targets route artifacts and finds only endpoint evidence without implementation cause
- **THEN** Query Correction pivots toward controller, service, repository, or config artifacts

#### Scenario: Retry stops safely
- **WHEN** max attempts are reached, high-risk escalation is required, or the next step requires user-provided runtime context
- **THEN** runtime stops retrying and returns a reviewed partial, ask-user, or human-escalation result

#### Scenario: Legacy deep query shape remains readable
- **WHEN** a case JSON created before this change contains `deepQuery.likelyPaths: string[]` of `src/**` patterns
- **THEN** the runtime SHALL read it as legacy data without error but SHALL NOT use it as runtime input for new planning
