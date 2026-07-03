# Onboarding Review Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Setup 审核面板升级为分页、多选、可解释的知识切片审核工作台。

**Architecture:** `src/onboarding/service.ts` 生成审核查询结果、分页元数据和 issue 解释；`src/gateway/routes/onboarding-routes.ts` 只解析 query/body 并传给 service；`src/setup-ui.ts` 只负责分页、多选和展示，不承担质量判断。知识发布与索引仍通过现有 `reviewDraftSlices`、`publishApprovedDraftSlices`、`updateKnowledgeIndex` 完成。

**Tech Stack:** TypeScript, Node HTTP routes, vanilla setup HTML/JS, node:test regression tests.

## Global Constraints

- 与用户交互和文档使用中文。
- 不改变 knowledge draft/publish artifact shape。
- 不让 route 承担审核策略。
- TypeScript 改动后运行 `pnpm typecheck`。
- gateway/onboarding/UI 行为变更后运行 `pnpm test`。

---

### Task 1: Review Query Contract

**Files:**
- Modify: `src/onboarding/types.ts`
- Modify: `src/onboarding/service.ts`
- Test: `test/onboarding.test.mjs`

**Interfaces:**
- Consumes: existing `OnboardingService.getReviewState()`.
- Produces: `OnboardingReviewQuery`, `OnboardingReviewPage`, optional `OnboardingReviewIssue.explanation`, and `getReviewState(query?: OnboardingReviewQuery)`.

- [ ] **Step 1: Write failing tests**

Add tests that expect `fixture.getReviewState({ limit: 1 })` to return one item with `page.total > 1`, and issue explanations to include Chinese `reason`, `impact`, `suggestion`, and `missingInfo`.

- [ ] **Step 2: Run focused test and verify failure**

Run: `pnpm build && node --test test/onboarding.test.mjs`
Expected: FAIL because `getReviewState` does not accept pagination and issues do not contain explanations.

- [ ] **Step 3: Implement minimal contract**

Add types, query normalization, item filtering, pagination metadata, and issue explanation mapping inside `src/onboarding/service.ts`.

- [ ] **Step 4: Run focused test and verify pass**

Run: `pnpm build && node --test test/onboarding.test.mjs`
Expected: PASS.

### Task 2: Gateway Query Parsing

**Files:**
- Modify: `src/gateway/routes/onboarding-routes.ts`
- Test: `test/onboarding-http.test.mjs`

**Interfaces:**
- Consumes: `OnboardingService.getReviewState(query?: OnboardingReviewQuery)`.
- Produces: `GET /api/onboarding/review?offset=0&limit=20&severity=warn&search=...`.

- [ ] **Step 1: Write failing HTTP/service fake test**

Assert the fake onboarding service receives `offset`, `limit`, `severity`, and `search` from query parameters.

- [ ] **Step 2: Run focused test and verify failure**

Run: `pnpm build && node --test test/onboarding-http.test.mjs`
Expected: FAIL because the route currently ignores query parameters.

- [ ] **Step 3: Implement query parser**

Parse numeric `offset`/`limit`, enum `severity`, and string `search` in the route and pass the query to `service.getReviewState(query)`.

- [ ] **Step 4: Run focused test and verify pass**

Run: `pnpm build && node --test test/onboarding-http.test.mjs`
Expected: PASS.

### Task 3: Setup UI Workbench

**Files:**
- Modify: `src/setup-ui.ts`
- Test: `test/onboarding-http.test.mjs`

**Interfaces:**
- Consumes: paginated review API and existing review POST API.
- Produces: browser UI with page controls, selection, and actions `accept_warnings`, `request_edits`, `reject`.

- [ ] **Step 1: Write failing UI HTML assertions**

Assert setup HTML contains severity filter, review search, pagination buttons, selection controls, and the three action labels.

- [ ] **Step 2: Run focused test and verify failure**

Run: `pnpm build && node --test test/onboarding-http.test.mjs`
Expected: FAIL because controls are absent.

- [ ] **Step 3: Implement UI state and actions**

Track `reviewOffset`, `reviewLimit`, `reviewSeverity`, `reviewSearch`, and selected ids. Fetch `/api/onboarding/review` with query params, render current page only, and submit selected ids for publish/request edits/reject.

- [ ] **Step 4: Run focused test and verify pass**

Run: `pnpm build && node --test test/onboarding-http.test.mjs`
Expected: PASS.

### Task 4: Final Verification

**Files:**
- No production files unless verification exposes issues.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: verified implementation summary.

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: exit 0.

- [ ] **Step 3: Inspect git diff**

Run: `git diff --stat` and `git diff -- src/onboarding/types.ts src/onboarding/service.ts src/gateway/routes/onboarding-routes.ts src/setup-ui.ts test/onboarding.test.mjs test/onboarding-http.test.mjs`
Expected: only scoped onboarding review work plus pre-existing unrelated dirty files remain.

## Self-Review

- Spec coverage: pagination, filtering/search, multi-select, three review actions, warning explanation, module boundaries, and tests are all mapped to tasks.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: `OnboardingReviewQuery`, `OnboardingReviewPage`, and `OnboardingReviewIssue.explanation` are used consistently across tasks.
