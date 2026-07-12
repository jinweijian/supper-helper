## ADDED Requirements

### Requirement: Model chain-of-thought SHALL NOT be persisted in diagnostic logs
The runtime SHALL apply `redactProviderErrorMessage` and `slice(0, 2000)` to all model raw outputs before writing them into diagnostic log `detail.raw` fields, covering `modelPreflightResult`, `modelReviewResult`, and `raw_output` phases. The structured `parsed` field SHALL be the authoritative decision record.

#### Scenario: Model preflight raw output is redacted and truncated
- **WHEN** the input-review agent records a `model_preflight_result` log event
- **THEN** the `detail.raw` field SHALL be passed through `redactProviderErrorMessage` and truncated to at most 2000 characters, and `detail.parsed` SHALL contain the authoritative `{action, reason, missingInfo, resolvedTurn}` decision

#### Scenario: Model review raw output is redacted and truncated
- **WHEN** the output-review agent records a `model_review_result` log event
- **THEN** the `detail.raw` field SHALL be passed through `redactProviderErrorMessage` and truncated to at most 2000 characters, and `detail.parsed` SHALL contain the authoritative `{claimIds, evidenceIds}` decision

#### Scenario: Worker raw stdout is redacted
- **WHEN** the runtime records a `raw_output` log event from a worker trace
- **THEN** the `detail.stdout` field SHALL be passed through `redactProviderErrorMessage` before persistence

#### Scenario: Chain-of-thought text is stripped from logs
- **WHEN** a model raw output contains chain-of-thought text such as "Let me analyze the situation..." or "I need to think about..."
- **THEN** the redacted `detail.raw` SHALL NOT contain the full chain-of-thought; only bounded truncated text remains for troubleshooting

### Requirement: Evidence SHALL be stored once per case and referenced by ID thereafter
The runtime SHALL store the complete evidence pack only in the first phase that produces it (`knowledge_search_result`), and subsequent phases (`knowledge_answer_selected`, `evidence_review_started`, `preflight_decision`, `diagnostic_request`, `user_reply`) SHALL reference evidence by ID plus key decision fields only.

#### Scenario: Knowledge search result stores complete evidence pack
- **WHEN** the runtime records a `knowledge_search_result` log event
- **THEN** the `detail` SHALL contain the complete `KnowledgeEvidencePack` with all results, serving as the evidence dictionary for the case

#### Scenario: Subsequent phases reference evidence by ID only
- **WHEN** the runtime records `knowledge_answer_selected`, `evidence_review_started`, `preflight_decision`, `diagnostic_request`, or `user_reply` log events
- **THEN** the `detail` SHALL reference evidence via `evidenceIds: string[]` and SHALL NOT duplicate the full evidence objects

#### Scenario: Legacy case JSON with duplicated evidence remains readable
- **WHEN** a case JSON created before this change is loaded
- **THEN** the runtime and log renderer SHALL still read the legacy full-evidence fields without error, treating them as legacy compatibility data

### Requirement: Every dispatched turn SHALL record a preflight_decision phase
The runtime SHALL record a `preflight_decision` phase for both code-dispatch and knowledge-direct-answer paths, so the audit log shows an explicit decision point before downstream stages.

#### Scenario: Knowledge direct-answer path records preflight decision
- **WHEN** the evidence judge selects a knowledge-direct-answer path (no code escalation)
- **THEN** the runtime SHALL record a `preflight_decision` log event with `decision: "knowledge_answer"` (or equivalent) before recording `evidence_review_started`

#### Scenario: Code dispatch path records preflight decision
- **WHEN** the evidence judge requests code escalation
- **THEN** the runtime SHALL record a `preflight_decision` log event with `decision: "dispatch"` before recording `diagnostic_request`

### Requirement: User reply SHALL redact internal knowledge paths by persona
The presenter SHALL redact internal knowledge file paths in `user_reply` evidence citations according to user persona, exposing only business-readable source names for non-technical personas.

#### Scenario: Operations persona sees business-readable source names
- **WHEN** the `user_reply` is formatted for an `operations` persona
- **THEN** evidence citations SHALL display business-readable names (e.g., "EduSoho AI伴学助手用户使用指南") and SHALL NOT expose internal paths like `knowledge/_sources/whitepapers/src_1c0bc3610f76/...docx`

#### Scenario: Developer persona retains technical paths
- **WHEN** the `user_reply` is formatted for a `developer` persona
- **THEN** evidence citations MAY include technical source paths for debugging context

### Requirement: Phase definitions SHALL be documented and synchronized with implementation
The `development-standards.md` established phases list SHALL be synchronized with the actual phases defined in `event-recorder.ts`, and every phase recorded in a case log SHALL have a documented definition.

#### Scenario: Documented phases match implemented phases
- **WHEN** a developer reads `development-standards.md` "Preserve established phases" section
- **THEN** the list SHALL include all phases defined in `event-recorder.ts`, including `experience_*`, `knowledge_router_*`, `knowledge_search_*`, `evidence_judge_*`, `deep_query_*`, `case_review_*`, `case_curator_*`, and `knowledge_answer_selected`

#### Scenario: Unknown phase triggers fallback rendering
- **WHEN** the log renderer encounters a phase not in the documented list (e.g., a legacy phase in an old case)
- **THEN** the renderer SHALL fall back to a generic rendering with the phase name and summary, without error

#### Scenario: New phase requires documentation update
- **WHEN** a developer adds a new phase to `event-recorder.ts`
- **THEN** the `development-standards.md` phases list SHALL be updated in the same change, and a contract test SHALL verify the phase is documented
