## ADDED Requirements

### Requirement: Marker and reverse-owner patterns are forbidden
Module governance SHALL reject unused marker files, owner files that only reverse-export a giant implementation, and facades containing hidden business decisions.

#### Scenario: Split is only nominal
- **WHEN** required files exist but production still imports the old giant implementation
- **THEN** structural acceptance fails
