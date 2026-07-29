## ADDED Requirements

### Requirement: Claim-local rejection does not automatically downgrade the result
Deterministic validation SHALL remove a claim-local invalid claim and then re-evaluate the validated result. A local rejection SHALL NOT by itself downgrade an otherwise valid outcome; coverage loss, an explicit structured upstream conflict blocker, result identity corruption, or user-visible safety failure SHALL be treated as separate result-global blockers. Runtime SHALL NOT infer semantic claim conflicts with ad hoc natural-language keywords.

#### Scenario: Invalid supporting claim does not poison a valid final answer
- **GIVEN** the worker result is `concluded` with `recommendedNextAction=final_answer`
- **AND** accepted `primary_answer` claims collectively cover every `answerGoal.mustAnswerItems` entry
- **AND** no other result-global blocker exists
- **WHEN** one supporting claim is rejected because it references nonexistent evidence
- **THEN** only the offending supporting claim is removed
- **AND** the frozen outcome is `final`
- **AND** the rejection reason is recorded without the rejected text entering the reply

#### Scenario: Local rejection causes a real coverage blocker
- **GIVEN** a primary claim is rejected for a claim-local evidence failure
- **WHEN** the remaining accepted primary claims no longer cover every must-answer item
- **THEN** the coverage loss is recorded as a result-global blocker
- **AND** the result is not final

#### Scenario: Upstream review reports an explicit conflict
- **GIVEN** Evidence Review emits a structured conflict blocker with bounded source/evidence identities for the current AnswerGoal
- **AND** the blocker remains unresolved
- **WHEN** deterministic review freezes the outcome
- **THEN** the conflict blocks final presentation
- **AND** Presentation cannot select one side to promote the result

#### Scenario: No structured conflict signal exists
- **GIVEN** two claim texts could be interpreted as semantically inconsistent
- **AND** no upstream structured conflict blocker exists
- **WHEN** deterministic claim validation runs
- **THEN** it does not use hardcoded words or fixture-specific text to invent a conflict decision

#### Scenario: Review cannot upgrade an upstream partial result
- **GIVEN** a worker result is partial or recommends `ask_user`
- **WHEN** rejected claims are removed and the remaining claims happen to cover all must-answer items
- **THEN** deterministic review does not upgrade the result to final

### Requirement: Review freezes one complete user-visible projection
Before Presentation, runtime SHALL first derive a reviewed ID selection, then materialize a safe frozen answer projection containing bounded/redacted claim segments, bounded/redacted evidence segments with claim bindings, prompt segments with provenance, runtime-owned answer target, final outcome, and required visible claim IDs. Opaque unknown/missing-info candidates SHALL be secret/path-redacted before a runtime-owned service submits at most one batch of at most ten candidates per turn to the registered non-user-facing model-assisted `visible-prompt-safety` reviewer; the reviewer may only accept or reject stable candidate IDs and may not rewrite text. Missing decisions, malformed output, timeout, provider failure, or `unknown` SHALL leave affected prompts unmaterialized. A required segment safety failure SHALL be converted into a result-global blocker and the outcome SHALL be re-frozen before rendering. The renderer SHALL accept only the safe projection and SHALL NOT receive raw `DiagnosticResult`, summary, all claims/evidence, or worker trace, and SHALL NOT resolve an evidence ID back into raw evidence.

#### Scenario: Summary repeats a rejected fact
- **GIVEN** a claim is rejected during validation
- **AND** the original result summary repeats the rejected claim text
- **WHEN** the frozen projection is rendered
- **THEN** the summary is not used as a factual source
- **AND** the rejected fact does not appear anywhere in the reply

#### Scenario: Renderer cannot reach raw result
- **GIVEN** safe projection materialization has completed
- **WHEN** model-planned or fallback rendering begins
- **THEN** its production input contains only safe materialized segments, frozen metadata, persona, and allowed layout
- **AND** contains no raw result, full summary, rejected/unselected claim, unbound evidence, or worker trace

#### Scenario: Required action cannot be safely materialized
- **GIVEN** a selected required next action exceeds its complete safe boundary or cannot be redacted without losing its operation meaning
- **WHEN** safe projection materialization runs
- **THEN** runtime records a result-global blocker
- **AND** re-freezes the outcome before Presentation
- **AND** does not truncate the action and keep final

#### Scenario: Missing-info string embeds an unsupported assertion
- **GIVEN** `missingInfo` asks for a log but also asserts an unreviewed failure cause
- **WHEN** independent visible-prompt safety review evaluates the bounded secret/path-redacted candidate
- **THEN** it rejects the string instead of rewriting or rendering it
- **AND** runtime re-freezes an ask-user candidate if no other safe prompt remains

#### Scenario: Prompt safety reviewer is unavailable
- **GIVEN** unknown or missing-info strings otherwise pass shape, redaction, and length checks
- **WHEN** visible-prompt safety review fails, is malformed, or returns unknown
- **THEN** those opaque strings are not included in the safe projection
- **AND** source-kind metadata alone is not treated as proof that they contain no facts

#### Scenario: Accepted actionable claims are frozen as required content
- **GIVEN** accepted `next_action` claims answer the current AnswerGoal
- **WHEN** review creates the frozen projection
- **THEN** the relevant bounded actions are included in `requiredVisibleClaimIds`
- **AND** both model-planned and fallback rendering must present them

#### Scenario: Evidence is bound only through selected claims
- **GIVEN** the validated result contains evidence not referenced by any frozen visible claim
- **WHEN** review derives projection evidence IDs
- **THEN** the unrelated evidence is excluded
- **AND** it cannot be selected by Presentation or fallback

#### Scenario: Selected evidence is materialized safely
- **GIVEN** a frozen visible claim directly references accepted evidence
- **WHEN** safe projection materializes that evidence
- **THEN** it contains only a bounded/redacted evidence segment, evidence ID, and bound visible claim IDs
- **AND** renderer has no API to fetch the original evidence summary, source body, or retrieval text

#### Scenario: Preliminary judgment comes from a relevant primary claim
- **GIVEN** final coverage is incomplete
- **AND** an accepted fact or inference with `role=primary_answer` answers at least one current must-answer item
- **WHEN** review creates a non-final projection
- **THEN** that claim may be frozen as a bounded preliminary judgment
- **AND** a `supporting_context`, `process_note`, or `evidence_locator` claim cannot replace it

#### Scenario: Only accepted supporting fact or inference remains
- **GIVEN** final coverage is incomplete
- **AND** no relevant accepted primary fact/inference remains
- **AND** a relevant accepted `supporting_context` fact/inference remains
- **WHEN** review creates the non-final projection
- **THEN** a supporting fact is labeled as bounded “已确认线索”
- **AND** a supporting inference is labeled as bounded “推断线索”
- **AND** it appears before the insufficiency explanation
- **AND** it is not frozen as direct answer, does not count as primary coverage, and is not styled as a final or primary conclusion

### Requirement: Model presentation violations have deterministic fatal and droppable handling
Runtime SHALL stably deduplicate and validate a model presentation plan against the frozen projection. Unknown optional IDs, forbidden non-answer roles, and unreferenced extra evidence MAY be dropped; malformed structure, a direct-answer mismatch, omission of required visible claims, missing required evidence, or an empty sanitized plan SHALL be fatal and use deterministic fallback.

#### Scenario: Plan contains an unknown optional claim ID
- **GIVEN** the plan contains every frozen required visible claim
- **WHEN** one additional optional claim ID is unknown
- **THEN** runtime drops the unknown optional ID
- **AND** revalidates and renders the remaining plan if all frozen constraints still hold

#### Scenario: Plan omits a required action
- **GIVEN** a frozen accepted `next_action` is a required visible claim
- **WHEN** the model plan omits that claim
- **THEN** runtime rejects the plan
- **AND** deterministic fallback renders the complete frozen projection

#### Scenario: Plan selects a process note
- **GIVEN** a plan contains valid answer claim IDs
- **WHEN** it additionally selects a `process_note` or `evidence_locator`
- **THEN** runtime drops the forbidden ID
- **AND** revalidates the remaining plan

#### Scenario: Plan lacks evidence required by a selected factual claim
- **GIVEN** a selected accepted fact depends on frozen evidence
- **WHEN** the model plan omits or replaces that required evidence identity
- **THEN** runtime treats the plan as fatal
- **AND** deterministic fallback uses the frozen evidence boundary

#### Scenario: Plan structure is malformed
- **GIVEN** review has already frozen a valid answer projection
- **WHEN** model output is malformed JSON or a required ID field is not an array of strings
- **THEN** runtime does not partially interpret the malformed structure
- **AND** uses deterministic fallback

#### Scenario: Sanitized plan is empty
- **GIVEN** review has already frozen a non-empty required projection
- **WHEN** all selected model IDs are removed during deterministic sanitization
- **THEN** runtime uses deterministic fallback from the same frozen projection and outcome

### Requirement: Entire visible reply passes final safety and fact validation
Runtime SHALL apply redaction and a structural factual-provenance check to the complete assembled reply, including the question anchor, primary/preliminary answer, supporting content, next actions, unknowns, missing information, and generic guidance. Every factual/action segment SHALL map to a safe frozen accepted claim ID and directly bound evidence; unknown/missing-info segments SHALL carry both an allowed source kind and an independent accepted non-factual prompt review. A deterministic final text scan SHALL check secrets, paths, trace, and provider payloads, not guess semantic truth with natural-language heuristics.

#### Scenario: Unsupported fact appears after the first paragraph
- **GIVEN** the first paragraph contains only accepted primary content
- **WHEN** a later paragraph adds an unsupported cause, impact, recovery method, or performed action
- **THEN** final validation rejects that rendered reply
- **AND** runtime uses a safe deterministic rendering or downgrades when required content cannot be rendered safely

#### Scenario: Missing information is rendered as a fact
- **GIVEN** a prompt segment originates from validated `missingInfo`
- **WHEN** a renderer attempts to place it in a factual conclusion section
- **THEN** the structural provenance check rejects the rendering
- **AND** permits the segment only as a bounded user-information request

#### Scenario: Secret appears in missing information
- **GIVEN** a `missingInfo` or `unknown` item contains a secret-shaped string or internal absolute path
- **WHEN** the full reply is assembled
- **THEN** the same redaction policy used for claims is applied before return
- **AND** the secret or internal path is absent from the entire reply

## MODIFIED Requirements

### Requirement: Review outcome is frozen before presentation
The deterministic Review Gate SHALL decide `ask_user`, `partial`, `final`, or `escalate` before Presentation and Presentation MUST NOT promote or replace that outcome. A model plan with only explicitly droppable optional violations MAY be sanitized and rendered after revalidation; malformed or frozen-boundary violations SHALL use deterministic fallback from the same outcome and projection.

#### Scenario: Model requests final for partial result
- **GIVEN** deterministic review froze a partial outcome
- **WHEN** the Presentation model returns wording or metadata that implies final answer
- **THEN** runtime keeps partial
- **AND** renders only the frozen non-final projection

#### Scenario: Presentation has only a droppable optional violation
- **GIVEN** a model plan contains all frozen required claims and evidence
- **WHEN** it additionally contains an unknown optional non-direct claim, forbidden process role, duplicate ID, or unreferenced extra evidence
- **THEN** runtime applies the declared droppable rule
- **AND** revalidates the sanitized plan
- **AND** may render it only when every frozen constraint remains satisfied

#### Scenario: Presentation has a fatal violation
- **GIVEN** review has frozen an outcome and required projection
- **WHEN** model output is malformed, changes direct-answer identity, omits required content, lacks required evidence, or has no usable plan
- **THEN** runtime uses deterministic formatting from the same frozen outcome and projection
- **AND** does not treat every unknown optional ID as fatal when its declared droppable preconditions hold

### Requirement: Review freezes a primary answer for the current AnswerGoal
The runtime SHALL validate accepted claims against `DiagnosticRequest.answerGoal` before presentation. Raw `claim.answers` are candidate declarations only. A runtime-owned coverage-review service SHALL use the registered non-user-facing model-assisted `evidence-coverage` seam independently of every producer, in at most one batch of at most twenty candidate accepted claims per reviewed turn; overflow, unavailable, malformed, or unknown review output SHALL NOT grant coverage. The reviewer SHALL return both reviewed claim→item bindings and `fullQuestionClaimIds`, the evidence-supported primary claims that must collectively appear for the complete `resolvedQuestion` to be fully answered. Runtime SHALL freeze the original-order stable union of the greedy item-cover set and valid `fullQuestionClaimIds`. A final answer SHALL require that union to cover every `answerGoal.mustAnswerItems` entry and include every valid full-question-required claim, with no missing element. No single claim is required to cover all entries; every frozen primary claim SHALL either add reviewed item coverage or belong to the reviewed full-question-required set.

#### Scenario: Multiple primary claims collectively cover the AnswerGoal
- **GIVEN** no single accepted primary claim covers all must-answer items
- **AND** independent review accepts bindings from two primary claims that together cover every item and the full resolved question
- **WHEN** review freezes the primary answer in original claim order
- **THEN** both coverage-contributing claim IDs are frozen as the direct answer
- **AND** the result remains eligible for final when all other final conditions hold
- **AND** each inference claim remains visibly identified as inference rather than being relabeled as fact

#### Scenario: Redundant primary claim adds no coverage
- **GIVEN** earlier accepted primary claims already have reviewed bindings for every item supported by a later primary claim
- **AND** the later claim is not included in valid `fullQuestionClaimIds`
- **WHEN** review computes the stable covering set
- **THEN** the redundant claim is not required as a direct-answer claim
- **AND** it cannot make coverage order non-deterministic

#### Scenario: Same-item claim is required for the complete question
- **GIVEN** one primary claim answers how to enable X
- **AND** another evidence-supported primary claim adds the activation-time condition under the same must-answer item
- **AND** independent review includes both IDs in `fullQuestionClaimIds`
- **WHEN** runtime freezes the primary answer
- **THEN** both claims remain in original order even if the second adds no new item binding
- **AND** final eligibility cannot be based on the greedy item-cover claim alone

#### Scenario: Final result has no complete primary coverage
- **GIVEN** a worker returns `status=concluded` and `recommendedNextAction=final_answer`
- **AND** reviewed primary bindings do not cover every must-answer item or full-question review reports a missing element
- **WHEN** deterministic review freezes the result
- **THEN** runtime downgrades the result
- **AND** the reply cannot present supporting or process claims as a final conclusion

#### Scenario: Missing coverage can be resolved by user input
- **GIVEN** final coverage is incomplete
- **AND** validated non-empty `missingInfo` identifies information the user can safely provide
- **AND** no upstream escalation or unresolvable safety/identity blocker exists
- **WHEN** review freezes the outcome
- **THEN** the outcome is `ask_user`
- **AND** the bounded question is rendered after any eligible preliminary judgment

#### Scenario: Missing coverage has no user-resolvable question
- **GIVEN** final coverage is incomplete
- **AND** no validated user-resolvable `missingInfo` exists
- **AND** no safety or identity blocker requires escalation
- **WHEN** review freezes the outcome
- **THEN** the outcome is `partial`
- **AND** any eligible relevant accepted primary fact/inference is labeled as a preliminary judgment
- **AND** any remaining relevant accepted supporting fact is shown as non-primary confirmed context
- **AND** any remaining relevant accepted supporting inference is shown as a non-primary inference clue rather than confirmed fact or suppressed

#### Scenario: Escalation blocker outranks ordinary missing information
- **GIVEN** the worker candidate outcome is `escalate` or review finds a safety/identity blocker that user input cannot resolve
- **AND** the result also contains ordinary `missingInfo`
- **WHEN** review freezes the outcome
- **THEN** the outcome is `escalate`
- **AND** Presentation does not downgrade the blocker to a routine ask-user flow

#### Scenario: Process note attempts to become conclusion
- **GIVEN** a claim has role `process_note`, `evidence_locator`, or `supporting_context`
- **WHEN** review derives primary or preliminary direct-answer IDs
- **THEN** Presentation MUST NOT use it as a frozen primary or preliminary direct answer

### Requirement: Presentation stays inside frozen claim and evidence boundaries
The runtime SHALL validate Presentation output against the frozen answer projection before returning it to the user. Presentation MAY order allowed sections and non-sequential supporting IDs, but SHALL preserve the frozen primary order and actionable order and SHALL NOT change the outcome, answer target, required visible set, accepted claim text semantics, or directly bound evidence.

#### Scenario: Duplicate direct answer IDs hide a missing frozen primary claim
- **GIVEN** review has frozen a non-empty primary answer ID set
- **WHEN** Presentation returns `directAnswerClaimIds` with duplicate IDs
- **AND** the stable unique set does not equal frozen primary answer claim IDs
- **THEN** runtime rejects the Presentation output
- **AND** falls back to the frozen primary answers

#### Scenario: Presentation cites unrelated evidence
- **GIVEN** review has frozen selected claims and their directly bound evidence
- **WHEN** Presentation returns an evidence ID that exists in the result
- **BUT** that evidence is not referenced by any selected frozen claim
- **THEN** runtime drops the unreferenced evidence
- **AND** revalidates the plan

#### Scenario: Presentation invents its own answer target
- **GIVEN** runtime has derived a bounded answer target from the current AnswerGoal
- **WHEN** model output contains an `answerTarget` different from that target
- **THEN** the model value is ignored for rendering
- **AND** the runtime-owned target remains authoritative

#### Scenario: Supported wording uses natural modal words
- **GIVEN** review has frozen an accepted next action
- **WHEN** deterministic persona formatting preserves it with natural wording
- **AND** the wording retains the claim's original modality and execution state
- **THEN** runtime MUST NOT reject it only because it contains generic words such as “需要”或“必须”
