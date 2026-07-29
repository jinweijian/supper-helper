## ADDED Requirements

### Requirement: Reply anchors to the runtime-owned current question
Every user-visible reply produced from a reviewed `DiagnosticResult` SHALL open with a deterministic anchor derived only from `answerGoal.resolvedQuestion`. Runtime SHALL normalize, redact, and bound the target to at most 160 Unicode code points; model-provided answer-target text and `diagnosticObjective` SHALL NOT participate in rendering. Preflight follow-up questions, Case Curator messages, and transport/system errors are outside this frozen-review requirement and remain governed by their existing safe formatting contracts.

#### Scenario: Model-planned result is presented
- **GIVEN** a valid model presentation plan
- **WHEN** runtime renders the reviewed result
- **THEN** the opening addresses the bounded runtime-derived resolved question
- **AND** appears before the conclusion or outcome label

#### Scenario: Fallback result is presented
- **GIVEN** review has frozen a valid DiagnosticResult projection
- **WHEN** model Presentation is unavailable or invalid
- **THEN** deterministic fallback uses the same runtime-derived question anchor

#### Scenario: Model invents a different target
- **GIVEN** runtime has derived the safe bounded target from the current AnswerGoal
- **WHEN** model output contains an `answerTarget` that differs from `answerGoal.resolvedQuestion`
- **THEN** runtime ignores the model value for rendering

#### Scenario: Resolved question contains sensitive text
- **GIVEN** the resolved question includes a secret-shaped value or an internal absolute path
- **WHEN** runtime builds the anchor
- **THEN** the sensitive portion is redacted before length bounding
- **AND** the complete reply contains no original sensitive value

#### Scenario: Safe anchor becomes empty
- **GIVEN** a reviewed DiagnosticResult is ready for Presentation
- **WHEN** normalization and redaction leave no safe question text
- **THEN** runtime uses a neutral non-factual anchor such as“针对你当前的问题”
- **AND** does not expose `diagnosticObjective` as a substitute

### Requirement: Both Presentation paths render the same frozen required content
Model-planned rendering and deterministic fallback SHALL render the same safe materialized projection, including the primary or preliminary answer, relevant accepted next actions, and bounded relevant supporting claims. The renderer SHALL NOT receive raw `DiagnosticResult` or look up text from all claims/evidence. A model plan MAY order allowed sections and non-sequential supporting content, but SHALL preserve the frozen primary sequence and actionable sequence, SHALL NOT omit a required visible claim, and SHALL NOT replace it with generic advice.

#### Scenario: Worker returns actionable next steps
- **GIVEN** review freezes accepted `next_action` claims relevant to the AnswerGoal
- **WHEN** either Presentation path renders the reply
- **THEN** every bounded frozen actionable claim is visible
- **AND** the steps preserve their original order, modality, operation object, and execution state
- **AND** renderer does not truncate a configuration key/value, command, numbered step, or conclusion mid-unit

#### Scenario: Model omits one frozen step
- **GIVEN** review has frozen an ordered actionable sequence
- **WHEN** a model plan does not include a required actionable claim
- **THEN** runtime rejects the plan
- **AND** fallback renders the complete frozen projection

#### Scenario: Partial result has a supported preliminary judgment
- **GIVEN** review freezes a relevant accepted primary fact/inference as preliminary
- **WHEN** the partial reply is rendered
- **THEN** the reply leads with that bounded judgment after the anchor
- **AND** labels it as preliminary
- **AND** states that it is not a final conclusion

#### Scenario: Only supporting inference remains
- **GIVEN** no relevant accepted primary fact/inference remains
- **AND** a relevant accepted supporting inference is safely materialized
- **WHEN** a non-final reply is rendered
- **THEN** it is labeled as “推断线索” or equivalent inference wording
- **AND** is not called confirmed fact or used as direct answer

#### Scenario: No safe actionable claim exists
- **GIVEN** review has completed safety projection for accepted actions
- **WHEN** the frozen projection contains no actionable claim
- **THEN** renderer may include bounded read-only generic guidance
- **AND** labels it as general guidance
- **AND** does not imply a diagnosis-specific cause or completed action

### Requirement: Visible segment bounds preserve semantic units
Safe projection SHALL accept primary, preliminary, and actionable claim text only when each complete normalized/redacted segment is at most 1000 Unicode code points; supporting claim text SHALL be at most 600; unknown and missing-info prompts SHALL contain at most five items of at most 300 each; fixed generic guidance SHALL be at most 300. Renderer SHALL NOT character-truncate claims to satisfy these bounds.

#### Scenario: Required action is exactly 1000 code points
- **GIVEN** a safe accepted next action is exactly 1000 Unicode code points and remains one complete semantic unit
- **WHEN** projection materializes it
- **THEN** it may remain a required visible segment without truncation

#### Scenario: Required action is 1001 code points
- **GIVEN** an accepted required next action is 1001 Unicode code points
- **WHEN** projection materializes it
- **THEN** it records a result-global blocker and re-freezes the outcome before rendering
- **AND** does not display a 1000-code-point prefix as if the action were complete

#### Scenario: Optional supporting claim exceeds 600 code points
- **GIVEN** an optional supporting claim is 601 Unicode code points
- **WHEN** safe projection is built
- **THEN** the claim is excluded with a bounded reason
- **AND** exclusion alone does not promote or invent another claim

#### Scenario: Missing-info prompt exceeds its bound
- **GIVEN** one missing-info entry is 301 Unicode code points or more than five entries are supplied
- **WHEN** prompt segments are validated
- **THEN** over-bound entries are excluded rather than character-truncated
- **AND** if no safe user-resolvable prompt remains, an ask-user candidate falls to partial according to the frozen outcome table

### Requirement: Persona adaptation preserves safe executable meaning
Persona adaptation SHALL preserve safe user-actionable configuration keys, target values, file names, interface names, error type names, and user-operable setting/page names. It SHALL redact secret-shaped values, internal knowledge source identities, and unsafe absolute path segments, with safety taking precedence over preservation.

#### Scenario: Operations user receives a configuration repair
- **GIVEN** an accepted next action says to change `search.provider` to `embedding`
- **WHEN** operations, support, or developer formatting is applied
- **THEN** the key and target value remain visible and actionable

#### Scenario: Customer receives a user-operable setting
- **GIVEN** an accepted claim references a setting or page the customer can operate
- **WHEN** customer formatting simplifies technical context
- **THEN** the operable setting/page name remains identifiable
- **AND** the claim's factual polarity and action state do not change

#### Scenario: Absolute path contains a safe file name
- **GIVEN** an accepted claim contains an absolute path with a non-sensitive file name
- **WHEN** redaction is applied
- **THEN** internal directory segments are hidden
- **AND** the safe file name may remain

#### Scenario: File name is itself sensitive
- **GIVEN** a file name or configuration value matches the secret or internal-source policy
- **WHEN** redaction is applied
- **THEN** it is redacted even though ordinary file names or keys would be preserved

### Requirement: Every visible surface uses one redaction and fact boundary
The anchor, primary/preliminary answer, supporting text, next actions, unknowns, missing information, and general guidance SHALL use the same normalization, secret/path/internal-source redaction, bounding, and final whole-reply scan. Opaque unknown/missing-info strings SHALL additionally require an independent accepted non-factual prompt review before materialization. Runtime SHALL call the registered non-user-facing model-assisted `visible-prompt-safety` reviewer only with bounded secret/path-redacted candidates, at most once and with at most ten candidates per turn; the reviewer SHALL only accept/reject stable IDs and SHALL NOT rewrite text. Rejected or unselected facts SHALL NOT be recovered from summary, evidence excerpts, prompt strings, templates, or later paragraphs.

#### Scenario: Rejected content survives in the original summary
- **GIVEN** a rejected claim's text is also present in `DiagnosticResult.summary`
- **WHEN** the reply is rendered
- **THEN** the text is absent unless independently present in a frozen accepted claim

#### Scenario: Secret appears in a next action
- **GIVEN** review has selected an otherwise relevant next action
- **WHEN** a frozen next action contains a token-shaped literal
- **THEN** the token is redacted before persona formatting
- **AND** the whole-reply scan confirms that it is absent

#### Scenario: Missing-info request asserts a cause
- **GIVEN** a missing-info string contains a request plus a cause not present in accepted claims
- **WHEN** visible-prompt safety review evaluates it
- **THEN** the entire opaque string is rejected
- **AND** renderer does not preserve the unsupported cause merely because the string came from `missingInfo`

#### Scenario: Template attempts to add a fixed diagnosis
- **GIVEN** renderer is formatting a frozen projection for a persona
- **WHEN** a persona template contains a cause, impact, recovery method, or fixed step not represented by frozen claims
- **THEN** that factual template content is not rendered

### Requirement: Internal process material remains non-user-visible
Process notes, evidence locator claims, Evidence Judge scores, route decisions, and bounded redacted worker/provider status MAY remain in logs/audit and SHALL NOT appear in the main reply. Complete provider payloads, full `retrieval_text`, complete source bodies, and internal knowledge source paths SHALL NOT enter persisted logs/audit or the main reply; full retrieval text remains only in its rebuildable index artifact or transient in-memory retrieval input.

#### Scenario: Fallback receives process notes and trace
- **GIVEN** a validated result includes accepted process notes and runtime trace metadata
- **WHEN** deterministic fallback renders the user reply
- **THEN** neither the process note nor trace appears
- **AND** only frozen user-visible content is used
