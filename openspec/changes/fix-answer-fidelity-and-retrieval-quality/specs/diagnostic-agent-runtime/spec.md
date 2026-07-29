## ADDED Requirements

### Requirement: Every answer source uses the reconciled must-answer identities
Experience, Knowledge, MCP, Worker, RAG Answerability, deterministic validation, review, and Presentation SHALL consume the same reconciled `answerGoal.mustAnswerItems` strings. A claim's `answers` SHALL reference those exact strings; no stage may silently substitute a local placeholder, independently rephrase an item, or apply a different single-claim coverage rule.

#### Scenario: Knowledge produces multiple primary claims
- **GIVEN** the reconciled AnswerGoal contains two must-answer items
- **WHEN** Knowledge creates one accepted primary claim for each item
- **THEN** each claim's `answers` contains the exact corresponding item string
- **AND** the independent coverage reviewer accepts only supported claim→item bindings
- **AND** deterministic review recognizes complete union coverage only from those reviewed bindings plus full-question coverage

#### Scenario: Worker receives decomposed items
- **GIVEN** deterministic reconciliation accepted model-assisted must-answer items
- **WHEN** runtime dispatches a worker for a request with model-assisted must-answer items
- **THEN** the structured worker request contains the exact reconciled items
- **AND** worker claims cannot claim coverage using a locally invented alias

#### Scenario: Compatibility sentinel is used
- **GIVEN** Preflight falls back to `DIRECT_ANSWER_ITEM`
- **WHEN** any source produces a primary claim
- **THEN** the source may use the exact sentinel in `answers`
- **AND** the sentinel is never rendered as user-visible answer text

### Requirement: Answer coverage is independently reviewed rather than producer-certified
A producer's `claim.answers` SHALL be treated only as a candidate binding. Before final eligibility, a runtime-owned coverage-review service SHALL call the registered non-user-facing model-assisted `evidence-coverage` agent seam independently of that producer and SHALL inspect the safe normalized complete `resolvedQuestion`, must-answer item set, and source-neutral bounded/redacted claim/evidence segments with current freshness provenance. Raw `DiagnosticResult`, raw `Evidence.summary/source`, provider payload, trace, complete `retrieval_text`, and unselected evidence SHALL NOT enter that call. The call SHALL be at most one batch of at most twenty candidate accepted claims per reviewed turn and SHALL output reviewed claim→item bindings, full-question coverage, and `fullQuestionClaimIds` identifying the evidence-supported primary claims that must collectively appear to answer the complete question; overflow SHALL not receive implicit coverage. Final SHALL require every item and the complete resolved question to be supported with no missing element, and runtime SHALL include all valid `fullQuestionClaimIds` in the frozen primary answer. Reviewer unavailable, malformed, or `unknown` SHALL conservatively block final.

#### Scenario: Producer over-labels one partial claim
- **GIVEN** the resolved question asks how to enable X and how long activation takes
- **AND** a producer claim only answers how to enable X
- **WHEN** the producer declares both must-answer items in `answers`
- **THEN** independent review accepts at most the supported enablement binding
- **AND** reports the activation-time element missing
- **AND** final eligibility is false

#### Scenario: Multiple claims receive reviewed bindings
- **GIVEN** separate accepted claims and evidence support each must-answer item and the complete resolved question
- **WHEN** independent coverage review evaluates them
- **THEN** it returns reviewed bindings for the supported claim/item pairs
- **AND** returns the evidence-supported primary IDs required for the full question
- **AND** full-question coverage is `full`
- **AND** deterministic review uses the original-order union of item-cover and full-question-required IDs

#### Scenario: Sentinel compatibility path requests final
- **GIVEN** `mustAnswerItems=[DIRECT_ANSWER_ITEM]`
- **WHEN** a producer declares the sentinel covered
- **THEN** that declaration alone is insufficient
- **AND** independent review must still find the complete `resolvedQuestion` answered by claim text and evidence

#### Scenario: Independent reviewer is unavailable
- **GIVEN** claims declare all current item strings
- **WHEN** the independent coverage reviewer times out, fails, returns malformed output, or returns `unknown`
- **THEN** runtime does not freeze a final outcome
- **AND** records a bounded coverage-review reason

### Requirement: Coverage review input is source-neutral, bounded, safe, and current
Runtime SHALL materialize coverage-review input without changing the public `Evidence` shape. It SHALL accept at most twenty claim segments, forty deduplicated evidence segments, 1000 Unicode code points per complete claim/evidence segment, and 24,000 total text code points. It SHALL normalize and redact secret, unsafe path, and internal-source content before the model call and SHALL NOT character-truncate a semantic unit to satisfy a bound. A final-required segment that is over-bound, empty after safety processing, or lacks allowed current freshness SHALL receive no coverage and SHALL block final.

Knowledge evidence SHALL come from a strict-eligible canonical span in the request-fixed current active v4 generation. Current-turn Workspace evidence SHALL come from the current Worker run; current-turn MCP evidence SHALL come from a completed allowlisted read-only call after normalization and evidence-envelope validation. Current manual evidence SHALL bind to a current `sourceMessageId`; current log evidence SHALL be a selected safe excerpt from the same run. Historical Workspace/MCP evidence SHALL require source-specific read-only re-resolution against current state. Historical manual/log/history/unknown evidence SHALL be investigation-only.

#### Scenario: Current Worker evidence can support final
- **GIVEN** a current Worker run returns a bounded accepted primary claim with directly bound medium/high-confidence workspace evidence
- **AND** the evidence passes normalization, redaction, and current-run provenance checks
- **WHEN** runtime materializes coverage-review input
- **THEN** it emits source-neutral workspace segments marked `current_worker_run`
- **AND** independent coverage review may grant supported bindings and full-question eligibility

#### Scenario: Current read-only MCP evidence can support final
- **GIVEN** an allowlisted read-only MCP call completed in the current turn
- **AND** its normalized evidence envelope directly supports an accepted primary claim
- **WHEN** runtime materializes coverage-review input
- **THEN** it emits source-neutral MCP segments marked `current_mcp_call`
- **AND** independent coverage review may grant supported bindings and full-question eligibility

#### Scenario: Raw evidence fields are not reviewer input
- **GIVEN** raw evidence source or summary contains a secret, absolute internal path, provider payload, trace text, or an unselected result
- **WHEN** the production coverage-review service builds its model payload
- **THEN** those raw fields and values are absent
- **AND** only stable IDs, kind/freshness enums, and bounded redacted selected text are present

#### Scenario: Required coverage segment exceeds a bound
- **GIVEN** a final-required claim or evidence segment exceeds 1000 code points as a complete semantic unit or total payload would exceed 24,000
- **WHEN** coverage materialization applies its bounds
- **THEN** it does not character-truncate the segment
- **AND** it grants no coverage from that segment
- **AND** final eligibility is false

### Requirement: Experience replay preserves reviewed structure and current eligibility
Experience SHALL NOT wrap a historical assistant reply body or summary as a new primary claim or self-declare coverage of all current must-answer items. Final-eligible replay SHALL require exact normalized equality of current/source `resolvedQuestion`, `answerObject`, and must-answer set, current deterministic revalidation of source structured claims/evidence, and current provenance eligibility. Matching compatibility sentinels alone SHALL NOT establish goal equality. Knowledge evidence SHALL be re-resolved through the retrieval port against the current active v4 generation rather than adding generation metadata to Case JSON. Workspace/MCP evidence SHALL be re-resolved through its current read-only source adapter; if existing structured source data is insufficient, it SHALL be direct-ineligible. Historical manual/log/history/unknown evidence and any content lacking role/answers or resolvable current provenance MAY be investigation context only.

#### Scenario: Structured source run exactly matches the current AnswerGoal
- **GIVEN** a source run retains structured AnswerGoal, accepted claims, directly bound evidence, and an exact normalized must-answer item set equal to the current request
- **AND** any knowledge evidence proves current v4 generation eligibility
- **WHEN** Experience revalidates and replays the source
- **THEN** it reuses only the reaccepted structured claims/evidence
- **AND** preserves each claim's type, role, answers, and provenance
- **AND** does not use the historical rendered reply as the claim text source

#### Scenario: Historical reply has no reusable structured claims
- **GIVEN** a matching historical assistant message exists
- **AND** its source run lacks valid role/answers or directly bound evidence
- **WHEN** Experience evaluates direct replay
- **THEN** the message body and summary are not wrapped as `primary_answer`
- **AND** the history may only contribute bounded investigation context or route to another source

#### Scenario: Historical AnswerGoal differs
- **GIVEN** a source run's normalized resolved question, answer object, or must-answer set differs from the current AnswerGoal
- **WHEN** Experience evaluates coverage
- **THEN** it does not alias or rewrite old item strings to claim full current coverage
- **AND** cannot return a final direct replay

#### Scenario: Different questions both use the compatibility sentinel
- **GIVEN** source and current runs both use `[DIRECT_ANSWER_ITEM]`
- **BUT** their normalized resolved questions or answer objects differ
- **WHEN** Experience evaluates goal identity
- **THEN** matching sentinel items do not establish an exact goal
- **AND** historical claims cannot receive replay coverage

#### Scenario: Historical knowledge provenance is legacy or unknown
- **GIVEN** a source run depended on knowledge evidence with v3, rebuild-required, or missing generation provenance
- **WHEN** Experience cannot re-resolve the source/evidence identity as eligible in the current active v4 generation
- **THEN** that evidence is strict-direct-answer ineligible
- **AND** Experience cannot use it to bypass the v4 requirement

#### Scenario: Current content no longer supports a historical claim
- **GIVEN** historical knowledge evidence identity still resolves in the active v4 generation
- **BUT** its canonical content or identity hash changed and no longer supports the old claim text
- **WHEN** Experience reruns claim-support and full-question coverage review against current evidence
- **THEN** the historical claim is direct-answer ineligible
- **AND** matching source identity alone cannot preserve replay eligibility

#### Scenario: Historical non-knowledge evidence cannot be re-resolved
- **GIVEN** a historical Workspace or MCP claim has only an opaque summary/source string and no sufficient structured selector for its current read-only resolver
- **OR** historical evidence kind is manual, log, history, or unknown
- **WHEN** Experience evaluates direct replay
- **THEN** that evidence produces no coverage segment
- **AND** the claim is investigation-only even if its historical summary still appears plausible

### Requirement: Worker actionable guidance is structured and authorization-safe
Diagnostic worker adapters SHALL require user-actionable troubleshooting or repair guidance to be emitted as accepted-candidate claims with `role=next_action`, relevant `answers`, and evidence boundaries. Summary and process notes SHALL NOT be the only carriers of those steps.

#### Scenario: Worker identifies a supported configuration repair
- **GIVEN** evidence supports changing a configuration key to a target value
- **WHEN** the worker returns its DiagnosticResult
- **THEN** the repair is emitted as a `next_action` claim
- **AND** `answers` references at least one relevant current must-answer item
- **AND** factual parts reference the supporting evidence

#### Scenario: No safe action is supported
- **GIVEN** worker evidence has been bounded and reviewed for the current goal
- **WHEN** available evidence supports a preliminary diagnosis but no safe corrective action
- **THEN** the worker does not invent a `next_action`
- **AND** review may present the diagnosis with an explicit remaining unknown

#### Scenario: Action requires destructive or write authorization
- **GIVEN** the worker remains under the read-oriented policy
- **WHEN** a possible next step would delete, overwrite, deploy, or modify user data/configuration
- **THEN** the worker frames it as a proposed human-authorized action
- **AND** does not claim the action has already been performed
- **AND** the read-oriented worker does not execute it

### Requirement: AnswerGoal decomposition observability is bounded and safe
Runtime SHALL record whether must-answer items came from model-assisted Preflight or compatibility fallback, the accepted item count, and a stable reason code. Logs SHALL NOT record secret values, hidden prompts, or a second rewritten user question.

#### Scenario: Malformed model items fall back
- **GIVEN** model-assisted Preflight returned proposed items
- **WHEN** deterministic reconciliation rejects model-proposed items
- **THEN** the event records `source=fallback`, item count, and a bounded reason code
- **AND** does not include the rejected item text

## MODIFIED Requirements

### Requirement: DiagnosticRequest carries a structured AnswerGoal
The runtime SHALL use `DiagnosticRequest.answerGoal` as the authoritative current-turn target for preflight, knowledge, worker, review, presentation, and audit logs. Model-assisted Preflight MAY propose 1–5 user-facing must-answer sub-goals; deterministic reconciliation SHALL accept an item only when its normalized text is a contiguous substring of the normalized local `resolvedQuestion`, in addition to shape and safety validation. After local shape/scope validation, a runtime-owned completeness-review service SHALL issue a separate model call through the registered non-user-facing `answer-goal-completeness` agent seam; that call SHALL receive only the safe normalized `resolvedQuestion` and proposed items, not proposer rationale or self-assessment. Its `AnswerGoalCompletenessReview`, not the proposer output, SHALL confirm that the proposed set represents every user answer obligation with no missing element. Any invalid, out-of-scope, incomplete, unavailable, malformed, or unknown review result SHALL replace the whole set with the compatibility sentinel. `rawUserQuestion`, `resolvedQuestion`, `answerObject`, and source message identities remain locally authoritative.

#### Scenario: Request is built from a user message
- **GIVEN** runtime has a locally resolved current user turn
- **WHEN** runtime builds a DiagnosticRequest
- **THEN** the request contains `answerGoal.rawUserQuestion`, `answerGoal.resolvedQuestion`, `answerGoal.answerObject`, `answerGoal.mustAnswerItems`, `answerGoal.diagnosticObjective`, and `answerGoal.sourceMessageIds`

#### Scenario: Follow-up keeps user-facing goal separate from diagnostic objective
- **GIVEN** runtime resolved a follow-up against stored case context
- **WHEN** runtime builds a follow-up DiagnosticRequest
- **THEN** `answerGoal.resolvedQuestion` remains the user-facing question
- **AND** internal process language is stored only in `answerGoal.diagnosticObjective`
- **AND** `diagnosticObjective` is not copied into must-answer items

#### Scenario: Model proposes valid must-answer items
- **GIVEN** model-assisted Preflight returns an array containing 1–5 strings
- **AND** every normalized string is 1–80 Unicode code points, control-character-free, and not secret-shaped
- **AND** every normalized string is a contiguous substring of the normalized local `resolvedQuestion`
- **AND** an independent completeness reviewer finds that the set represents every answer obligation with no missing element
- **WHEN** deterministic reconciliation trims, collapses whitespace, and stably deduplicates the array
- **THEN** the non-empty normalized items are accepted in first-occurrence order
- **AND** the model cannot rewrite `rawUserQuestion` or `resolvedQuestion`

#### Scenario: Duplicate valid items are proposed
- **GIVEN** every proposed element is individually valid
- **WHEN** two normalized items are identical
- **THEN** reconciliation keeps the first occurrence
- **AND** does not treat the duplicate alone as a malformed-set failure

#### Scenario: One model item is malformed
- **GIVEN** a proposed item is non-string, empty, over 80 Unicode code points, contains a control character, or is secret-shaped
- **WHEN** deterministic reconciliation validates the array
- **THEN** it rejects the entire proposed set
- **AND** uses `[DIRECT_ANSWER_ITEM]`
- **AND** does not partially accept the remaining elements

#### Scenario: Model item count is out of bounds
- **GIVEN** model-assisted Preflight returns a must-answer field
- **WHEN** model output is not an array, contains zero items, or contains more than five raw items
- **THEN** reconciliation uses `[DIRECT_ANSWER_ITEM]`
- **AND** the turn continues without an error

#### Scenario: Model preflight is unavailable
- **GIVEN** runtime has locally built the current resolved question
- **WHEN** the model is disabled, times out, fails, or omits `mustAnswerItems`
- **THEN** `mustAnswerItems` is `[DIRECT_ANSWER_ITEM]`
- **AND** the existing local Preflight path continues

#### Scenario: Accepted items survive request construction
- **GIVEN** deterministic reconciliation accepted model-proposed must-answer items
- **WHEN** AnswerGoal and DiagnosticRequest are finalized
- **THEN** no later local builder recreates AnswerGoal with the default sentinel
- **AND** downstream stages receive the accepted item set unchanged

#### Scenario: Model attempts to rewrite the question
- **GIVEN** runtime has locally built raw and resolved question fields
- **WHEN** model output includes alternative raw or resolved question fields
- **THEN** runtime ignores those values
- **AND** uses only the locally constructed question fields

#### Scenario: Shape-valid item is outside the resolved question
- **GIVEN** a proposed item is a safe string within all count and length bounds
- **BUT** its normalized text is not a contiguous substring of normalized `resolvedQuestion`
- **WHEN** deterministic reconciliation checks scope
- **THEN** it rejects the entire proposed set
- **AND** uses `[DIRECT_ANSWER_ITEM]`

#### Scenario: Diagnostic objective is copied into an item
- **GIVEN** diagnostic process text exists only in `diagnosticObjective` and not in `resolvedQuestion`
- **WHEN** the model copies that text into `mustAnswerItems`
- **THEN** deterministic scope validation rejects the set
- **AND** the process text does not become a user-visible answer requirement

#### Scenario: Proposed set omits one user sub-question
- **GIVEN** `resolvedQuestion` asks “如何开启 X，多久生效”
- **AND** the proposer returns only “如何开启 X”
- **WHEN** the independent completeness reviewer compares the full question and proposed set
- **THEN** it reports the activation-time obligation missing
- **AND** reconciliation uses `[DIRECT_ANSWER_ITEM]`

#### Scenario: Completeness reviewer is unavailable
- **GIVEN** proposed items pass shape, safety, and contiguous-substring checks
- **WHEN** the independent completeness reviewer fails, is malformed, or returns `unknown`
- **THEN** reconciliation uses `[DIRECT_ANSWER_ITEM]`
- **AND** does not treat proposer self-certification as completeness proof
