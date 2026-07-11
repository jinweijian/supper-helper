## ADDED Requirements

### Requirement: MCP stage is ordered between Knowledge and Worker
The runtime SHALL attempt MCP only after Experience and Knowledge fail to complete the AnswerGoal and before dispatching the diagnostic Worker.

#### Scenario: Knowledge directly answers
- **WHEN** Knowledge produces a reviewed final answer
- **THEN** MCP and Worker are not invoked
