## ADDED Requirements

### Requirement: Evaluation compares graph-assisted retrieval against the current hybrid baseline
The research SHALL compare the current BM25 + Embedding + RRF + rerank baseline with deterministic metadata graph recall and LightRAG mixed retrieval on the same canonical documents and question set.

#### Scenario: Main comparison runs
- **WHEN** the benchmark is executed
- **THEN** groups A, B, and C use the same source corpus and record retrieval candidates, answer-bearing context, latency, and cost

#### Scenario: Graph-only diagnostic runs
- **WHEN** graph-only retrieval is measured
- **THEN** its result is marked diagnostic-only and MUST NOT be recommended as a replacement without hybrid safety results

### Requirement: Evaluation covers relationship and safety queries
The benchmark SHALL contain at least 60 reviewed questions covering single-document precision, cross-module relationships, multi-document support, aliases, Redmine similar cases, version/freshness conflicts, no-hit, generic queries, and visibility boundaries.

#### Scenario: Multi-document question is labeled
- **WHEN** a question requires more than one parent document
- **THEN** the fixture records the complete expected supporting parent set and expected direct/abstain/escalate behavior

#### Scenario: Visibility and version cases are labeled
- **WHEN** a question could traverse restricted or stale graph content
- **THEN** the fixture records allowed visibility and applicable version and counts any violation as a safety failure

### Requirement: Graph evidence remains attributable to canonical sources
Every graph node or edge used in the experiment SHALL retain source identity and provenance; graph retrieval SHALL map candidates back to canonical parent/chunk evidence before answerability evaluation.

#### Scenario: Graph edge is selected
- **WHEN** a graph path contributes a retrieval candidate
- **THEN** the result records the edge type, source document or episode, extraction method, confidence, visibility, and version/validity metadata when available

#### Scenario: Edge lacks provenance
- **WHEN** an extracted edge cannot be traced to a canonical source block or source episode
- **THEN** it MAY be logged in shadow results but MUST NOT authorize a direct answer

### Requirement: Redmine temporal retrieval is evaluated separately
The research SHALL use Graphiti only on a bounded Redmine subset to evaluate issue relations, status/version changes, journal timelines, incremental updates, and episode provenance.

#### Scenario: Redmine fact changes over time
- **WHEN** the source contains an earlier and later status, version, or assignment fact
- **THEN** the experiment checks whether current and historical queries return the correct validity window and original episode

### Requirement: Obsidian remains an authoring layer
The research SHALL define an Obsidian-to-published-Markdown workflow in which properties and links are validated before entering canonical knowledge, text indexes, or graph indexes.

#### Scenario: Draft note links another note
- **WHEN** an Obsidian draft contains a wiki link
- **THEN** the link is treated as a candidate relation until publish validation assigns a relation type and source metadata

#### Scenario: Unpublished note exists
- **WHEN** a note is draft, review-required, deprecated, or otherwise not active published knowledge
- **THEN** it MUST NOT enter direct-answer text or graph indexes

### Requirement: Research produces a measurable selection decision
The research SHALL produce a findings document with a decision matrix covering retrieval quality, safety, latency, indexing cost, incremental update behavior, provenance, Chinese support, deployment complexity, and maintenance cost.

#### Scenario: Candidate is recommended
- **WHEN** the findings recommend a graph-assisted approach
- **THEN** direct-answer precision, no-hit abstention, and must-escalate accuracy do not regress; visibility/version violations are zero; and relationship-query Recall@5 and complete-support rate show measured improvement

#### Scenario: No candidate meets the gate
- **WHEN** no graph-assisted candidate satisfies the safety and quality gate
- **THEN** the findings recommend retaining the improved Hybrid RAG baseline and document why graph retrieval is deferred

### Requirement: Research spikes do not modify production code
All prototype code, fixtures, indexes, and benchmark outputs SHALL remain under the change directory until a separate implementation change is approved.

#### Scenario: Spike is created
- **WHEN** an experiment script or sidecar configuration is added
- **THEN** it is stored under `openspec/changes/research-graph-assisted-knowledge-retrieval/spikes/` and `src/` remains unchanged
