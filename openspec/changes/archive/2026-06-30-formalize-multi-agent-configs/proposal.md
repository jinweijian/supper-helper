## Why

The project currently has two easily confused root-level files, `AGENTS.md` for repository development rules and `AGENT.md` for the product's runtime Agent behavior. The runtime architecture also treats "Agent" mostly as a single conceptual unit, even though the product is moving toward a main-agent plus sub-agent model.

This change makes Agent configuration a first-class product concept: runtime Agent specs live under `src/agents/`, the main Agent is clearly separated from repository development rules, and future sub-agent configs have one obvious home.

## What Changes

- Move the current product Agent behavior spec from root `AGENT.md` into `src/agents/main.md`.
- Keep repository development rules in root `AGENTS.md`; remove product Agent behavior text from repository-level development-rule files.
- Introduce a centralized `src/agents/` directory for all product Agent configuration documents.
- Define the main Agent as the coordinator that owns user-facing responsibility and delegates stage-specific work to configured sub-agents.
- Add first-class configs for the currently implied sub-agents: input review/preflight, output review, and presentation polishing.
- Add an `experience` Agent config that can search prior case sessions for the same or substantially same question, review reusable evidence, and answer without calling Claude Code when safe.
- Add a role/stage pairing registry under `src/agents/` so the runtime can resolve which Agent config applies to each stage.
- Add agent identity labels to diagnostic logs and expose each Agent's activity in the runtime loading state.
- Define sub-agent configuration and extension rules so future specialized agents can be added without scattering prompt/config documents through runtime, worker, docs, or root files.
- Fix same-case async turn ordering so each user question receives its own reply in order.
- Add automatic session title refresh and session actions for pin, archive, and delete.
- Add a backend/settings view where users can inspect all configured Agents without reading code.
- Update runtime loading so the main Agent spec is read from `src/agents/main.md`.
- Update architecture and development docs to include the main-agent plus sub-agent model and the `src/agents/` module boundary.
- Update tests and docs lint to protect the new file locations and naming responsibilities.

## Capabilities

### New Capabilities

- `multi-agent-configuration`: Defines centralized product Agent configuration under `src/agents/`, including the main Agent config, configured sub-agent configs, experience Agent, role/stage pairing rules, runtime activity traces, and runtime/docs boundaries for extensible one-main-many-sub-agent architecture.

### Modified Capabilities

- None.

## Impact

- Affected files:
  - `AGENT.md`
  - `AGENTS.md`
  - `src/agents/`
  - `src/runtime/agent-configs.ts`
  - `src/runtime/diagnostic-runtime.ts`
  - `src/runtime/preflight-gate.ts`
  - `src/runtime/review-gate.ts`
  - `src/runtime/presenter.ts`
  - `src/runtime/experience-agent.ts`
  - `src/gateway/routes/session-routes.ts`
  - `src/gateway/routes/settings-routes.ts`
  - `src/gateway/routes/log-routes.ts`
  - `src/gateway/dto.ts`
  - `src/observability/log-blocks.ts`
  - `src/domain.ts`
  - `src/storage.ts`
  - `src/ui.ts`
  - `docs/standards/development.md`
  - `docs/architecture/overview.md`
  - `docs/architecture/agents.md`
  - `README.md`
  - `scripts/verify-docs.mjs`
  - runtime and docs tests in `test/super-helper.test.mjs`
- Public HTTP API behavior should not change.
- Existing persisted case JSON files should remain readable; new optional fields may be added with migration defaults for session lifecycle and log agent labels.
- The main Agent and current sub-agent behavior contracts should remain behavior-compatible while moving to clearer configuration locations.
