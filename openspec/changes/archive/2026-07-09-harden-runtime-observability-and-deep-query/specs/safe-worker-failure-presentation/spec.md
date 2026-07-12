## MODIFIED Requirements

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
