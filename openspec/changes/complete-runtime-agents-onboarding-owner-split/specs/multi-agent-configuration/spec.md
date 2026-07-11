## ADDED Requirements

### Requirement: Agent stage schemas have one authority
Each stage-specific input/output contract SHALL be defined in its registered Agent config or stable code contract, and the Main Agent SHALL reference rather than duplicate it.

#### Scenario: Contradictory worker session statements are present
- **WHEN** Agent configs are linted
- **THEN** the lint fails unless all statements describe Case-scoped reuse consistently
