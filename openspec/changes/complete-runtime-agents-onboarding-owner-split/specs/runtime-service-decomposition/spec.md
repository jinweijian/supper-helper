## ADDED Requirements

### Requirement: Runtime event aggregation stays thin
The Event Recorder aggregation entry SHALL contain only shared sink composition and public compatibility wiring; phase-specific decisions and payload mapping SHALL live in phase owners.

#### Scenario: Aggregator exceeds the owner budget with phase logic
- **WHEN** phase labels or payload construction are added to the aggregator
- **THEN** boundary tests reject the change
