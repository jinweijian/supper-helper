## ADDED Requirements

### Requirement: Model SHALL select the historical-case investigation mode
After Preflight dispatches a turn, the system SHALL ask a schema-constrained model planner to select `fast_answer` or `case_investigation` from AnswerGoal, current case context, and configured source capabilities.

#### Scenario: Planner selects fast answer
- **WHEN** the planner returns a valid `fast_answer` decision
- **THEN** Runtime SHALL continue the existing Experience, Knowledge, generic MCP, and Worker fast path

#### Scenario: Planner selects case investigation
- **WHEN** the planner returns a valid `case_investigation` decision
- **THEN** Runtime SHALL enter the dedicated case-investigation pipeline
- **AND** code MUST NOT reclassify the decision through keyword, error-code, question-type, or language-specific trigger lists

### Requirement: Planner failure SHALL produce one bounded fallback
If the planner fails, times out, or returns an invalid schema, Runtime SHALL create one degraded plan that uses the resolved AnswerGoal as query and the workspace's complete configured historical project allowlist.

#### Scenario: Planner output is unavailable
- **WHEN** a historical source is configured and planner output is unavailable
- **THEN** Runtime SHALL execute Knowledge collection and at most one Redmine search
- **AND** candidate and detail limits SHALL remain 10 and 3
- **AND** the degraded plan MUST NOT increase conclusion confidence

#### Scenario: No historical source is configured
- **WHEN** planner output is unavailable and the workspace has no historical source
- **THEN** Runtime SHALL NOT attempt an MCP connection outside configured sources

### Requirement: Knowledge and Redmine SHALL collect in parallel
In case-investigation mode, Runtime SHALL start the Knowledge branch and the complete Redmine search-rerank-details branch concurrently and SHALL wait for both branches to settle before analysis.

#### Scenario: Redmine finishes before Knowledge
- **WHEN** the Redmine branch settles while Knowledge is still running
- **THEN** Runtime SHALL retain the Redmine outcome
- **AND** it SHALL NOT create the final helper reply until the collection barrier completes

#### Scenario: One source fails
- **WHEN** Knowledge or Redmine returns timeout or failure
- **THEN** Runtime SHALL preserve the distinct source status and evidence gap
- **AND** it SHALL continue with usable evidence from the other source
- **AND** it MUST NOT convert timeout or failure to no-hit

### Requirement: Redmine retrieval SHALL follow the ten-to-three protocol
Runtime SHALL request no more than 10 candidates, use a schema-constrained model selection to choose no more than 3 unique candidate IDs, and fetch details only for selected candidates under the same search grant.

#### Scenario: Model returns valid candidate IDs
- **WHEN** the model selects up to three unique IDs from the search candidates
- **THEN** Runtime SHALL pass exactly those IDs and the search ID to the detail tool

#### Scenario: Model returns invalid candidate IDs
- **WHEN** the model returns an unknown, duplicate, non-numeric, or over-limit selection
- **THEN** Runtime SHALL replace it with a deterministic bounded selection from the candidate set
- **AND** it SHALL NOT read an issue outside the search result

### Requirement: Historical analysis SHALL bind every conclusion to evidence IDs
The Historical Case Analyzer SHALL compare current claims, Knowledge, and selected Redmine details and SHALL return relations, candidate hypotheses, conflicts, historical action safety, and read-only verification checks with explicit evidence references.

#### Scenario: Analyzer proposes a historical relation
- **WHEN** the analyzer labels a case as possible same root cause, similar symptom, useful direction, or unrelated
- **THEN** every matched historical fact SHALL reference an existing Redmine evidence ID
- **AND** every current match SHALL reference an existing current claim or evidence ID

#### Scenario: Analyzer returns an unsafe or unbound plan
- **WHEN** the analyzer references an unknown evidence ID or requests a write operation
- **THEN** Runtime SHALL mark the analysis invalid
- **AND** it SHALL NOT dispatch that plan to the Worker

### Requirement: Model SHALL decide whether current Worker evidence is required
The Current Evidence Assessor SHALL decide whether the available current workspace/log evidence is sufficient for the requested diagnostic objective and SHALL request a Worker only through a valid read-only verification plan.

#### Scenario: Current evidence is sufficient
- **WHEN** the assessor returns `worker_not_needed` with valid current evidence
- **THEN** Runtime SHALL not dispatch the Worker

#### Scenario: Current evidence is insufficient
- **WHEN** the assessor returns `worker_needed` with valid expected-match and expected-mismatch checks
- **THEN** Runtime SHALL dispatch at most one read-only Worker collection
- **AND** that collection SHALL NOT run a deep-query follow-up or directly present a reply

### Requirement: Same-root-cause classification SHALL require current and historical evidence
The deterministic historical-case gate MUST allow `same_root_cause_likely` only when the verifier references at least one accepted current workspace/log evidence item and at least one accepted Redmine MCP evidence item from the current run, with no material contradiction.

#### Scenario: Both evidence sides agree
- **WHEN** current workspace/log evidence and current Redmine evidence support the same hypothesis and no accepted contradiction exists
- **THEN** the gate MAY retain `same_root_cause_likely` for normal Evidence Review

#### Scenario: Only historical evidence exists
- **WHEN** the verifier has Redmine evidence but no accepted current workspace/log evidence
- **THEN** the gate SHALL downgrade the relation to `diagnostic_lead_only`

#### Scenario: Current evidence contradicts history
- **WHEN** an accepted Worker or current log evidence contradicts the historical hypothesis
- **THEN** the gate SHALL downgrade the relation
- **AND** the final reply MUST NOT state that the issues share the same root cause

### Requirement: Case investigation SHALL review and present exactly once
No source collector, MCP tool, analyzer, assessor, verifier, or Worker collection may directly complete the user turn; Runtime SHALL aggregate evidence and invoke the existing Review/Presentation boundary once.

#### Scenario: Multiple sources return usable evidence
- **WHEN** Experience, Knowledge, Redmine, and Worker each return data
- **THEN** Runtime SHALL produce one formal result and one user-visible helper reply
- **AND** Presentation SHALL express only accepted frozen claims

### Requirement: Investigation internals SHALL remain turn-local
Planner reasons, Redmine bodies, analyzer reasons, verification plans, and verifier reasoning MUST NOT be stored in persisted Case JSON or returned by public session/log DTOs.

#### Scenario: Case investigation completes
- **WHEN** the Case and logs are serialized
- **THEN** they SHALL contain only safe request fields, reviewed result, evidence IDs, source statuses, counts, durations, and safe event metadata
- **AND** they SHALL NOT contain credentials, raw Redmine text, person identity, internal model reasoning, or Worker verification plans

### Requirement: Existing public compatibility SHALL be preserved
The change SHALL keep legacy config readable, keep old Case JSON readable, and preserve the top-level response shapes and async acceptance behavior of existing chat and session APIs.

#### Scenario: Dashboard starts an investigation asynchronously
- **WHEN** Dashboard sends `async:true`
- **THEN** Gateway SHALL return the existing 202 acceptance shape and expose progress through existing session polling

#### Scenario: Existing caller uses synchronous chat
- **WHEN** an existing caller omits async mode
- **THEN** Gateway SHALL wait for the same Runtime pipeline and return the existing synchronous response shape

