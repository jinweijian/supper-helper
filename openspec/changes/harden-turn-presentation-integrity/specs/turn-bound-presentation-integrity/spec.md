## ADDED Requirements

### Requirement: User turn context is bounded by message identity
The runtime SHALL identify a turn by `userMessageId` and SHALL exclude every later Case message from that turn's resolved context, preflight, experience, knowledge, MCP, worker request, and AnswerGoal.

#### Scenario: Later asynchronous message is already persisted
- **WHEN** two messages are accepted for the same Case before the first completes
- **THEN** the first turn context contains the first message and prior history but not the second message

#### Scenario: Two messages have identical text
- **WHEN** two unanswered user messages have identical bodies and different IDs
- **THEN** each helper reply is bound to the intended message ID without body-based ambiguity

### Requirement: Visible reply is a deterministic projection
The runtime SHALL construct the complete visible reply only from selected accepted claims, their directly bound evidence, accepted next actions, and reviewed missing information.

#### Scenario: Presentation model adds a new fact
- **WHEN** a presentation response selects valid claim IDs but includes an additional factual statement
- **THEN** the response is rejected and the runtime emits the deterministic fallback without that statement

#### Scenario: Internal process claim exists
- **WHEN** accepted data includes process notes, judge scores, route decisions, or unselected claims
- **THEN** none of those values appear in the visible reply

### Requirement: Case-scoped Claude session is subordinate context
Claude sessions SHALL be reused only inside one Case, while each run SHALL still receive the complete authoritative DiagnosticRequest.

#### Scenario: Follow-up run in the same Case
- **WHEN** a second run is created for a Case
- **THEN** the worker may resume the Case session but MUST prefer the current DiagnosticRequest over hidden session memory
