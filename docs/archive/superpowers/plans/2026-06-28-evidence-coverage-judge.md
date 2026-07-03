# Evidence Coverage Judge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 model_assisted 的 Evidence Coverage Agent，叠加在 Evidence Judge 之后，用模型判断知识证据是否真正覆盖原问题需要的答案要素；不覆盖时拒绝直答并升级到代码诊断。

**Architecture:** Evidence Judge 先做确定性评分（字段命中/质量/置信），过门禁后若 `rerankScore>=0.7` 且配置开启，调用独立的 `EvidenceCoverageService`（复用 `AgentModelClient`）判断覆盖度；模型失败降级回 Judge 原结论。Coverage Agent 配置登记在 `src/agents/`，运行时服务在 `src/runtime/`，不改检索算法。

**Tech Stack:** TypeScript runtime, `AgentModelClient` (OpenAI-compatible), Node test runner, existing `KnowledgeEvidenceResult`/`EvidenceJudgeResult`/`CaseRuntimeEventRecorder` contracts.

## Global Constraints

- 与用户交互、Agent prompt、文档全部中文（AGENTS.md 硬规则）。
- `src/agents/` 只放 Agent prompt/config + `registry.json`，不写 runtime 编排。
- `src/runtime/` 只做编排和模型调用，不写 HTTP DTO、不调 Claude worker。
- 不改动 `src/retrieval/`、`src/knowledge/`、`src/providers/`、`src/gateway/`、`src/workers/`。
- 不破坏现有 API response shape 和 case JSON shape（只新增 log 条目）。
- 默认测试不联网、不花钱、不依赖真实凭证（mock `AgentModelClient`）。
- 每次改动最低验证：TS 改动跑 `pnpm typecheck`，运行时改动跑 `pnpm test`，构建跑 `pnpm build`。

---

## 文件结构

- Create: `src/agents/evidence-coverage.md`
  - Agent prompt：定义"判断证据是否覆盖原问题答案要素"的职责、输入输出契约、规则约束。
  - 不写 runtime 编排、不调模型。

- Modify: `src/agents/registry.json`
  - 新增 `evidence-coverage` agent 条目，`executionMode: model_assisted`，`stage: evidence_coverage`。

- Modify: `src/runtime/agent-configs.ts`
  - `AgentStage` 联合类型新增 `'evidence_coverage'`。

- Create: `src/runtime/evidence-coverage-service.ts`
  - `EvidenceCoverageService` 类：构造注入 `AgentModelClient` + `CaseRuntimeEventRecorder` + agent spec。
  - `evaluate(input)` 方法：构造 prompt，调模型，解析 JSON，失败返回 `{ coverage: 'unknown' }` 触发降级。
  - 不写 HTTP DTO、不调 Claude worker、不改 case JSON。

- Modify: `src/runtime/event-recorder.ts`
  - 新增 `agentIdentities.evidenceCoverage`。
  - 新增 `evidenceCoverageStarted`/`evidenceCoverageResult`/`evidenceCoverageFailed` 三个事件方法。

- Modify: `src/runtime/knowledge-turn.ts`
  - `KnowledgeTurnService` 构造接收 `coverageService`。
  - `answer` 方法在 `prepareKnowledgeDiagnosis` 返回后、发 `evidenceJudgeResult` 事件之后，若 `judge.answerable && rerankScore>=0.7 && config 开关`，调 `coverageService.evaluate` 并发 `evidenceCoverageStarted`/`Result` 事件；`not_covered`/`partial` 时覆盖 Judge 结论为 `answerable=false`。
  - 不写 provider 协议、不调 Claude worker。

注意：不修改 `src/runtime/knowledge-diagnosis.ts`。`prepareKnowledgeDiagnosis` 保持纯检索+Judge，coverage 编排放在 `knowledge-turn`，事件时序清晰。

- Modify: `src/runtime/diagnostic-runtime.ts`
  - 构造 `EvidenceCoverageService` 并注入 `KnowledgeTurnService`。

- Modify: `src/config.ts`
  - `agent` 段新增 `useModelForEvidenceCoverage?: boolean`（默认 true）和 `evidenceCoverageTopN?: number`（默认 3）。
  - `defaultConfig()` 设默认值。

- Modify: `src/settings/contracts.ts` + `src/settings/model-settings.ts`
  - settings API 暴露 `useModelForEvidenceCoverage` 开关。

- Create: `test/evidence-coverage-service.test.mjs`
  - mock `AgentModelClient`，验证 covered/partial/not_covered/失败降级四条路径。

- Modify: `test/retrieval-grounding.test.mjs`
  - 新增集成测试：Coverage Agent 拦截"相关但不回答"的高分证据。

- Modify: `test/supper-helper.test.mjs`
  - 调整 `case_4e905fbc` 回归：启用 Coverage Agent 后 `answerable=false`。

---

## Task 1: 新增 Coverage Agent 配置和 prompt

**Files:**
- Create: `src/agents/evidence-coverage.md`
- Modify: `src/agents/registry.json`
- Modify: `src/runtime/agent-configs.ts`

**Interfaces:**
- Produces: `resolveAgentConfig('evidence_coverage')` 返回 Coverage Agent spec 内容；`AgentStage` 包含 `'evidence_coverage'`。

- [ ] **Step 1: 创建 Agent prompt 文件**

Create `src/agents/evidence-coverage.md`:

```markdown
---
id: evidence-coverage
role: evidence-coverage-judge
stage: evidence_coverage
may_produce_user_facing_text: false
---

# Evidence Coverage Agent

## Responsibility

Evidence Coverage Agent 判断知识库 evidence 是否真正覆盖原问题需要的答案要素。它不直接回复用户，不新增事实，只输出覆盖度判断，交给 Evidence Judge 和 Output Review 继续处理。

## Input Contract

- 原问题（未经归一化的原始用户消息）
- top-N evidence 的 title、summary、answer_span、excerpt
- 当前 case 已知事实和未知项

## Output Contract

输出结构化 JSON：

```json
{
  "coverage": "covered" | "partial" | "not_covered",
  "missing_elements": ["补跑/重跑数据的步骤", "命令行名称或参数"],
  "reason": "证据只描述了用户数据统计的页面功能，未覆盖补数据步骤或命令行操作"
}
```

## Rules

- 只能判断"证据是否覆盖原问题需要的答案要素"，不能新增事实、不能复述证据内容。
- `not_covered`：证据只命中功能说明、页面描述或同业务对象，但缺少问题明确需要的操作步骤、命令、入口路径、故障原因或规则条件。
- `partial`：证据覆盖部分答案要素但缺少关键部分。
- `covered`：证据直接包含问题所需答案要素。
- 问题问"如何处理/补/重跑/命令行/操作步骤"时，证据必须包含具体步骤、命令字面量或工具名称，否则 `not_covered`。
- 问题问"在哪配置/入口/路径"时，证据必须包含具体菜单或导航路径，否则 `not_covered`。
- 问题问"为什么/原因/失败"时，证据必须包含原因分析或排查依据，否则 `not_covered`。
- 不得依赖 matched_terms 或字段命中数判断覆盖度，必须基于证据文本内容与问题答案要素的语义匹配。
```

- [ ] **Step 2: 在 registry.json 登记新 agent**

在 `src/agents/registry.json` 的 `agents` 数组末尾（`presentation` 条目之后）追加：

```json
,
{
  "id": "evidence-coverage",
  "role": "evidence-coverage-judge",
  "stage": "evidence_coverage",
  "configPath": "evidence-coverage.md",
  "required": false,
  "mayProduceUserFacingText": false,
  "executionMode": "model_assisted",
  "summary": "证据覆盖 Agent，用模型判断知识证据是否真正覆盖原问题需要的答案要素。"
}
```

- [ ] **Step 3: 扩展 AgentStage 联合类型**

在 `src/runtime/agent-configs.ts:5-14` 的 `AgentStage` 联合类型中，在 `'evidence_judge'` 之后新增 `'evidence_coverage'`：

```ts
export type AgentStage =
  | 'main'
  | 'input_review'
  | 'preflight'
  | 'experience'
  | 'knowledge_router'
  | 'evidence_judge'
  | 'evidence_coverage'
  | 'case_curator'
  | 'output_review'
  | 'presentation';
```

- [ ] **Step 4: 运行 typecheck 确认配置加载正确**

Run: `pnpm typecheck`
Expected: 退出码 0。

- [ ] **Step 5: 运行现有 agent 测试确认未破坏**

Run: `pnpm test --test-name-pattern "agent registry|agent config"`
Expected: 全部 pass。

- [ ] **Step 6: 提交**

```bash
git add src/agents/evidence-coverage.md src/agents/registry.json src/runtime/agent-configs.ts
git commit -m "feat: register evidence-coverage agent

新增 model_assisted 的 Evidence Coverage Agent 配置，用于判断知识
证据是否覆盖原问题答案要素。仅登记配置，运行时集成在后续 task。"
```

## Task 2: 新增 EvidenceCoverageService 和事件记录

**Files:**
- Create: `src/runtime/evidence-coverage-service.ts`
- Modify: `src/runtime/event-recorder.ts`

**Interfaces:**
- Consumes: `AgentModelClient`（from `src/providers/model/adapter.ts`）、`CaseRuntimeEventRecorder`、`resolveAgentConfig('evidence_coverage').content`。
- Produces: `EvidenceCoverageService` 类，`evaluate({ question, evidence })` 返回 `CoverageResult`。

- [ ] **Step 1: 定义 CoverageResult 类型和服务类**

Create `src/runtime/evidence-coverage-service.ts`:

```ts
import type { KnowledgeEvidenceResult } from '../knowledge/index.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import { parseAgentModelJson } from './agent-model-review.js';
import type { CaseRuntimeEventRecorder } from './event-recorder.js';

export type EvidenceCoverage = 'covered' | 'partial' | 'not_covered' | 'unknown';

export interface CoverageResult {
  coverage: EvidenceCoverage;
  missingElements: string[];
  reason: string;
}

interface ParsedCoverageResponse {
  coverage?: string;
  missing_elements?: string[];
  reason?: string;
}

export class EvidenceCoverageService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly agentSpec: string,
    private readonly topN: number = 3,
  ) {}

  async evaluate(input: {
    question: string;
    evidence: KnowledgeEvidenceResult[];
  }): Promise<CoverageResult> {
    const topEvidence = input.evidence.slice(0, this.topN);
    const evidencePayload = topEvidence.map((item) => ({
      title: item.title,
      summary: item.summary,
      answer_span: item.answer_span,
      excerpt: item.excerpt,
    }));

    const systemPrompt = `${this.agentSpec}

Return JSON only. Use this shape:
{"coverage":"covered"|"partial"|"not_covered","missing_elements":["..."],"reason":"..."}

Do not include <think>, markdown, comments, explanations, or text outside the JSON object.`;

    const userPrompt = JSON.stringify(
      {
        question: input.question,
        evidence: evidencePayload,
      },
      null,
      2,
    );

    try {
      const response = await this.model.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], { json: true });

      const parsed = parseAgentModelJson<ParsedCoverageResponse>(response);
      const coverage = normalizeCoverage(parsed.coverage);
      return {
        coverage,
        missingElements: Array.isArray(parsed.missing_elements)
          ? parsed.missing_elements.map((item) => String(item))
          : [],
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        coverage: 'unknown',
        missingElements: [],
        reason: `coverage evaluation failed: ${message}`,
      };
    }
  }
}

function normalizeCoverage(value: unknown): EvidenceCoverage {
  if (value === 'covered' || value === 'partial' || value === 'not_covered') {
    return value;
  }
  return 'unknown';
}
```

- [ ] **Step 2: 在 event-recorder.ts 新增 agent identity**

在 `src/runtime/event-recorder.ts:41-50` 的 `agentIdentities` 对象中，在 `evidenceJudge` 之后新增：

```ts
  evidenceCoverage: { agentId: 'evidence-coverage', agentRole: 'evidence-coverage-judge', agentName: '证据覆盖 Agent' },
```

- [ ] **Step 3: 新增三个事件方法**

在 `src/runtime/event-recorder.ts` 的 `evidenceJudgeResult` 方法（约 499-508 行）之后，新增：

```ts
  evidenceCoverageStarted(caseSession: StoredCase, input: { question: string; evidenceIds: string[] }): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.evidenceCoverage, {
      actor: 'agent',
      phase: 'evidence_coverage_started',
      label: '证据覆盖',
      severity: 'ok',
      summary: '证据覆盖 Agent 开始判断证据是否覆盖原问题',
      detail: {
        question: input.question,
        evidenceIds: input.evidenceIds,
      },
    });
  }

  evidenceCoverageResult(caseSession: StoredCase, coverage: { coverage: string; missingElements: string[]; reason: string }): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.evidenceCoverage, {
      actor: 'agent',
      phase: 'evidence_coverage_result',
      label: '证据覆盖',
      severity: coverage.coverage === 'covered' ? 'ok' : 'warn',
      summary: coverage.coverage === 'covered'
        ? '证据覆盖原问题答案要素，维持直答'
        : coverage.coverage === 'unknown'
          ? '证据覆盖判断失败，降级回 Evidence Judge 结论'
          : '证据未覆盖原问题答案要素，拒绝直答',
      detail: coverage,
    });
  }

  evidenceCoverageFailed(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.evidenceCoverage, {
      actor: 'agent',
      phase: 'evidence_coverage_failed',
      label: '证据覆盖',
      severity: 'warn',
      summary: '证据覆盖 Agent 调用失败，降级回 Evidence Judge 结论',
      detail: { message },
    });
  }
```

- [ ] **Step 4: 运行 typecheck**

Run: `pnpm typecheck`
Expected: 退出码 0。

- [ ] **Step 5: 提交**

```bash
git add src/runtime/evidence-coverage-service.ts src/runtime/event-recorder.ts
git commit -m "feat: add evidence coverage service and events

EvidenceCoverageService 调用 AgentModelClient 判断证据覆盖度，
失败时返回 unknown 触发降级。新增三个 case log 事件用于审计。"
```

## Task 3: 新增 CoverageService 单元测试

**Files:**
- Create: `test/evidence-coverage-service.test.mjs`

**Interfaces:**
- Consumes: `EvidenceCoverageService`（from Task 2）、`CaseRuntimeEventRecorder`、fake `AgentModelClient`。

- [ ] **Step 1: 写 covered 路径测试**

Create `test/evidence-coverage-service.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { EvidenceCoverageService } from '../dist/runtime/evidence-coverage-service.js';

function fakeModel(response) {
  return {
    async complete() {
      return response;
    },
  };
}

function fakeEvents() {
  const events = [];
  return {
    record: (e) => events.push(e),
    evidenceCoverageStarted: () => events.push({ phase: 'evidence_coverage_started' }),
    evidenceCoverageResult: () => events.push({ phase: 'evidence_coverage_result' }),
    evidenceCoverageFailed: () => events.push({ phase: 'evidence_coverage_failed' }),
  };
}

const sampleEvidence = [{
  evidence_id: 'ev_001',
  title: '学员数据统计补跑命令',
  summary: '学员数据统计缺失时可用命令行补跑',
  answer_span: '执行 php app/console student:statistics:rebuild --month=2024-06 补跑',
  excerpt: '步骤1：执行 php app/console student:statistics:rebuild',
}];

test('coverage service returns covered when model says covered', async () => {
  const service = new EvidenceCoverageService(
    fakeModel(JSON.stringify({ coverage: 'covered', missing_elements: [], reason: '证据包含补跑命令' })),
    fakeEvents(),
    'spec',
  );
  const result = await service.evaluate({ question: '如何补跑学员数据统计', evidence: sampleEvidence });
  assert.equal(result.coverage, 'covered');
  assert.deepEqual(result.missingElements, []);
});

test('coverage service returns not_covered when model says not_covered', async () => {
  const service = new EvidenceCoverageService(
    fakeModel(JSON.stringify({ coverage: 'not_covered', missing_elements: ['补跑步骤', '命令行名称'], reason: '只命中功能说明' })),
    fakeEvents(),
    'spec',
  );
  const result = await service.evaluate({ question: '学员数据统计缺失如何补，有没有命令行', evidence: sampleEvidence });
  assert.equal(result.coverage, 'not_covered');
  assert.equal(result.missingElements.length, 2);
});

test('coverage service returns partial when model says partial', async () => {
  const service = new EvidenceCoverageService(
    fakeModel(JSON.stringify({ coverage: 'partial', missing_elements: ['命令行参数'], reason: '有步骤但缺命令' })),
    fakeEvents(),
    'spec',
  );
  const result = await service.evaluate({ question: '如何补跑数据', evidence: sampleEvidence });
  assert.equal(result.coverage, 'partial');
});

test('coverage service degrades to unknown when model throws', async () => {
  const throwingModel = {
    async complete() { throw new Error('model unavailable'); },
  };
  const service = new EvidenceCoverageService(throwingModel, fakeEvents(), 'spec');
  const result = await service.evaluate({ question: '如何补跑', evidence: sampleEvidence });
  assert.equal(result.coverage, 'unknown');
  assert.match(result.reason, /coverage evaluation failed/);
});

test('coverage service degrades to unknown when model returns non-json', async () => {
  const service = new EvidenceCoverageService(
    fakeModel('not json at all'),
    fakeEvents(),
    'spec',
  );
  const result = await service.evaluate({ question: '如何补跑', evidence: sampleEvidence });
  assert.equal(result.coverage, 'unknown');
});

test('coverage service degrades to unknown when coverage field missing', async () => {
  const service = new EvidenceCoverageService(
    fakeModel(JSON.stringify({ missing_elements: [], reason: 'no coverage field' })),
    fakeEvents(),
    'spec',
  );
  const result = await service.evaluate({ question: '如何补跑', evidence: sampleEvidence });
  assert.equal(result.coverage, 'unknown');
});
```

- [ ] **Step 2: 构建并运行测试**

Run: `pnpm build && node --test test/evidence-coverage-service.test.mjs`
Expected: 6 个 test 全部 pass。

- [ ] **Step 3: 提交**

```bash
git add test/evidence-coverage-service.test.mjs
git commit -m "test: add evidence coverage service unit tests

覆盖 covered/not_covered/partial/模型抛错/非JSON/缺字段六条路径。"
```

## Task 4: 接入 config 和 settings 开关

**Files:**
- Modify: `src/config.ts`
- Modify: `src/settings/contracts.ts`
- Modify: `src/settings/model-settings.ts`

**Interfaces:**
- Produces: `config.agent.useModelForEvidenceCoverage` (boolean, 默认 true)、`config.agent.evidenceCoverageTopN` (number, 默认 3)。

- [ ] **Step 1: 在 config.ts 类型定义新增字段**

在 `src/config.ts:47-55` 的 `agent` 类型块中，在 `useModelForPreflight: boolean;` 之后新增：

```ts
    useModelForPreflight: boolean;
    useModelForEvidenceCoverage?: boolean;
    evidenceCoverageTopN?: number;
```

- [ ] **Step 2: 在 defaultConfig 设默认值**

在 `src/config.ts` 的 `defaultConfig()` 函数中（搜索 `useModelForPreflight: false` 的位置，约 129 行），在 `useModelForPreflight` 之后新增：

```ts
      useModelForPreflight: false,
      useModelForEvidenceCoverage: true,
      evidenceCoverageTopN: 3,
```

- [ ] **Step 3: 在 settings contracts 暴露开关**

在 `src/settings/contracts.ts:14` 的 `useModelForPreflight?: boolean;` 之后新增：

```ts
  useModelForPreflight?: boolean;
  useModelForEvidenceCoverage?: boolean;
```

- [ ] **Step 4: 在 model-settings 应用开关**

在 `src/settings/model-settings.ts:19` 的 `input.config.agent.useModelForPreflight = input.body.useModelForPreflight ?? true;` 之后新增：

```ts
  input.config.agent.useModelForPreflight = input.body.useModelForPreflight ?? true;
  input.config.agent.useModelForEvidenceCoverage = input.body.useModelForEvidenceCoverage ?? true;
```

- [ ] **Step 5: 运行 typecheck 和 test**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck 退出码 0，测试全绿。

- [ ] **Step 6: 提交**

```bash
git add src/config.ts src/settings/contracts.ts src/settings/model-settings.ts
git commit -m "feat: add useModelForEvidenceCoverage config switch

默认开启，可在 settings 关闭。evidenceCoverageTopN 默认 3。"
```

## Task 5: 集成到 knowledge-turn 和 diagnostic-runtime

**Files:**
- Modify: `src/runtime/knowledge-turn.ts`
- Modify: `src/runtime/diagnostic-runtime.ts`

**Interfaces:**
- Consumes: `EvidenceCoverageService`（from Task 2）、`EvidenceJudgeResult`、`KnowledgeEvidenceResult`、`resolveAgentConfig('evidence_coverage')`。
- Produces: `KnowledgeTurnService` 在 Judge 之后调用 CoverageService，`not_covered`/`partial` 时覆盖 Judge 结论。

- [ ] **Step 1: 修改 KnowledgeTurnService 构造接收 coverageService**

在 `src/runtime/knowledge-turn.ts`：

1. 顶部 import 新增：

```ts
import { EvidenceCoverageService } from './evidence-coverage-service.js';
```

2. 类构造新增 `coverageService` 可选字段（在 `reviewer` 之后）：

```ts
export class KnowledgeTurnService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly store: FileMemoryStore,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly reviewer: ReviewPresentationService,
    private readonly coverageService?: EvidenceCoverageService,
  ) {}
```

- [ ] **Step 2: 在 answer 方法中集成 coverage 调用和事件**

在 `src/runtime/knowledge-turn.ts` 的 `answer` 方法中，找到 `this.events.evidenceJudgeResult(caseSession, judge);`（约 53 行），在它之后、`if (!judge.answerable || judge.need_code_escalation)` 之前，插入 coverage 判断：

```ts
    this.events.evidenceJudgeResult(caseSession, judge);

    if (this.coverageService && this.config.agent.useModelForEvidenceCoverage !== false && judge.answerable && evidencePack.results[0]) {
      const topScore = evidencePack.results[0].retrieval?.rerankScore ?? 0;
      if (topScore >= 0.7) {
        this.events.evidenceCoverageStarted(caseSession, {
          question: userMessage,
          evidenceIds: evidencePack.results.slice(0, 3).map((item) => item.evidence_id),
        });
        const coverage = await this.coverageService.evaluate({
          question: userMessage,
          evidence: evidencePack.results,
        });
        if (coverage.coverage === 'not_covered' || coverage.coverage === 'partial') {
          judge.answerable = false;
          judge.need_code_escalation = true;
          judge.blockers.push('question_not_answered');
          judge.ambiguity.push(`证据未覆盖原问题答案要素：${coverage.missingElements.join('、') || '关键要素缺失'}`);
          judge.recommended_next_action = 'dispatch_code_diagnosis';
          judge.confidence = 'low';
          judge.reason = coverage.reason || '知识证据未覆盖原问题答案要素，拒绝直答。';
        }
        this.events.evidenceCoverageResult(caseSession, coverage);
      }
    }

    if (!judge.answerable || judge.need_code_escalation) {
```

注意：`EvidenceJudgeResult` 的字段都不是 readonly（已在 `src/runtime/evidence-judge.ts:34-50` 确认），可直接修改。`evidence_id` 是 `KnowledgeEvidenceResult` 的字段名（下划线，来自 knowledge types）。

- [ ] **Step 3: 修改 DiagnosticRuntime 构造 EvidenceCoverageService 并注入**

在 `src/runtime/diagnostic-runtime.ts`：

1. 顶部 import 新增：

```ts
import { EvidenceCoverageService } from './evidence-coverage-service.js';
```

2. 在 `const presentationAgentSpec = resolveAgentConfig('presentation').content;`（约 43 行）之后新增：

```ts
  const evidenceCoverageAgentSpec = resolveAgentConfig('evidence_coverage').content;
```

3. 在 `this.knowledgeTurn = new KnowledgeTurnService(...)`（约 65 行）之前构造 service，并在 KnowledgeTurnService 构造调用中传入：

```ts
    const coverageService = new EvidenceCoverageService(
      model,
      this.events,
      evidenceCoverageAgentSpec,
      config.agent.evidenceCoverageTopN ?? 3,
    );
    this.knowledgeTurn = new KnowledgeTurnService(config, store, this.events, this.reviewer, coverageService);
```

- [ ] **Step 4: 运行 typecheck**

Run: `pnpm typecheck`
Expected: 退出码 0。

- [ ] **Step 5: 运行全量测试确认未破坏**

Run: `pnpm build && pnpm test`
Expected: 全部 pass（298 + Task 3 新增 6 = 304）。

注意：现有测试若 `config.agent.modelProvider` 未配置，`createModelClient` 返回 `NoopModelClient`，调用时抛错被 CoverageService 捕获降级为 `unknown`，不改变 Judge 结论，现有行为不变。`supper-helper.test.mjs` 里 `delete config.agent.modelProvider` 的测试仍能通过。但部分测试可能断言 `judge.answerable=true` 并走直答路径——这些测试若 rerankScore>=0.7 会触发 coverage 调用，NoopModelClient 抛错降级为 unknown，Judge 维持原 `answerable=true`，所以仍通过。

- [ ] **Step 6: 提交**

```bash
git add src/runtime/knowledge-turn.ts src/runtime/diagnostic-runtime.ts
git commit -m "feat: integrate evidence coverage judge into runtime

Judge 判 answerable 后，若 rerankScore>=0.7 且开关开启，调用
CoverageService 判断证据覆盖度；not_covered/partial 时覆盖 Judge
结论为拒绝直答。模型失败降级回原结论。"
```

## Task 6: 新增集成测试：相关但不回答的高分证据被拦截

**Files:**
- Modify: `test/retrieval-grounding.test.mjs`

**Interfaces:**
- Consumes: `EvidenceCoverageService`、`judgeKnowledgeEvidence`、`prepareKnowledgeDiagnosis`、fake `AgentModelClient`。

- [ ] **Step 1: 写集成测试——Coverage Agent 拦截高分但无关证据**

在 `test/retrieval-grounding.test.mjs` 末尾追加：

```js
import { EvidenceCoverageService } from '../dist/runtime/evidence-coverage-service.js';

function fakeCoverageModel(response) {
  return {
    async complete() {
      return typeof response === 'string' ? response : JSON.stringify(response);
    },
  };
}

function fakeCoverageEvents() {
  return {
    evidenceCoverageStarted: () => {},
    evidenceCoverageResult: () => {},
    evidenceCoverageFailed: () => {},
  };
}

test('coverage agent rejects high-rerank evidence that does not answer operation-procedure question', async () => {
  const question = '学员管理的学员数据统计里面缺少6月份的数据，如何补上，有没有现成的命令行处理？';
  const featureEvidence = evidence({
    evidence_id: 'ev_user_data_statistics',
    document_id: 'kb_user_data_statistics',
    parent_id: 'kb_user_data_statistics',
    title: '用户数据统计',
    module: 'edusoho-training',
    intent: 'product_rule',
    source_type: 'whitepaper',
    matched_terms: ['学员管理', '数据统计', '学员', '统计'],
    summary: '用户数据统计：查看用户的基本学习和消费数据详情',
    answer_span: '查看用户的基本学习和消费数据详情，可以通过学员用户名、手机号进行搜索，支持数据导出。',
    excerpt: '用户数据统计：- section_path: 用户（有修改） > 学员管理 > 用户数据统计',
    score: 48.3,
    retrieval: { source: 'rerank', keywordScore: 48.3, rerankScore: 0.887 },
  });

  const judge = judgeKnowledgeEvidence({
    route: route({
      normalizedQuestion: question,
      moduleCandidates: [],
      intentCandidates: [],
      keywords: ['学员管理', '数据统计', '命令行'],
      sourceTypes: ['faq', 'runbook'],
    }),
    evidencePack: pack(featureEvidence),
    question,
  });

  const coverageService = new EvidenceCoverageService(
    fakeCoverageModel({
      coverage: 'not_covered',
      missing_elements: ['补跑/重跑数据的步骤', '命令行名称或参数'],
      reason: '证据只描述了用户数据统计的页面功能，未覆盖补数据步骤或命令行操作',
    }),
    fakeCoverageEvents(),
    'spec',
  );

  const coverage = await coverageService.evaluate({ question, evidence: [featureEvidence] });
  assert.equal(coverage.coverage, 'not_covered');
  assert.equal(coverage.missingElements.length, 2);
});

test('coverage agent preserves direct answer when evidence truly covers question', async () => {
  const question = '学员数据统计缺失如何补跑，有没有命令行？';
  const runbookEvidence = evidence({
    evidence_id: 'ev_student_stats_backfill',
    document_id: 'kb_student_stats_backfill',
    parent_id: 'kb_student_stats_backfill',
    title: '学员数据统计补跑命令',
    module: 'edusoho-training',
    intent: 'how_to',
    source_type: 'runbook',
    matched_terms: ['学员数据统计', '补跑', '命令行'],
    summary: '学员数据统计缺失时可用命令行补跑指定月份',
    answer_span: '执行 php app/console student:statistics:rebuild --month=2024-06 补跑指定月份学员数据统计。',
    excerpt: '步骤1：执行 php app/console student:statistics:rebuild --month=YYYY-MM',
    retrieval: { source: 'rerank', keywordScore: 30, rerankScore: 0.92 },
  });

  const coverageService = new EvidenceCoverageService(
    fakeCoverageModel({
      coverage: 'covered',
      missing_elements: [],
      reason: '证据包含具体补跑命令和参数',
    }),
    fakeCoverageEvents(),
    'spec',
  );

  const coverage = await coverageService.evaluate({ question, evidence: [runbookEvidence] });
  assert.equal(coverage.coverage, 'covered');
});
```

- [ ] **Step 2: 构建并运行测试**

Run: `pnpm build && node --test test/retrieval-grounding.test.mjs --test-name-pattern "coverage agent"`
Expected: 2 个 test 全部 pass。

- [ ] **Step 3: 提交**

```bash
git add test/retrieval-grounding.test.mjs
git commit -m "test: add coverage agent integration tests

验证高分但不回答操作问题的证据被 not_covered 拦截，
真正包含命令的 runbook 证据被 covered 放行。"
```

## Task 7: 调整 case_4e905fbc 端到端回归测试

**Files:**
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: 检查现有 case_4e905fbc 回归测试的断言**

读取 `test/supper-helper.test.mjs:1328-1391` 的 `runtime escalates scheduled-statistics backfill questions even with matching knowledge evidence` 测试。该测试已断言：

```js
assert.equal(workerRequests[0].context.knowledge.judge.need_code_escalation, true);
assert.equal(workerRequests[0].context.knowledge.judge.blockers.includes('question_not_answered'), true);
```

这说明本地未提交的 `inferAnswerRequirements` 改动已让该测试通过规则型 Judge 拦截。现在引入 Coverage Agent 后，即使规则型 Judge 漏拦，Coverage Agent 也会拦截。测试断言保持不变。该测试 `delete config.agent.modelProvider`，所以 CoverageService 调用 NoopModelClient 抛错降级为 unknown——但规则型 Judge 已拦截，所以 `need_code_escalation=true` 仍成立。

- [ ] **Step 2: 新增一个测试验证 Coverage Agent 在无 modelProvider 时降级**

在 `test/supper-helper.test.mjs` 的 `runtime escalates scheduled-statistics backfill questions` 测试之后，新增：

```js
test('runtime degrades coverage agent to noop when model provider missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      return {
        result: {
          status: 'concluded',
          summary: '已升级排查。',
          missingInfo: [],
          evidence: [{ id: 'ev_code', kind: 'workspace', source: 'Grep', summary: '命令行排查。', confidence: 'medium' }],
          claims: [],
          recommendedNextAction: 'final_answer',
        },
        trace: { command: 'worker', cwd: workspace, stdout: '', stderr: '', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
      };
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.agent.useModelForEvidenceCoverage = true;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeWhitepaper(knowledgeWorkspace, {
      module: 'edusoho-training',
      title: '用户数据统计',
      body: '用户数据统计用于查看学员管理中的用户统计数据。',
      terms: ['学员管理', '用户数据统计', '学员数据统计'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new DiagnosticRuntime(config, store, worker);

    const response = await agent.handleUserMessage({
      message: '学员管理的学员数据统计里面缺少6月份的数据，如何补上，有没有现成命令行处理？',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 1);
    const logs = store.loadCase(workerRequests[0].caseId)?.logs ?? [];
    const coverageLogs = logs.filter((log) => log.phase === 'evidence_coverage_result' || log.phase === 'evidence_coverage_failed');
    assert.ok(coverageLogs.length >= 1, 'coverage agent should record an event even when model missing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
```

注意：这个测试验证降级路径——NoopModelClient 抛错 → CoverageService 返回 `unknown` → 记录 `evidence_coverage_failed` 事件。Judge 的规则型 `inferAnswerRequirements` 仍会拦截（因为本地改动已让 `question_not_answered` blocker 生效），所以 `workerRequests.length === 1` 仍然成立。

- [ ] **Step 3: 构建并运行测试**

Run: `pnpm build && node --test test/supper-helper.test.mjs --test-name-pattern "coverage agent"`
Expected: pass。

- [ ] **Step 4: 提交**

```bash
git add test/supper-helper.test.mjs
git commit -m "test: add coverage agent degradation regression

验证无 modelProvider 时 Coverage Agent 降级到 unknown，
不阻断主流程，仍记录事件用于审计。"
```

## Task 8: 更新 Agent 和架构文档

**Files:**
- Modify: `src/agents/evidence-judge.md`
- Modify: `docs/architecture/agents.md`

- [ ] **Step 1: 在 evidence-judge.md 补充 Coverage Agent 协作说明**

在 `src/agents/evidence-judge.md` 的 `## Rules` 末尾追加：

```markdown
- Evidence Judge 完成确定性评分后，若 `answerable=true` 且 top evidence 的 `rerankScore>=0.7`，runtime 会调用 Evidence Coverage Agent 做语义覆盖校验。Coverage Agent 判定 `not_covered` 或 `partial` 时，覆盖 Judge 结论为拒绝直答。
- Coverage Agent 调用失败或未开启时，维持 Evidence Judge 原结论，不阻断主流程。
```

- [ ] **Step 2: 在 docs/architecture/agents.md 更新 Knowledge-First 流程描述**

在 `docs/architecture/agents.md` 中搜索 `Knowledge-First` 或 `Evidence Judge` 段落，追加：

```markdown
Evidence Judge 之后叠加 Evidence Coverage Agent（model_assisted）：当 Judge 判定可直答且 top evidence 的 rerankScore>=0.7 时，调用模型判断证据是否真正覆盖原问题需要的答案要素。模型判 not_covered/partial 时覆盖结论为拒绝直答并升级到代码诊断；模型失败降级回 Judge 原结论。该机制防止"相关但不回答"的高分证据误导直答（如 case_4e905fbc）。
```

- [ ] **Step 3: 运行 docs lint**

Run: `pnpm lint`
Expected: `Docs lint passed`。

- [ ] **Step 4: 提交**

```bash
git add src/agents/evidence-judge.md docs/architecture/agents.md
git commit -m "docs: document evidence coverage agent in agent design"
```

## Task 9: 完整验证

**Files:** No file changes.

- [ ] **Step 1: 运行 lint**

Run: `pnpm lint`
Expected: `Docs lint passed`。

- [ ] **Step 2: 运行 typecheck**

Run: `pnpm typecheck`
Expected: 退出码 0。

- [ ] **Step 3: 运行 build**

Run: `pnpm build`
Expected: 退出码 0，dist 同步更新。

- [ ] **Step 4: 运行全量测试**

Run: `pnpm test`
Expected: `fail 0`，测试总数 = 原 298 + Task 3 的 6 + Task 6 的 2 + Task 7 的 1 = 307。

- [ ] **Step 5: 验收检查**

确认以下行为同时成立：

1. `test/evidence-coverage-service.test.mjs` 6 条路径全绿（covered/not_covered/partial/抛错/非JSON/缺字段）。
2. `test/retrieval-grounding.test.mjs` 的 coverage agent 集成测试绿（高分但不回答被拦截，真有命令被放行）。
3. `test/supper-helper.test.mjs` 的 case_4e905fbc 回归绿（`need_code_escalation=true`、`blockers.includes('question_not_answered')`）。
4. 关闭 `useModelForEvidenceCoverage` 时，行为回退到纯规则型 Judge（现有测试全绿）。
5. case JSON logs 在启用 Coverage Agent 时包含 `evidence_coverage_result` 或 `evidence_coverage_failed` 条目。

## 自检

- **Spec coverage**:
  - 3.1 架构定位 → Task 5 集成（knowledge-turn 编排）
  - 3.2 触发条件 → Task 5 Step 2 条件判断
  - 3.3 Agent 配置 → Task 1
  - 3.4 Agent prompt → Task 1 Step 1
  - 3.5 运行时集成 → Task 2 + Task 5（不修改 knowledge-diagnosis，编排放 knowledge-turn）
  - 3.6 事件记录 → Task 2 Step 2-3 + Task 5 Step 2 事件触发
  - 3.7 配置 → Task 4
  - 3.8 降级策略 → Task 3 测试 + Task 5 降级逻辑 + Task 7 降级回归
  - 4. 模块边界合规 → 文件结构遵守（未改 retrieval/knowledge/providers/gateway/workers）
  - 5. 测试策略 → Task 3 + Task 6 + Task 7
  - 6. 非目标 → 未触及检索算法
  - 8. 验收标准 → Task 9
- **Placeholder scan**: 无 TBD/TODO，每步含完整代码或命令。
- **Type consistency**: `EvidenceCoverageService`、`CoverageResult`、`EvidenceCoverage`、`evidenceCoverageStarted/Result/Failed` 在所有 task 中命名一致。`evidence_id`（下划线）来自 `KnowledgeEvidenceResult`，与现有测试 fixture 一致。

## 执行建议

优先使用 Subagent-Driven，每个 task 一个干净执行单元；主线程在每个 task 后 review diff 和测试输出。该计划改的是 RAG 判定核心，不建议一次性大批量改完后再看测试。
