## 1. Baseline and Contract Checks

- [x] 1.1 Run the current `pnpm test` suite and record the pass/fail baseline before moving Agent configuration files.
- [x] 1.2 Add or identify tests that protect runtime preflight, workspace-aware dispatch, unsupported fact blocking, and sync/async runtime pipeline behavior.
- [x] 1.3 Add or identify route compatibility tests for `/api/chat`, `/api/session`, `/api/sessions`, `/api/settings`, `/api/settings/model/test`, and `/api/logs`.

## 2. Agent Configuration Directory

- [x] 2.1 Create `src/agents/` as the product Agent configuration directory.
- [x] 2.2 Move the current product runtime Agent behavior spec from root `AGENT.md` to `src/agents/main.md`.
- [x] 2.3 Add `src/agents/input-review.md` for the input审核 and Preflight Gate Agent config.
- [x] 2.4 Add `src/agents/experience.md` for the prior-session experience Agent config.
- [x] 2.5 Add `src/agents/output-review.md` for the worker evidence审核 Agent config.
- [x] 2.6 Add `src/agents/presentation.md` for the 美化输出 / persona-aware presentation Agent config.
- [x] 2.7 Add `src/agents/registry.json` with initial stage pairings for `main`, `input_review`, `preflight`, `experience`, `output_review`, and `presentation`.
- [x] 2.8 Remove product Agent behavior text from root `AGENT.md`, or replace root `AGENT.md` with a short non-authoritative pointer if compatibility requires it.
- [x] 2.9 Ensure `AGENTS.md` remains the repository development-rule entry point and does not include product Agent behavior content.
- [x] 2.10 Add a short `src/agents/README.md` or equivalent directory note explaining main Agent, current sub-agent configs, future sub-agent config naming rules, and registry pairing rules.

## 3. Runtime Loading and Pairing Resolution

- [x] 3.1 Add a narrow runtime helper such as `src/runtime/agent-configs.ts` to load `src/agents/registry.json` and resolve Agent configs by stage.
- [x] 3.2 Update `src/runtime/diagnostic-runtime.ts` to load the main Agent spec from `src/agents/main.md` through the helper.
- [x] 3.3 Update model preflight prompt construction to include the configured `input-review` Agent spec.
- [x] 3.4 Add `src/runtime/experience-agent.ts` to find safe prior-session answer matches and return history-backed diagnostic results.
- [x] 3.5 Wire the experience Agent after input receipt and before Claude dispatch, with fallback to normal preflight/worker diagnosis.
- [x] 3.6 Update model review prompt construction to include the configured `output-review` Agent spec.
- [x] 3.7 Ensure presentation formatting is documented or wired against the configured `presentation` Agent spec without allowing it to add unsupported facts.
- [x] 3.8 Add focused tests that fail if the runtime continues to load product behavior from root `AGENT.md` or hardcodes stage configs outside the registry.
- [x] 3.9 Add focused tests that repeated questions can be answered by the experience Agent without dispatching Claude Code.
- [x] 3.10 Verify build output can still initialize `DiagnosticRuntime` and run existing model preflight/review tests.

## 4. Agent Observability and Runtime Activity

- [x] 4.1 Extend diagnostic log event typing/storage with optional Agent identity metadata while keeping old case JSON readable.
- [x] 4.2 Update `CaseRuntimeEventRecorder` so main, input-review, experience, output-review, and presentation events carry agent labels.
- [x] 4.3 Update `src/observability/log-blocks.ts` and `/api/logs` blocks so the diagnostic log drawer displays the responsible Agent for each Agent event.
- [x] 4.4 Add compact recent Agent activity to session serialization for loading-state polling.
- [x] 4.5 Update the UI loading state to show multiple Agent activity steps while an async turn is running.
- [x] 4.6 Add tests for Agent labels in logs and Agent activity in serialized sessions.

## 5. Session Turn Order and Lifecycle

- [x] 5.1 Serialize async `completeUserTurn` execution per case so overlapping messages cannot skip or reorder replies.
- [x] 5.2 Track reply-to message identity where possible so each accepted user message gets its own helper reply.
- [x] 5.3 Refresh generic session titles from the first meaningful user message.
- [x] 5.4 Add repository methods and routes for pin/unpin, archive, and delete session actions.
- [x] 5.5 Reject new chat messages for archived sessions while keeping them readable.
- [x] 5.6 Update the session sidebar UI to show a three-dot actions menu with pin, archive, and delete.
- [x] 5.7 Add tests for ordered async replies, title refresh, and pin/archive/delete behavior.

## 6. Agent Settings View

- [x] 6.1 Add a read-only `/api/agents` endpoint that returns sanitized Agent registry entries and config summaries.
- [x] 6.2 Update the settings drawer to list all configured Agents, roles, stages, and responsibilities.
- [x] 6.3 Add tests for the `/api/agents` response and settings UI Agent section.

## 7. Multi-Agent Architecture Documentation

- [x] 7.1 Update `docs/architecture/overview.md` to model super helper as one main Agent plus configured input-review, experience, output-review, and presentation sub-agents, separate from workers/tools.
- [x] 7.2 Update `docs/architecture/agents.md` to reference `src/agents/main.md` as the authoritative main Agent behavior spec and list the current role pairings.
- [x] 7.3 Update `docs/standards/development.md` to add `src/agents/` and the registry to the module ownership map and anti-patterns.
- [x] 7.4 Update `README.md` to separate repository development rules from product Agent configuration and point to `src/agents/main.md` plus the `src/agents/` registry.
- [x] 7.5 Update `AGENTS.md` so future coding agents know that product Agent configs and role pairings belong under `src/agents/`.

## 8. Docs Lint and Regression Coverage

- [x] 8.1 Update `scripts/verify-docs.mjs` to check `src/agents/main.md`, `src/agents/input-review.md`, `src/agents/experience.md`, `src/agents/output-review.md`, `src/agents/presentation.md`, `src/agents/registry.json`, `AGENTS.md`, and `docs/standards/development.md` for the new separation.
- [x] 8.2 Update tests or docs checks to ensure future sub-agent configs and stage pairings are expected under `src/agents/`.
- [x] 8.3 Run `pnpm lint` and fix documentation guard failures.
- [x] 8.4 Run focused runtime and route compatibility tests after the config move.

## 9. Final Verification

- [x] 9.1 Run `pnpm typecheck`.
- [x] 9.2 Run `pnpm build`.
- [x] 9.3 Run the full `pnpm test` suite.
- [x] 9.4 Review final file layout to confirm root `AGENTS.md` is development-only, product main Agent config lives at `src/agents/main.md`, current sub-agent configs and registry live under `src/agents/`, future sub-agent configs have a documented home, logs show Agent identity, loading shows Agent activity, and session lifecycle actions work.
