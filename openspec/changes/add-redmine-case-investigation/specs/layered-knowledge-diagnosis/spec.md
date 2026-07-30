## ADDED Requirements

### Requirement: Knowledge SHALL support evidence-only collection for case investigation
The Knowledge diagnosis service SHALL expose an evidence-only collection path that returns bounded evidence, provenance, judge outcome, retrieval trace, and a context patch without creating a Run, helper reply, Review, or Presentation.

#### Scenario: Knowledge can answer during case investigation
- **WHEN** case-investigation mode is active and Knowledge evidence is fully answerable
- **THEN** Knowledge SHALL return the evidence to the case-investigation aggregator
- **AND** it SHALL NOT complete the turn before Redmine settles

#### Scenario: Knowledge requires code escalation during case investigation
- **WHEN** Knowledge evidence is partial, stale, conflicting, or requires current implementation evidence
- **THEN** the collection result SHALL preserve the evidence and gap
- **AND** it SHALL not mutate the shared DiagnosticRequest concurrently

#### Scenario: Fast knowledge path remains active
- **WHEN** case-investigation mode is not active
- **THEN** the existing Knowledge answer path SHALL continue to permit a reviewed direct answer or existing Worker escalation

