## ADDED Requirements

### Requirement: Completion consumes message ID
The diagnostic runtime SHALL complete a turn using the accepted user message ID rather than searching by message body.

#### Scenario: Async gateway completes accepted turn
- **WHEN** `/api/chat` accepts an asynchronous message
- **THEN** the background completion receives the returned user message ID and the final reply references that ID
