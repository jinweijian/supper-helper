## MODIFIED Requirements

### Requirement: Published parents produce bounded child chunks
The knowledge index builder SHALL keep published Markdown as canonical parent evidence and generate child chunks along source-block and section boundaries. A v4 child SHALL preserve canonical body in `text` and derive `retrieval_text` from its bounded section path plus canonical body. BM25 SHALL use its separate heading field and canonical body, while embedding and rerank SHALL use `retrieval_text`.

#### Scenario: Parent contains multiple bounded sections
- **GIVEN** the v4 builder receives a published parent with independently answerable sections
- **WHEN** a parent contains independently answerable source blocks
- **THEN** child chunks target 300 to 800 Chinese characters
- **AND** preserve parent ID, source block IDs, section path, order, child identity `text_hash`, retrieval text hash, and strategy
- **AND** do not cross section paths

#### Scenario: V4 child has section context
- **GIVEN** a child has a non-empty normalized section path
- **WHEN** v4 artifact is written
- **THEN** canonical `text` contains only the body
- **AND** `retrieval_text` contains a section-path prefix bounded to 240 Unicode code points followed by canonical body
- **AND** `retrieval_text_hash` deterministically hashes that derived text

#### Scenario: Child has no section path
- **GIVEN** the current builder is producing a v4 child
- **WHEN** a v4 child is produced at the document root
- **THEN** `retrieval_text` equals canonical `text`
- **AND** no synthetic heading is invented

#### Scenario: BM25 indexes a v4 child
- **GIVEN** a validated v4 child has canonical body and derived retrieval text
- **WHEN** BM25 input is built
- **THEN** heading context is supplied through the existing heading field
- **AND** body input uses canonical `text`
- **AND** the heading prefix is not duplicated through `retrieval_text`

#### Scenario: Embedding or rerank consumes a v4 child
- **GIVEN** a validated v4 child has canonical body and derived retrieval text
- **WHEN** an embedding document or rerank candidate is built
- **THEN** it uses `retrieval_text`
- **AND** compatibility metadata includes v4 strategy and `retrieval_text_hash`

#### Scenario: Undersized trailing child can merge
- **GIVEN** the last child of a section is smaller than configured `minChars`
- **WHEN** merging it with the previous sibling stays within `maxChars`
- **THEN** the builder merges the siblings
- **AND** preserves the ordered union of source block IDs and canonical content

#### Scenario: Undersized trailing child needs rebalancing
- **GIVEN** the last child of a section is smaller than `minChars`
- **AND** a direct merge would exceed `maxChars`
- **WHEN** a sentence or Markdown-block boundary exists in the same section
- **THEN** the builder deterministically rebalances the two siblings at that boundary
- **AND** does not cross the section or truncate provenance

#### Scenario: Isolated undersized child cannot be merged
- **GIVEN** a section contains one indivisible child smaller than `minChars`
- **WHEN** no safe split or sibling merge exists
- **THEN** the builder preserves the child
- **AND** marks it `undersized_unmergeable`
- **AND** records a bounded artifact-health reason instead of dropping or padding content
- **AND** makes it investigation-only and strict-direct-answer ineligible

#### Scenario: Two siblings cannot be safely rebalanced
- **GIVEN** a section has a normal child followed by an undersized trailing child
- **AND** merging would exceed `maxChars`
- **AND** neither child has a safe sentence or Markdown-block rebalance boundary
- **WHEN** deterministic packing completes
- **THEN** the builder preserves both children unchanged
- **AND** marks the trailing child `undersized_unmergeable`
- **AND** makes that trailing child investigation-only until rebuilt from improved source boundaries

#### Scenario: Boundary requires overlap
- **GIVEN** two adjacent same-section children need continuity
- **WHEN** adjacent child chunks require context continuity
- **THEN** overlap contains at most one complete sentence
- **AND** no more than 120 characters

#### Scenario: Single source block exceeds maximum
- **GIVEN** a source block is indivisible under the source-block contract
- **WHEN** one indivisible source block exceeds 800 characters
- **THEN** the builder preserves the block
- **AND** records manual split required
- **AND** does not silently truncate provenance or content

### Requirement: Parent-child artifacts remain compatible and rebuildable
Current child records SHALL use `parent-child-v4` and `artifact_version=4`. Index/vector manifest `version` fields SHALL remain their own schema versions and SHALL NOT be conflated with child artifact version. A complete immutable generation SHALL live under `knowledge/indexes/generations/<generation-id>/`, include a versioned generation manifest, and be activated only through an atomically replaced `knowledge/indexes/active.json` pointer. Readers SHALL continue parsing old flat/non-current records as legacy, but they SHALL be ineligible for strict direct answer until an explicit validated rebuild succeeds.

#### Scenario: V3 record persists legacy false
- **GIVEN** an old v3 JSONL record contains `legacy=false`
- **WHEN** the v4 reader loads it
- **THEN** the effective value is `legacy=true`
- **AND** strict direct-answer eligibility is false
- **AND** health/trace records `rebuild_required`

#### Scenario: Old record lacks v4 fields
- **GIVEN** a legacy JSONL record remains syntactically readable
- **WHEN** a readable old record lacks `retrieval_text` or `retrieval_text_hash`
- **THEN** the reader does not invent current compatibility
- **AND** may use the record only for bounded investigation behavior

#### Scenario: Parent content changes
- **GIVEN** a current child identity is already indexed
- **WHEN** parent canonical text, section path, source blocks, child order, or strategy changes
- **THEN** child identity `text_hash` changes deterministically
- **AND** any changed `retrieval_text` changes `retrieval_text_hash`
- **AND** vector compatibility requires rebuild

#### Scenario: Existing v3 parent is rebuilt
- **GIVEN** canonical parent frontmatter still carries a v3 source marker
- **WHEN** the explicit v4 builder reads the published parent
- **THEN** it may emit validated v4 child artifacts without mutating the parent during a read request
- **AND** the child manifest, not the old parent marker, governs child direct-answer eligibility

#### Scenario: Explicit rebuild succeeds
- **GIVEN** the application-layer rebuild use case asks the knowledge generation builder to write and validate a temporary generation
- **AND** chunk count, ID uniqueness, file hashes, v4 strategy, configured mode, vector dimension, and required completeness all validate
- **WHEN** the knowledge generation publisher marks it immutable and complete
- **THEN** the publisher atomically replaces only `active.json`
- **AND** the generation manifest records the previous validated generation for rollback

#### Scenario: Explicit rebuild fails
- **GIVEN** an active validated generation or legacy flat set is currently serving readers
- **WHEN** chunk, manifest, BM25, embedding, or vector validation fails
- **THEN** the knowledge generation publisher does not update `active.json`
- **AND** leaves the previous artifact set intact
- **AND** reports a bounded failure category

#### Scenario: Vector build is incomplete
- **GIVEN** rebuild mode has embedding enabled or requested
- **AND** v4 chunks and BM25 validate but vectors are incomplete
- **WHEN** rebuild decides publication
- **THEN** it does not publish a mixed-version vector index
- **AND** it does not publish the new chunks/BM25 as a successful complete set
- **AND** retains the previous artifact set
- **AND** reports rebuild-required status

#### Scenario: Embedding is explicitly disabled
- **GIVEN** rebuild manifest declares a BM25-only mode because embedding is disabled
- **WHEN** all required v4 chunks, hashes, and BM25 artifacts validate
- **THEN** the explicit rebuild SHALL publish the complete BM25-only generation by atomic pointer replacement
- **AND** absence of vectors is not misreported as vector completeness

#### Scenario: Search request observes legacy artifacts
- **GIVEN** no current active generation exists and a readable flat legacy set is present
- **WHEN** a normal search request loads legacy artifacts
- **THEN** the request path does not rebuild or write the user's knowledge directory

#### Scenario: Reader is concurrent with activation
- **GIVEN** a search request resolved active generation A once at request start
- **WHEN** the publisher atomically activates generation B
- **THEN** that request completes using only generation A
- **AND** a later request may resolve generation B
- **AND** neither request mixes files from both generations

#### Scenario: Two publishers race from the same active generation
- **GIVEN** publisher B and publisher C both built candidates with `expectedActiveGenerationId=A`
- **WHEN** both attempt publication
- **THEN** the knowledge-owned generation publisher adapter's cross-process publish lock permits only one writer at a time
- **AND** the winner validates A, publishes its generation, and records A as previous
- **AND** the loser observes that active no longer equals A and fails with `generation_conflict`
- **AND** the loser does not overwrite the pointer or report success

#### Scenario: Publisher cannot acquire the writer lock
- **GIVEN** another validated publisher owns the cross-process publish lock
- **WHEN** a second publisher reaches its bounded lock deadline
- **THEN** it returns a bounded busy/conflict result
- **AND** does not modify `active.json` or another generation

#### Scenario: Stale publish lock remains after a crash
- **GIVEN** a crash left publish-lock owner metadata
- **WHEN** a normal request or unrelated rebuild observes the lock
- **THEN** it does not steal or delete the lock
- **AND** only an explicit recovery use case may clear it after validating owner, process state, age, active pointer, and incomplete generations

#### Scenario: Rebuild crashes before activation
- **GIVEN** a temporary or incomplete generation directory exists
- **WHEN** no complete generation manifest and active pointer reference it
- **THEN** readers ignore it
- **AND** health reports it as incomplete
- **AND** only an explicit maintenance operation may clean it

#### Scenario: Rollback is requested
- **GIVEN** active generation B records previous validated generation A
- **WHEN** the application-layer rollback use case asks the knowledge-owned publisher adapter to roll back with expected active B
- **AND** that adapter acquires the publish lock, confirms B, validates A, and atomically replaces `active.json`
- **THEN** new readers use A
- **AND** rollback does not rebuild or mutate A

### Requirement: Child hits expand to bounded parent evidence
Retrieval SHALL deduplicate child hits by parent and return parent evidence with the strongest complete answer span and bounded same-section context. Answer spans SHALL be selected only from canonical body, be domain-neutral, and be returned only when the complete answer-bearing unit fits within one to three consecutive semantic units and 500 Unicode code points.

#### Scenario: Multiple children from one parent match
- **GIVEN** multiple eligible child candidates share one canonical parent
- **WHEN** several children under the same parent are recalled
- **THEN** final evidence contains one parent
- **AND** preserves child strategy scores
- **AND** uses the strongest complete bounded answer span

#### Scenario: Complete multi-step answer fits
- **GIVEN** all required steps occupy no more than three consecutive sentences or Markdown semantic units
- **AND** the complete span is at most 500 Unicode code points
- **WHEN** answer span selection runs
- **THEN** it returns the complete contiguous canonical fragment
- **AND** may include at most 1600 characters of same-section investigation context separately

#### Scenario: Complete multi-step answer exceeds the boundary
- **GIVEN** a required instruction contains more than three semantic units or exceeds 500 Unicode code points
- **WHEN** truncation would omit a required step
- **THEN** no answer span is returned
- **AND** the candidate remains investigation-only
- **AND** strict Judge blocks direct answer

#### Scenario: No answer-bearing fragment exists
- **GIVEN** a recalled candidate has canonical text but no complete answer-bearing fragment
- **WHEN** a candidate is semantically related but no complete answer-bearing fragment is found
- **THEN** no answer span is returned
- **AND** it remains investigation context
- **AND** strict Judge blocks direct answer

#### Scenario: Domain-neutral scoring selects an answer
- **GIVEN** a candidate belongs to a domain outside education
- **WHEN** answer-bearing detection runs on a domain outside education
- **THEN** it uses query coverage, paragraph boundaries, list/numbering continuity, and general conditional/capability/action structure
- **AND** does not require business-domain vocabulary

#### Scenario: Heading alone matches the query
- **GIVEN** only the derived section-path prefix contains strong query terms
- **WHEN** answer span selection runs
- **THEN** the heading prefix is not returned as answer span
- **AND** canonical body must independently contain a complete answer-bearing fragment
