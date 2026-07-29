## MODIFIED Requirements

### Requirement: Turn ordering and lifecycle remain compatible
Runtime decomposition SHALL preserve same-case serialization, sync/async shared execution, session state transitions and reply-to message association. A retry of a startup-interrupted turn SHALL reuse the original user message, execute through the same complete-turn queue and pipeline, and SHALL NOT duplicate concurrent execution.

#### Scenario: Two turns for one case overlap
- **WHEN** two accepted turns complete concurrently for the same case
- **THEN** they execute in acceptance order
- **AND** a failed turn does not poison the next queued turn

#### Scenario: Sync and async routes execute
- **WHEN** gateway uses either route style
- **THEN** both call the same `DiagnosticRuntime` start/complete pipeline
- **AND** existing public response fields and persisted case shapes remain unchanged
- **AND** Session responses may add the optional `retryableTurn` field

#### Scenario: Interrupted turn retries
- **WHEN** Runtime accepts a retry for a startup-interrupted user message
- **THEN** completion uses the existing same-case queue and complete-turn pipeline
- **AND** a duplicate retry cannot invoke that pipeline concurrently
