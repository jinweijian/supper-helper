## Purpose

Define the boundary that prevents raw worker command output, provider payloads, and internal prompt data from reaching the user-facing reply, while preserving bounded redacted troubleshooting data in diagnostic logs.
## Requirements
### Requirement: Worker raw failure output stays in diagnostic logs
Worker command, cwd, stdout, stderr, stack, raw provider payload, and internal prompt data MUST NOT be copied into the main user-facing reply.

#### Scenario: Worker exits nonzero
- **WHEN** a worker fails before producing a usable result
- **THEN** the main reply contains a safe failure category, current diagnosis state, next action, and case/run identity while raw output remains in the diagnostic log

#### Scenario: Presentation model also fails
- **WHEN** worker failure is followed by model review/presentation failure
- **THEN** deterministic safe failure formatting is used and raw stdout/stderr is still not exposed

### Requirement: Failure logging remains redacted and auditable
Diagnostic logs SHALL retain bounded troubleshooting data after existing redaction and SHALL classify worker failure severity and phase. The redaction SHALL apply uniformly to all model and worker raw outputs persisted in log `detail.raw` or `detail.stdout` fields, including `modelPreflightResult`, `modelReviewResult`, and `raw_output` phases, using `redactProviderErrorMessage` followed by `slice(0, 2000)`.

#### Scenario: Failure output contains secret-like text
- **WHEN** stdout, stderr, or error contains API keys, bearer tokens, cookies, or configured secrets
- **THEN** stored and rendered log details redact those values

#### Scenario: Model preflight raw output is redacted and truncated
- **WHEN** the input-review agent records a `model_preflight_result` log event and the model raw output contains chain-of-thought or secret-like text
- **THEN** `detail.raw` SHALL be passed through `redactProviderErrorMessage` and truncated to at most 2000 characters before persistence, and `detail.parsed` SHALL be the authoritative decision record

#### Scenario: Model review raw output is redacted and truncated
- **WHEN** the output-review agent records a `model_review_result` log event
- **THEN** `detail.raw` SHALL be passed through `redactProviderErrorMessage` and truncated to at most 2000 characters, consistent with `model_preflight_result` redaction

#### Scenario: Worker raw stdout is redacted
- **WHEN** the runtime records a `raw_output` log event from a worker trace
- **THEN** `detail.stdout` SHALL be passed through `redactProviderErrorMessage` before persistence, in addition to existing stderr and error redaction

#### Scenario: Chain-of-thought text is stripped from logs
- **WHEN** any model raw output contains chain-of-thought text such as "Let me analyze the situation..." or "I need to think about..."
- **THEN** the redacted `detail.raw` SHALL NOT contain the full chain-of-thought; only bounded truncated text remains for troubleshooting

