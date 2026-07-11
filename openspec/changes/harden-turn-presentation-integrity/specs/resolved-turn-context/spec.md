## ADDED Requirements

### Requirement: Resolved context accepts an explicit cutoff
Resolved-turn construction SHALL require or derive a target user message ID and SHALL only inspect messages at or before that target.

#### Scenario: Future clarification is present in storage
- **WHEN** a later clarification exists after the target user message
- **THEN** it is not classified as a fact, hypothesis, unknown, or source message for the target turn
