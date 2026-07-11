## ADDED Requirements

### Requirement: MCP planning agents are registered and non-visible
MCP Planner and evidence extraction configurations SHALL be registered with explicit contracts and SHALL NOT produce user-facing text.

#### Scenario: Agents API lists MCP stages
- **WHEN** `/api/agents` is requested
- **THEN** the MCP stages expose execution mode and `mayProduceUserFacingText=false`
