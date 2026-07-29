## ADDED Requirements

### Requirement: Evidence exposes bounded canonical context without retrieval-text leakage
Retrieval evidence SHALL expose the normalized `section_path`, a bounded canonical answer span when one exists, and bounded canonical same-section context needed by Evidence Judge and Answerability. It SHALL NOT expose the complete derived `retrieval_text` to Case JSON, Presentation, user replies, or persisted runtime logs.

#### Scenario: V4 child is recalled
- **GIVEN** embedding or rerank used a child's `retrieval_text`
- **WHEN** the child is converted into evidence
- **THEN** evidence contains canonical parent metadata, section path, and bounded canonical span/excerpt
- **AND** does not copy the complete `retrieval_text`

#### Scenario: Presentation consumes reviewed evidence
- **GIVEN** safe projection materialization has selected accepted claims
- **WHEN** review freezes selected accepted claims and their directly bound evidence
- **THEN** Presentation can use only those bounded evidence identities and canonical excerpts
- **AND** cannot access raw recall candidates or complete retrieval text

#### Scenario: Evidence has no complete answer span
- **GIVEN** a recalled child is semantically related to the query
- **WHEN** recall finds a related child but answer-span selection returns no complete bounded span
- **THEN** evidence remains available as investigation context
- **AND** strict direct-answer eligibility is false

### Requirement: Answer span is complete, contiguous, and canonical
An evidence `answer_span` SHALL be a contiguous fragment of canonical child body containing one to three complete consecutive semantic units and at most 500 Unicode code points. Retrieval SHALL abstain instead of returning a truncated fragment that omits a required step.

#### Scenario: Three-sentence procedure fits the limit
- **GIVEN** a complete procedure occupies three consecutive sentences and no more than 500 Unicode code points
- **WHEN** retrieval selects the strongest answer-bearing fragment
- **THEN** `answer_span` contains all three sentences in source order

#### Scenario: Four required steps do not fit
- **GIVEN** a procedure has four required semantic units
- **WHEN** selecting only three would make the instruction incomplete
- **THEN** `answer_span` is absent
- **AND** the candidate cannot support strict direct answer

#### Scenario: Span is 501 Unicode code points
- **GIVEN** canonical body contains one smallest complete answer-bearing fragment
- **WHEN** the smallest complete answer-bearing fragment is 501 Unicode code points
- **THEN** retrieval does not truncate it to 500
- **AND** returns no answer span

#### Scenario: Markdown numbered steps have no sentence punctuation
- **GIVEN** a complete numbered list uses Markdown line boundaries rather than sentence punctuation
- **WHEN** the list contains at most three required items and fits the length limit
- **THEN** each list item is treated as a semantic unit
- **AND** the contiguous list can be returned as the answer span

#### Scenario: Heading is not body evidence
- **GIVEN** a v4 child has a derived section-heading prefix and canonical body
- **WHEN** query terms occur only in the section heading prefix
- **THEN** the heading is not returned as `answer_span`

### Requirement: Evidence Judge validates span boundaries without a second domain vocabulary
Evidence Judge SHALL validate span presence, canonical provenance, completeness, confidence, claim binding, and AnswerGoal coverage. It SHALL NOT independently require education-specific or other business-domain keywords to decide whether the retrieval-selected span is answer-bearing.

#### Scenario: Domain-neutral technical procedure is retrieved
- **GIVEN** a canonical span satisfies structural, provenance, confidence, and coverage requirements
- **WHEN** it contains no education-domain terms
- **THEN** Evidence Judge does not reject it merely for lacking those terms

#### Scenario: Retrieval reports an incomplete span
- **GIVEN** Evidence Judge receives a candidate marked with answer-span integrity metadata
- **WHEN** a span is truncated, outside canonical body, over the limit, or missing a required step
- **THEN** Evidence Judge blocks strict direct answer
- **AND** records a bounded integrity/completeness reason

## MODIFIED Requirements

### Requirement: Evidence preserves canonical parent metadata
Every retrieval evidence result SHALL preserve canonical parent metadata required for freshness, quality, provenance, visibility, and claim review. V4 evidence SHALL preserve section path and canonical bounded content while keeping derived retrieval text and its full source path internal to the rebuildable index.

#### Scenario: Indexed chunk has a parent document
- **GIVEN** a recalled child belongs to the active generation
- **WHEN** BM25 or embedding recall maps a chunk to its parent
- **THEN** the candidate and evidence include document type, status, confidence, visibility, last verified time, source document identity, source block IDs, section path, quality, and retrieval strategy scores when those values exist

#### Scenario: Old artifact lacks safety metadata
- **GIVEN** a legacy chunk remains syntactically readable
- **WHEN** an old chunk artifact can be read but lacks parent safety metadata
- **THEN** retrieval marks the metadata as missing
- **AND** MUST NOT invent epoch timestamps, active status, quality, or provenance
- **AND** strict direct-answer eligibility remains false

#### Scenario: Parent document is missing
- **GIVEN** a recalled chunk declares a parent identity
- **WHEN** a chunk cannot be resolved to a canonical parent document
- **THEN** it is excluded from direct-answer evidence
- **AND** trace records a `missing_parent` filter reason

#### Scenario: Child identity and retrieval hashes disagree
- **GIVEN** retrieval loads a child declared as v4
- **WHEN** v4 artifact compatibility detects a missing or mismatched child identity `text_hash` or `retrieval_text_hash`
- **THEN** the child is excluded from strict direct-answer evidence
- **AND** trace records a bounded rebuild-required reason

### Requirement: Retrieval errors and traces are safe
Retrieval trace and errors SHALL be observable without exposing secrets, raw vectors, complete provider payloads, complete source documents, complete `retrieval_text`, or internal knowledge source paths.

#### Scenario: Provider fails
- **GIVEN** configured retrieval has at least one independent recall path
- **WHEN** embedding or rerank returns timeout, rate limit, server, malformed-response, or dimension errors
- **THEN** trace contains a redacted failure category
- **AND** other successful recall candidates remain available according to their own eligibility

#### Scenario: Trace is persisted in runtime logs
- **GIVEN** retrieval completed with bounded strategy and generation metadata
- **WHEN** a knowledge search completes in a user turn
- **THEN** runtime log records strategy status, candidate counts, fusion, rerank, filter summaries, artifact version, and bounded reason codes
- **AND** does not change the public chat response shape
- **AND** does not persist complete retrieval text or source content

#### Scenario: Legacy artifact is recalled
- **GIVEN** no current eligible replacement exists for one readable legacy child
- **WHEN** a readable non-v4 artifact participates in investigation recall
- **THEN** trace records legacy/rebuild-required status
- **AND** does not log the artifact body as proof
