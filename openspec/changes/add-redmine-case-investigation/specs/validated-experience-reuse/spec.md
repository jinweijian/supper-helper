## ADDED Requirements

### Requirement: Experience SHALL not short-circuit case investigation
The Experience service SHALL expose an evidence-only collection path and, while case-investigation mode is active, SHALL treat reusable and rejected prior-session matches as candidates rather than a final answer.

#### Scenario: Reusable Experience match exists in case-investigation mode
- **WHEN** Experience finds a match that would be reusable on the fast path
- **THEN** Runtime SHALL add its bounded history evidence to the investigation
- **AND** it SHALL continue Redmine collection, current-evidence assessment, deterministic Review, and Presentation

#### Scenario: No Experience match exists
- **WHEN** Experience finds no reusable answer
- **THEN** the investigation SHALL continue without creating an Experience helper reply

#### Scenario: Fast path uses Experience
- **WHEN** case-investigation mode is not active and an Experience match passes existing validation
- **THEN** the existing reviewed Experience short-circuit behavior SHALL remain available

