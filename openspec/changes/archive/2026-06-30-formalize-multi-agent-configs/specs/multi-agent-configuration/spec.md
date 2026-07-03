## ADDED Requirements

### Requirement: Centralized product Agent configuration directory

The system SHALL treat `src/agents/` as the authoritative home for product Agent configuration documents.

#### Scenario: Main Agent config exists in source agents directory

- **WHEN** a developer looks for the product main Agent behavior configuration
- **THEN** the authoritative file SHALL be `src/agents/main.md`

#### Scenario: Future sub-agent configs have a single home

- **WHEN** a future sub-agent configuration is added
- **THEN** it SHALL be placed under `src/agents/` instead of root files, runtime helper files, worker adapter files, or general docs

#### Scenario: Current configured sub-agents exist

- **WHEN** the initial multi-agent configuration is implemented
- **THEN** `src/agents/` SHALL contain configs for `main`, `input-review`, `experience`, `output-review`, and `presentation`

### Requirement: Agent role pairing registry

The system SHALL provide a role pairing registry under `src/agents/` that maps runtime stages to product Agent config files.

#### Scenario: Initial role pairings are configured

- **WHEN** the runtime resolves Agent configs for the current pipeline
- **THEN** the registry SHALL map `main` to `main.md`, `input_review` to `input-review.md`, `preflight` to `input-review.md`, `experience` to `experience.md`, `output_review` to `output-review.md`, and `presentation` to `presentation.md`

#### Scenario: Registry entries declare required metadata

- **WHEN** an Agent registry entry is added
- **THEN** it MUST declare an agent id, role, runtime stage, config path, whether it is required, and whether it may produce user-facing text

#### Scenario: Future Agent extension uses registry

- **WHEN** a future Agent role is added to the product
- **THEN** the new Agent config and its stage pairing SHALL be discoverable from `src/agents/` without requiring readers to inspect runtime helper internals

### Requirement: Repository development rules remain separate from product Agent behavior

The system MUST keep repository development instructions separate from product Agent runtime behavior configuration.

#### Scenario: Coding agent reads repository instructions

- **WHEN** a coding agent or developer needs rules for modifying this repository
- **THEN** they SHALL use root `AGENTS.md` and `docs/standards/development.md`

#### Scenario: Product runtime reads Agent behavior

- **WHEN** the super helper runtime needs the main Agent behavior specification
- **THEN** it SHALL use `src/agents/main.md`, not root `AGENTS.md`

#### Scenario: Root AGENT ambiguity is removed

- **WHEN** the repository docs describe Agent-related files
- **THEN** they SHALL distinguish repository coding-agent rules from product runtime Agent configuration without requiring product behavior text in root `AGENT.md`

### Requirement: Main Agent role is explicit

The system SHALL define the main Agent as the product coordinator for intake, preflight, diagnostic request creation, worker dispatch decisions, evidence review, presentation, and sub-agent coordination policy.

#### Scenario: Main Agent remains the user-facing coordinator

- **WHEN** the runtime completes a user turn
- **THEN** final user-facing replies SHALL still pass through the main Agent review and presentation responsibilities

#### Scenario: Worker output cannot bypass main Agent review

- **WHEN** a worker returns a `DiagnosticResult`
- **THEN** the result MUST be reviewed by the main Agent runtime pipeline before any user-facing final answer is recorded

#### Scenario: Main Agent delegates configured stage work

- **WHEN** the runtime needs input review, preflight, output review, or presentation guidance
- **THEN** it SHALL resolve the configured stage Agent through the role pairing registry instead of relying only on a monolithic main Agent config

### Requirement: Sub-agent configs are narrow product reasoning roles

The system SHALL define future sub-agents as narrow product reasoning roles configured under `src/agents/`.

#### Scenario: Sub-agent config declares its contract

- **WHEN** a sub-agent configuration is added
- **THEN** the config MUST declare its role, responsibility, input contract, output contract, allowed dependencies, and whether it may produce user-facing text

#### Scenario: Input review Agent owns input and preflight guidance

- **WHEN** the runtime performs input review or Preflight Gate prompting
- **THEN** it SHALL use the configured `input-review` Agent role for user input sufficiency, missing information, and dispatch readiness guidance

#### Scenario: Experience Agent owns prior answer reuse

- **WHEN** the runtime receives a user question that matches a prior readable case answer with reusable evidence
- **THEN** it SHALL use the configured `experience` Agent role to review the prior answer before deciding whether to skip Claude Code

#### Scenario: Output review Agent owns evidence audit guidance

- **WHEN** the runtime audits a worker `DiagnosticResult`
- **THEN** it SHALL use the configured `output-review` Agent role for supported-claim review, unknown handling, continuation decisions, and escalation decisions

#### Scenario: Presentation Agent owns final wording guidance

- **WHEN** the runtime formats a reviewed decision for the user
- **THEN** it SHALL use the configured `presentation` Agent role for persona-aware wording and MUST NOT let that role add unsupported facts

#### Scenario: Sub-agent cannot replace coordinator ownership

- **WHEN** a sub-agent produces an intermediate decision or draft
- **THEN** the main Agent SHALL remain responsible for final evidence review and user-facing response ownership

#### Scenario: Worker is not mistaken for sub-agent

- **WHEN** architecture docs describe Claude Code or MCP tools
- **THEN** they MUST describe them as diagnostic tools or workers, not product sub-agents that can directly answer users

### Requirement: Runtime loads main Agent config from centralized path

The runtime SHALL load the main Agent behavior specification from `src/agents/main.md` and stage-specific Agent specifications through the configured role pairing registry.

#### Scenario: Runtime initializes with main Agent spec

- **WHEN** `DiagnosticRuntime` is constructed
- **THEN** it SHALL read the main Agent behavior specification from the centralized agents directory

#### Scenario: Runtime resolves stage-specific configs

- **WHEN** `DiagnosticRuntime` builds model preflight, experience reuse, model review, or presentation guidance
- **THEN** it SHALL resolve the relevant stage Agent config through the registry

#### Scenario: Build output preserves config loading

- **WHEN** the TypeScript project is built and tests run against `dist/`
- **THEN** runtime tests SHALL verify that the main Agent behavior source remains available and behavior-compatible

### Requirement: Development standards include the agents module boundary

Development documentation MUST include `src/agents/` as a first-class module boundary.

#### Scenario: Developer checks module ownership

- **WHEN** a developer reads `docs/standards/development.md`
- **THEN** they SHALL find that `src/agents/` owns product Agent configuration documents and role pairing registry, and must not own runtime orchestration, HTTP routing, worker execution, or persistence

#### Scenario: Docs lint guards the new boundary

- **WHEN** `pnpm lint` runs
- **THEN** docs verification SHALL check the presence of the centralized Agent config path, configured sub-agent names, and the separation between `AGENTS.md` and product Agent configs

### Requirement: Agent identity is visible in diagnostics and runtime activity

The system SHALL attach Agent identity metadata to diagnostic events and expose recent Agent activity while a turn is running.

#### Scenario: Diagnostic log shows Agent identity

- **WHEN** a diagnostic log event is produced by a product Agent stage
- **THEN** the stored event and log drawer block SHALL include the responsible Agent id or role label

#### Scenario: Loading state shows Agent activity

- **WHEN** an async chat turn is still diagnosing or ready for diagnosis
- **THEN** the session response SHALL include recent Agent activity and the UI loading state SHALL show which Agent stages are active or recently completed

#### Scenario: Worker events remain distinct from Agent events

- **WHEN** Claude Code command or raw output events are shown
- **THEN** they SHALL remain labeled as worker/tool activity rather than product sub-agent activity

### Requirement: Experience Agent can safely short-circuit repeated questions

The system SHALL provide an `experience` Agent workflow that can reuse prior session answers when safe.

#### Scenario: Repeated question reuses prior answer without Claude Code

- **WHEN** a new user question matches a prior readable session question and that prior session has a helper answer with reviewed evidence
- **THEN** the runtime SHALL produce a reviewed answer using history evidence without dispatching Claude Code

#### Scenario: No safe experience match falls back to normal diagnosis

- **WHEN** no prior session answer is a safe match
- **THEN** the runtime SHALL continue through input review, preflight, and normal worker diagnosis

#### Scenario: Experience answer is reviewed before presentation

- **WHEN** the experience Agent finds a reusable answer
- **THEN** the answer SHALL still pass through output review and presentation responsibilities before being recorded as the helper reply

### Requirement: Same-case turns are serialized

The system SHALL process active user turns for the same case serially so each question receives its own reply.

#### Scenario: Consecutive async questions keep reply order

- **WHEN** two or more async messages are submitted to the same case before the earlier turn finishes
- **THEN** the runtime SHALL complete the turns in submission order and record a helper reply for each accepted user message

#### Scenario: Archived case rejects new messages

- **WHEN** a user tries to send a chat message to an archived case
- **THEN** the API SHALL reject the request and leave the archived case readable

### Requirement: Session lifecycle actions are available

The system SHALL allow users to pin, archive, and delete sessions from the session list.

#### Scenario: Session can be pinned

- **WHEN** a user pins a session
- **THEN** the session list SHALL show the session as pinned and sort pinned sessions before unpinned sessions

#### Scenario: Session can be archived

- **WHEN** a user archives a session
- **THEN** the session SHALL remain readable but cannot accept new follow-up messages

#### Scenario: Session can be deleted

- **WHEN** a user deletes a session
- **THEN** the local case file SHALL be removed and the session SHALL no longer appear in the session list

#### Scenario: Session title refreshes automatically

- **WHEN** a generic new session receives its first meaningful user message
- **THEN** the session title SHALL be updated from that message

### Requirement: Agent settings are inspectable without reading code

The system SHALL expose configured Agent settings and role descriptions through the backend UI.

#### Scenario: API returns sanitized Agent registry

- **WHEN** the user opens settings or calls the Agent settings endpoint
- **THEN** the response SHALL include configured Agent ids, roles, stages, config paths, summaries, and user-facing permissions without secrets

#### Scenario: Settings UI lists configured Agents

- **WHEN** the settings drawer is opened
- **THEN** it SHALL show the main Agent and configured sub-agents with their roles and responsibilities

### Requirement: Public behavior remains compatible

The change SHALL preserve existing public API response fields, old persisted case readability, and existing runtime behavior while adding compatible fields/endpoints for Agent configuration and session lifecycle.

#### Scenario: API compatibility remains unchanged

- **WHEN** route compatibility tests run for `/api/chat`, `/api/session`, `/api/sessions`, `/api/settings`, `/api/settings/model/test`, and `/api/logs`
- **THEN** they SHALL pass without response shape changes caused by the Agent configuration move

#### Scenario: Runtime behavior remains evidence constrained

- **WHEN** existing tests cover preflight blocking, workspace-aware dispatch, unsupported fact blocking, and sync/async runtime pipeline behavior
- **THEN** they SHALL continue to pass after the main Agent config moves to `src/agents/main.md`
