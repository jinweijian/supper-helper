## ADDED Requirements

### Requirement: Case-investigation lifecycle events SHALL use a safe detail whitelist
Runtime SHALL record source planning, parallel collection, Redmine search/details, historical analysis, current evidence assessment, optional Worker verification, and final verification phases without persisting raw source or model payloads.

#### Scenario: A case-investigation phase is recorded
- **WHEN** Runtime records a historical-case lifecycle event
- **THEN** event detail MAY contain status, duration, candidate count, selected issue IDs, evidence IDs, source statuses, and whether Worker verification was requested
- **AND** it MUST NOT contain query text, signals, issue body, journal text, person identity, URL, credential, internal model reason, verification plan, or raw error

### Requirement: Public logs and session DTOs SHALL not expose investigation internals
The existing log and session serialization paths MUST exclude Redmine raw content, private-note data, model planning data, and ephemeral Worker verification requests.

#### Scenario: Client polls an active investigation
- **WHEN** `/api/session`, `/api/sessions`, or `/api/logs` serializes the Case
- **THEN** the response SHALL preserve its existing top-level shape
- **AND** it SHALL expose only safe phase summaries and Agent activity

### Requirement: Dashboard SHALL show case-investigation progress through existing polling
The observability layer and Dashboard SHALL map historical-case phases to concise user-visible progress stages without introducing a new API state machine.

#### Scenario: Knowledge and Redmine collect concurrently
- **WHEN** parallel source events are visible in the polled session
- **THEN** the loading UI SHALL indicate that knowledge and historical tickets are being collected

#### Scenario: Current evidence is being verified
- **WHEN** assessor or Worker verification phases are visible
- **THEN** the loading UI SHALL indicate current-environment verification
