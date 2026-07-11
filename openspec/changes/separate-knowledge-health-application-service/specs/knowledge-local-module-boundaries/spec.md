## ADDED Requirements

### Requirement: Knowledge health remains local
Knowledge-owned health functions SHALL accept local inputs and optional already-produced structured data but SHALL NOT create or call retrieval services.

#### Scenario: Knowledge module is imported in an offline process
- **WHEN** local health is built with remote providers enabled in config
- **THEN** the function completes without network access
