## ADDED Requirements

### Requirement: Claimed owner files must be production-reachable
Every owner named by a split change SHALL export production behavior and SHALL have a production importer or be a documented public entrypoint.

#### Scenario: Owner exists but is unused
- **WHEN** an owner file is present but absent from the production import graph
- **THEN** structural acceptance fails
