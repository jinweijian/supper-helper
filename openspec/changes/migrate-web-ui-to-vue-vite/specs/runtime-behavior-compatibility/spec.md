## ADDED Requirements

### Requirement: UI migration preserves server contracts
The Vue migration SHALL preserve existing successful HTTP response shapes, CLI server commands, session URLs, and public render symbol imports.

#### Scenario: Existing public API suite runs after migration
- **WHEN** the compatibility suite calls all existing routes
- **THEN** JSON shapes remain unchanged and render symbols return the built app entries
