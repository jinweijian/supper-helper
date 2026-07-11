## ADDED Requirements

### Requirement: Legal API payloads remain compatible
Input hardening SHALL NOT change successful response fields for existing chat, session, settings, knowledge, logs, or onboarding routes.

#### Scenario: Compatibility suite uses legal identifiers and payload sizes
- **WHEN** existing public API contract scenarios run
- **THEN** response status and JSON shape remain unchanged
