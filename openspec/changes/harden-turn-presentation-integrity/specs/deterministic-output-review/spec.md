## ADDED Requirements

### Requirement: Presentation plan cannot carry free-form facts
The presentation-stage model contract SHALL express selection and ordering by reviewed IDs and SHALL NOT accept a free-form user-visible reply as authoritative output.

#### Scenario: Valid IDs with unsupported prose
- **WHEN** model output contains valid IDs plus prose not present in reviewed claims
- **THEN** deterministic validation rejects the prose and renders only reviewed material
