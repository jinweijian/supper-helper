## ADDED Requirements

### Requirement: Local health never calls retrieval providers
Local knowledge health SHALL inspect only local workspace, index, quality, and vector compatibility artifacts.

#### Scenario: Session with a user query is loaded
- **WHEN** `/api/session` serializes a Case whose latest message contains a query
- **THEN** no embedding, rerank, or configured retrieval provider is called

### Requirement: Search probe is explicit
Configured retrieval SHALL run only when the caller explicitly requests a query probe.

#### Scenario: Knowledge health is requested with query
- **WHEN** `/api/knowledge/health` receives a non-empty query parameter
- **THEN** the application service invokes production configured retrieval once and maps the result into the existing search health fields

#### Scenario: Knowledge health is requested without query
- **WHEN** the same endpoint has no query
- **THEN** it returns local health with waiting/off search state and makes zero provider calls

### Requirement: Application layer owns cross-module use cases
Gateway SHALL call an application service for health, bind, reindex, and probe; Knowledge SHALL NOT import Retrieval or Provider factories.

#### Scenario: Module boundary scan runs
- **WHEN** production imports are inspected
- **THEN** no file under `src/knowledge` imports `src/retrieval`, and routes do not instantiate retrieval providers
