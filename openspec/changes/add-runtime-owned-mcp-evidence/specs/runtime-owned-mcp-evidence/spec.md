## ADDED Requirements

### Requirement: MCP calls are runtime-owned and read-only
The system SHALL execute an MCP tool only after deterministic validation of server enablement, workspace membership, server permission, exact tool-name allowlist, transport configuration, and stdio command whitelist.

#### Scenario: Read-write server is configured in the workspace
- **WHEN** the planner selects a tool from a server whose permission is `read_write`
- **THEN** no connection or tool call occurs and the runtime records a safe rejection reason

#### Scenario: Discovered tool is not explicitly allowed
- **WHEN** listTools returns a tool absent from `allowedToolNames`
- **THEN** the planner cannot execute that tool

### Requirement: MCP planning is bounded
Each diagnostic run SHALL perform at most two serial MCP tool calls, and the second planner step SHALL only receive the first normalized redacted result.

#### Scenario: Planner requests a third call
- **WHEN** two calls have already completed
- **THEN** the runtime stops MCP execution and continues Review or Worker diagnosis

### Requirement: MCP results become reviewed evidence
MCP transport output SHALL be normalized, bounded, redacted, assigned evidence IDs, and reviewed before any associated claim becomes user-visible.

#### Scenario: MCP fully answers the AnswerGoal
- **WHEN** extracted primary claims cover every must-answer item and pass deterministic review
- **THEN** the runtime may answer without invoking the Worker

#### Scenario: MCP only partially answers
- **WHEN** MCP evidence leaves must-answer items uncovered
- **THEN** the evidence and missing items are attached to DiagnosticRequest context and the Worker continues diagnosis

### Requirement: MCP transport failures degrade safely
Timeout, disconnect, rate limit, malformed payload, schema error, and secret-bearing error SHALL not leak raw transport data or block safe fallback.

#### Scenario: Remote server returns 429 with secret payload
- **WHEN** a remote MCP call returns rate limit data containing credentials
- **THEN** the audit records a redacted bounded error and Runtime continues with Worker or asks for input

### Requirement: Local real protocol acceptance is mandatory
The change SHALL include real local stdio, Streamable HTTP, and legacy SSE servers using the production SDK adapter.

#### Scenario: Default test execution
- **WHEN** `pnpm test` runs without external credentials
- **THEN** all MCP tests remain local and no external network request occurs
