## ADDED Requirements

### Requirement: Runtime SHALL own the dedicated case-investigation lifecycle
After successful Preflight and before any Experience or Knowledge short-circuit, Runtime SHALL delegate historical-case planning and orchestration to a focused collaborator while keeping Gateway, MCP server, and Worker free of final diagnostic decisions.

#### Scenario: Dedicated planner selects case investigation
- **WHEN** the evidence-source planner selects case-investigation mode
- **THEN** `DiagnosticRuntime` SHALL delegate source collection, analysis, optional Worker collection, verification, and Review preparation to the case-investigation collaborator
- **AND** Gateway route code SHALL only serialize the Runtime response

#### Scenario: Dedicated planner selects fast answer
- **WHEN** the planner selects fast-answer mode
- **THEN** the collaborator SHALL return control without creating a Run or helper reply
- **AND** Runtime SHALL continue the existing fast path

### Requirement: Case-investigation Worker collection SHALL remain behind the stable worker contract
Runtime SHALL pass only a schema-validated read-only verification request to the existing DiagnosticWorker port and SHALL keep the persisted request free of internal historical-case material.

#### Scenario: Assessor requests current evidence
- **WHEN** the verification plan passes Runtime read-only validation
- **THEN** Runtime SHALL call the configured DiagnosticWorker at most once
- **AND** Worker output SHALL return to Runtime as evidence rather than a final reply

#### Scenario: Verification plan requests a side effect
- **WHEN** the plan requests file mutation, database mutation, network write, or Redmine write
- **THEN** Runtime SHALL reject the plan before worker dispatch

