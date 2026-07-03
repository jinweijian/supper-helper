## Context

The repository currently has:

- root `AGENTS.md`: repository development rules for coding agents and developers
- root `AGENT.md`: product runtime behavior spec for super helper's user-facing Agent
- runtime code that loads the product Agent spec from root `AGENT.md`
- architecture docs that describe Agent behavior, but do not model the product as one main Agent plus future sub-agents
- runtime phases that already imply multiple product Agents: input review/preflight, output review, and presentation polishing

The names `AGENTS.md` and `AGENT.md` are too similar and invite confusion. More importantly, product Agent configuration does not have a dedicated module boundary. Future sub-agent prompts/configs would likely be scattered across docs, runtime, worker adapters, or root files unless the project creates a clear `src/agents/` home now.

The current product behavior is already multi-agent in concept:

- the main Agent coordinates the user turn and owns final user-facing responsibility
- the input review/preflight Agent decides whether the user input is diagnosable and prepares dispatchable intent
- the experience Agent checks prior cases for reusable answers before invoking Claude Code
- the output review Agent audits worker evidence and blocks unsupported conclusions
- the presentation Agent formats the reviewed answer for the user's persona and the chat UI

The change must preserve public API compatibility where possible while cleaning up ownership. It may add optional case/session fields for agent labels, lifecycle state, and session management, but existing persisted cases must remain readable.

## Goals / Non-Goals

**Goals:**

- Make `AGENTS.md` exclusively mean repository development rules.
- Move product Agent configuration into `src/agents/`.
- Rename the current product main Agent spec to `src/agents/main.md`.
- Treat the product as a one-main-many-sub-agent architecture in docs, runtime config, and development standards.
- Define current sub-agent configs for input review/preflight, output review, and presentation.
- Define an experience Agent config that can reuse prior session answers after review instead of calling Claude Code.
- Define where future sub-agent configs live, how they are named, and how they are paired to runtime stages.
- Add a lightweight agent role registry that maps runtime stages to Agent config files.
- Update runtime loading to read the main Agent spec from `src/agents/main.md`.
- Update runtime loading to read stage-specific Agent specs through the registry where model prompts or formatting contracts need them.
- Add Agent identity metadata to diagnostic log events and log drawer blocks.
- Expose runtime Agent activity trace in session responses so the loading state can show which Agent is working.
- Serialize same-case async user turns so each question receives a matching reply in order.
- Add automatic session title refresh and session lifecycle actions: pin, archive, delete.
- Add an Agent settings view/API so users can inspect all configured Agents and their roles without reading code.
- Preserve the main Agent behavior and existing HTTP API shapes while adding compatible fields/endpoints.
- Add tests/docs lint that prevent future confusion between development rules and product Agent configs.

**Non-Goals:**

- Do not add a full agent registry service, marketplace, or UI for agent selection.
- Do not add arbitrary plugin execution or remote Agent loading.
- Do not change Claude Code worker behavior.
- Do not require a destructive persistence migration.
- Do not change user-facing chat behavior except paths/docs that identify the Agent spec source.

## Decisions

### 1. Product Agent configs live under `src/agents/`

Decision:

- Create `src/agents/main.md` as the main Agent configuration.
- Create current sub-agent configs under `src/agents/`:
  - `input-review.md`
  - `experience.md`
  - `output-review.md`
  - `presentation.md`
- Future sub-agent configs must live under `src/agents/` using kebab-case filenames such as `src/agents/customer-impact-review.md` or grouped folders only when the agent has multiple files.
- Root `AGENT.md` should be removed or reduced to a temporary compatibility pointer only if implementation needs a transition. The intended end state is no product behavior spec at root.

Rationale:

- `src/agents/` makes Agent configuration part of the product source tree, not repository meta-instructions.
- A stable directory avoids scattering sub-agent config across `docs/`, runtime helpers, workers, and root files.
- Naming the main config `main.md` avoids the `AGENT.md` / `AGENTS.md` ambiguity.
- Naming current sub-agents by their runtime responsibility matches existing runtime phases and log labels.

Alternatives considered:

- Keep root `AGENT.md` and add more disclaimers. This was rejected because disclaimers do not solve the naming ambiguity and violate single-responsibility expectations for root files.
- Put configs under `docs/agents/`. This was rejected because the files are runtime configuration inputs, not only documentation.

### 2. Main Agent remains the runtime coordinator

Decision:

- The main Agent config describes the product's coordinator Agent.
- The coordinator owns the user turn, sub-agent routing policy, final responsibility, and the evidence contract.
- The configured sub-agents own narrow stage responsibilities:
  - `input-review`: review user input, run Preflight Gate policy, normalize intent, and support `DiagnosticRequest` creation.
  - `output-review`: audit `DiagnosticResult`, reject unsupported claims, decide whether to ask, continue, finalize, or escalate.
  - `presentation`: transform reviewed decisions into persona-aware user-facing text without adding new facts.
- Sub-agents may produce intermediate decisions or drafts, but they must not bypass the main Agent's evidence contract or directly own final user-facing response authority.

Rationale:

- The existing architecture already separates runtime orchestration from Claude Code workers.
- Formalizing "main Agent plus sub-agents" clarifies that Claude Code is still a worker/tool, not a sub-agent that can speak directly to users.
- Future sub-agents can be added without rewriting the runtime boundary.
- The three current sub-agents stop being implicit strings scattered through runtime events and become explicit configs.

Alternatives considered:

- Treat every prompt as a peer agent. This was rejected because it weakens the evidence-review gate and makes final-answer ownership ambiguous.
- Treat sub-agents as worker adapters. This was rejected because sub-agents are product reasoning roles, while workers inspect external sources and return structured results.

### 3. Role pairing rules are explicit and extensible

Decision:

- Add a lightweight manifest under `src/agents/`, named `registry.json`.
- The manifest maps stable runtime stages to Agent config files.
- Initial stages:
  - `main` -> `main.md`
  - `input_review` -> `input-review.md`
  - `preflight` -> `input-review.md`
  - `experience` -> `experience.md`
  - `output_review` -> `output-review.md`
  - `presentation` -> `presentation.md`
- Each registry item should include:
  - `id`
  - `role`
  - `configPath`
  - `stage`
  - `required`
  - `mayProduceUserFacingText`

Rationale:

- A manifest makes this a multi-config system instead of a folder of loose markdown files.
- Mapping both `input_review` and `preflight` to `input-review.md` matches the current product concept: input审核 and预检 are one configured Agent today.
- The experience stage sits after input receipt and before Claude dispatch, so it can safely short-circuit repeated questions only when prior evidence and answer text are available.
- Future agents can be added by adding a config and a mapping without changing every runtime helper.

Alternatives considered:

- Encode pairings only in comments inside markdown files. This was rejected because runtime and tests cannot reliably validate comments.
- Hardcode pairings only in TypeScript. This was rejected because the user wants agent configs discoverable from the `src/agents/` directory.

### 4. Runtime loads Agent specs through an explicit source path

Decision:

- `DiagnosticRuntime` should load the main Agent spec from `src/agents/main.md`.
- Runtime should load `registry.json` through a narrow helper such as `src/runtime/agent-configs.ts`.
- Model preflight prompts should include the input-review Agent config plus the main Agent contract.
- Experience reuse should include the experience Agent config plus the main Agent evidence contract.
- Model review prompts should include the output-review Agent config plus the main Agent evidence contract.
- Presentation formatting should be documented against the presentation Agent config; if a model-backed presentation step is added later, it must resolve through the same registry.
- Tests should assert the runtime points at the centralized config path or that the built output contains/loads the new path.
- If build output path differences matter, path resolution should stay explicit and narrow.

Rationale:

- Runtime behavior should follow the same source of truth that docs and development rules advertise.
- The loading path is a contract worth testing because a fallback to root `AGENT.md` would reintroduce confusion.
- Stage-specific prompts should not reuse the entire main Agent spec as the only instruction source when the product already distinguishes input review, output review, and presentation roles.

### 5. Agent identity appears in logs and loading activity

Decision:

- Extend runtime log events with optional Agent identity metadata such as `agentId`, `agentRole`, and `agentName`.
- `CaseRuntimeEventRecorder` should attach this metadata for main, input-review, experience, output-review, presentation, and worker-facing events where applicable.
- `src/observability/log-blocks.ts` should expose the Agent label in log blocks and tags.
- Session DTOs should include a compact `agentActivity` list built from recent Agent log events.
- The UI loading state should render recent Agent activity while async diagnosis is running, not only a single latest log summary.

Rationale:

- Users need to know which Agent handled each step.
- Loading state should reflect the multi-agent pipeline as it happens.
- Keeping activity derived from log events avoids creating a separate runtime progress store.

Alternatives considered:

- Add a separate progress table. This was rejected for the local MVP because stored log events already provide the required audit trail.

### 6. Experience Agent can reuse prior case answers

Decision:

- Add `src/agents/experience.md` and registry stage `experience`.
- Add a runtime helper such as `src/runtime/experience-agent.ts`.
- The helper searches other readable case sessions for the same or substantially same normalized user question.
- If it finds a prior helper answer with concluded/final evidence, it creates a reviewed `DiagnosticResult` with evidence kind `history` and returns a final answer through the normal output-review and presentation path.
- If no safe match exists, runtime continues through preflight and Claude Code as usual.

Rationale:

- Repeated questions should not always call Claude Code again.
- The answer still needs review before being shown, so the experience Agent is an early stage, not a final-answer bypass.

Alternatives considered:

- Always call Claude Code but include history. This wastes time for exact repeated questions and does not satisfy the requested short-circuit workflow.

### 7. Same-case async turns are serialized

Decision:

- Add a per-case in-memory turn queue in `DiagnosticRuntime` or a narrow runtime helper.
- Async `/api/chat` should enqueue completion for a case instead of starting overlapping `completeUserTurn` calls.
- Each user message should carry an id, and the helper reply should be recorded with a `replyToMessageId` when possible.
- Archived cases should reject new chat turns.

Rationale:

- The current async flow can process multiple questions for the same case concurrently.
- Serializing by case aligns with the architecture rule that one case runs serially and prevents replies from being skipped or attributed to the wrong user turn.

### 8. Session lifecycle is user-manageable

Decision:

- Add optional session fields for `pinnedAt` and `archivedAt`.
- Add repository methods/routes for pin/unpin, archive, and delete.
- Archived sessions remain readable but reject new follow-up messages.
- Deleted sessions remove the local case file.
- Session list sorting should place pinned sessions first, then newest updated sessions.
- Session titles should auto-refresh from the first meaningful user message if a case still has a generic title.

Rationale:

- Users need to clean local cases and preserve important ones.
- Archive gives a non-destructive read-only state.
- Pin gives control over frequently referenced sessions.

### 9. Agent settings are inspectable in the backend UI

Decision:

- Add a public read-only API, such as `GET /api/agents`, that returns sanitized Agent registry entries and config summaries.
- Add a settings drawer section that lists all configured Agents, their roles, stages, whether they may produce user-facing text, and a short purpose summary.
- Do not expose secrets or hidden model credentials through this endpoint.

Rationale:

- Users should not need to read source files to know which Agents exist and what they do.

Alternatives considered:

- Import markdown as a bundled asset. This was not chosen for this step because the current project already reads markdown from disk and the change should stay behavior-preserving.

### 10. Development docs distinguish repository agents from product agents

Decision:

- `AGENTS.md` remains the repository development instruction file.
- `docs/standards/development.md` adds `src/agents/` to the module ownership map.
- `docs/architecture/overview.md` describes main Agent and configured sub-agents as a product architecture concept.
- `docs/architecture/agents.md` points to `src/agents/main.md` for the main Agent behavior source.
- `docs/architecture/agents.md` documents the initial role pairings for input review/preflight, output review, and presentation.
- README groups development rules separately from product Agent behavior.

Rationale:

- Future coding agents need a clear entry point for how to modify code.
- Product Agent behavior needs a clear entry point for how the runtime should behave.
- These concerns are related but should not occupy the same file.

### 11. Sub-agent configs are configuration documents, not executable modules

Decision:

- This change creates the directory, initial sub-agent configs, and registry-based stage resolution.
- A sub-agent config must declare role, responsibility, input/output contract, allowed dependencies, and whether it may produce user-facing text.
- A future implementation can add richer execution semantics, but it must use the existing registry instead of introducing scattered prompt files.

Rationale:

- The user identified the current input review/preflight, output review, and presentation roles as existing Agents, so their configs should be explicit now.
- Keeping configs as markdown plus a small JSON registry avoids overbuilding an Agent framework while still making extension rules concrete.

## Risks / Trade-offs

- [Risk] Runtime file path breaks after TypeScript build because markdown is no longer at root. → Mitigate with path-aware tests and keep path resolution relative to `dist/runtime` and source layout expectations.
- [Risk] Removing root `AGENT.md` may break docs lint or old tooling that expects it. → Mitigate by updating README, docs lint, and tests in the same change; if a compatibility pointer is temporarily needed, keep it short and non-authoritative.
- [Risk] Future contributors may still place sub-agent prompts inside runtime or worker modules. → Mitigate by adding `src/agents/` to `AGENTS.md`, `docs/standards/development.md`, and docs lint.
- [Risk] The term "sub-agent" may be confused with Claude Code worker. → Mitigate by documenting that sub-agents are product reasoning roles and workers are external diagnostic tools.
- [Risk] The registry can drift from actual runtime usage. → Mitigate with tests that assert initial stage mappings and runtime prompt loading from the registry.
- [Risk] Adding stage-specific configs could duplicate main Agent rules. → Mitigate by making sub-agent configs narrow and requiring the main Agent evidence contract to remain authoritative.
- [Risk] Experience Agent could reuse stale or unrelated answers. → Mitigate with conservative matching, history evidence, output review, and fallback to normal diagnosis when uncertain.
- [Risk] In-memory turn queues are lost on process restart. → Mitigate by using them only to serialize active local requests; persisted cases remain readable and failed/interrupted turns are logged.
- [Risk] Optional lifecycle fields change stored case files. → Mitigate with load-time defaults and optional fields so old JSON remains readable.

## Migration Plan

1. Create `src/agents/`.
2. Move root `AGENT.md` content to `src/agents/main.md`.
3. Add `src/agents/input-review.md`, `src/agents/experience.md`, `src/agents/output-review.md`, and `src/agents/presentation.md`.
4. Add `src/agents/registry.json` with role/stage pairings.
5. Remove the root `AGENT.md` product behavior content, or replace it only with a short pointer if existing checks require a staged transition.
6. Add a narrow runtime helper for loading Agent configs and resolving stage pairings.
7. Add experience Agent lookup before Claude dispatch.
8. Add Agent identity metadata to log events and session activity DTOs.
9. Add same-case turn queue and session lifecycle routes.
10. Add Agent settings API/UI.
11. Update `DiagnosticRuntime` to load `src/agents/main.md` and stage-specific configs through the helper.
12. Update docs and development standards to define main/sub-agent boundaries and initial stage pairings.
13. Update docs lint to check the new authoritative files.
14. Update tests to verify runtime loading, registry mappings, activity traces, experience reuse, session actions, and behavior compatibility.
15. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test`.

Rollback:

- If the runtime path migration fails, restore root `AGENT.md` loading temporarily while keeping the OpenSpec artifacts and docs as the intended target, then fix the path resolution with tests before completing the change.

## Open Questions

- Should root `AGENT.md` be deleted completely or kept as a short non-authoritative pointer for one release cycle?
- Whether `presentation` should become a model-backed runtime stage immediately, or remain a config-backed rule source for the existing deterministic presenter until a later change.
