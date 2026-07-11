## ADDED Requirements

### Requirement: Knowledge decomposition preserves layer direction
Knowledge owner splits SHALL NOT introduce imports from Runtime, Gateway, Worker, or remote Provider adapters.

#### Scenario: New artifact IO owner is scanned
- **WHEN** module boundary tests inspect the owner
- **THEN** only local contracts, filesystem utilities, and permitted shared configuration are imported
