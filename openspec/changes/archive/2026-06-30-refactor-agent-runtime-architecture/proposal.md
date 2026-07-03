## Why

The current codebase already describes a good agent architecture in docs, but the implementation still concentrates most runtime concerns inside a few large files. This makes the agent hard to reason about, hard to test in isolation, and hard to evolve toward OpenClaw-style runtime boundaries.

This change creates an implementation-ready architecture plan before refactoring code, so the project can move from "one file owns one long flow" to explicit agent runtime, session, provider, worker, and transport boundaries without changing MVP behavior first.

## What Changes

- Define a layered diagnostic agent runtime architecture inspired by OpenClaw's runtime/session/provider/tool separation.
- Document the target module boundaries for agent turn orchestration, preflight, request building, run dispatch, worker adapters, result review, presentation, session persistence, and HTTP transport.
- Define migration rules that preserve existing MVP behavior while moving responsibilities out of `src/agent.ts`, `src/server.ts`, and `src/claude-worker.ts`.
- Establish testing expectations for each extracted boundary so future implementation can verify behavior without relying only on end-to-end chat tests.
- No user-facing API or runtime behavior change is intended in the design phase.

## Capabilities

### New Capabilities

- `diagnostic-agent-runtime`: Defines the architecture contract for a layered diagnostic agent runtime that owns session context, turn lifecycle, preflight, diagnostic dispatch, review, presentation, and adapter boundaries.

### Modified Capabilities

- None. There are no existing OpenSpec specs in this repository.

## Impact

- Affected implementation areas for the later refactor:
  - `src/agent.ts`
  - `src/server.ts`
  - `src/claude-worker.ts`
  - `src/preflight.ts`
  - `src/model.ts`
  - `src/storage.ts`
  - `src/domain.ts`
  - `test/super-helper.test.mjs`
- Affected documentation:
  - `docs/architecture/agents.md`
  - `docs/architecture/overview.md`
  - OpenSpec artifacts under `openspec/changes/refactor-agent-runtime-architecture/`
- No new external dependencies are required for the design.
- No breaking change is planned for CLI commands, local HTTP endpoints, storage format, or user-facing chat behavior during the first implementation pass.
