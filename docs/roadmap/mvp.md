# super helper MVP Roadmap

## Phase 1: Project Initialization / 项目初始化

- Create `/Users/kz/my/super-helper`.
- Initialize a TypeScript project.
- Add minimal domain types for cases, runs, workspaces, MCP tools, Agent config, and diagnostic output.
- Add docs for product, Agent design, architecture, and roadmap.
- Add lint checks to ensure core docs keep essential requirements.

## Phase 2: Minimal Chat UI

- Build 极简对话 UI.
- Keep the composer bottom-sticky.
- Show only the case title, status, chat timeline, input box, and a few contextual actions.
- Add a `查看诊断日志` entry.
- Keep rules, tool traces, and run internals outside the main chat.

## Phase 3: mock Agent Flow

- Implement a mock `super helper Agent`.
- Add Preflight Gate behavior.
- If input is insufficient, ask a follow-up question directly.
- If input is sufficient, create a mock `DiagnosticRequest`.
- Simulate Claude Code worker output.
- Review mock evidence before displaying a user-facing answer.

## Phase 4: Diagnostic Log Drawer

- Add 诊断日志抽屉.
- Show preflight decisions.
- Show generated DiagnosticRequest.
- Show mock worker status.
- Show evidence cards.
- Show user challenge events and re-diagnosis runs.

## Phase 5: Agent Config Schema

- Define the first built-in Agent configuration.
- Support language, tone, no-guessing rules, evidence policy, and default read-only mode.
- Keep the MVP as a single built-in Agent, not a multi-Agent marketplace.

## Phase 6: Local Claude Code Worker Adapter

- Add a local adapter that can call Claude Code in print/JSON mode.
- Pass a bounded DiagnosticRequest to the worker.
- Require structured JSON output.
- Do not expose Claude output directly to users.
- Keep the adapter behind an interface so it can be replaced later.

## Phase 7: MCP Config and Permission Model

- Add MCP configuration records.
- Support any MCP protocol-compatible tool.
- Allow tools per workspace.
- Default to read-only.
- Store tool output summaries as evidence.

## Phase 8: Multi-User Run Queue / 多用户 run 队列

- Add queue-backed run execution.
- Enforce one active run per case.
- Allow different cases to run concurrently.
- Add per-user and per-tenant concurrency limits.
- Add run cancellation, timeout, retry, and immutable audit records.

## Phase 9: Production Hardening

- Add authentication and tenant isolation.
- Add sensitive data retention rules.
- Add structured logging.
- Add prompt regression tests for Agent behavior.
- Add worker budget controls.
- Add exportable case reports.
