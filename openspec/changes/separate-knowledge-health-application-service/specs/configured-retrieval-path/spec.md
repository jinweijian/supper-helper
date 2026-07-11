## ADDED Requirements

### Requirement: Health probes reuse production retrieval composition
An explicit health probe SHALL use the same strategy registry, provider resolution, fusion, rerank, and trace path as Runtime retrieval.

#### Scenario: Probe executes with fake embedding and rerank
- **WHEN** a local explicit probe uses configured fake providers
- **THEN** its trace reports the same enabled strategies and rerank stage as Runtime composition
