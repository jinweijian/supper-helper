import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { CaseRuntimeEventRecorder } from '../dist/runtime/event-recorder.js';
import { PreflightService } from '../dist/runtime/preflight-service.js';
import { FileMemoryStore } from '../dist/storage.js';

const SENTINEL = 'direct_answer';

async function api() {
  return import('../dist/runtime/answer-goal-reconciliation.js');
}

test('Gate B: valid scoped items are normalized and accepted only after independent completeness review', async () => {
  const { reconcileMustAnswerItems } = await api();
  const result = reconcileMustAnswerItems({
    resolvedQuestion: '如何开启 X，以及多久生效？',
    proposedItems: [' 如何开启   X ', '多久生效', '多久生效'],
    completenessReview: {
      status: 'complete',
      missingElements: [],
      reason: 'all_obligations_represented',
    },
  });

  assert.deepEqual(result.items, ['如何开启 X', '多久生效']);
  assert.equal(result.source, 'model');
  assert.equal(result.reason, 'accepted');
});

test('Gate B: malformed item collections fall back as a whole', async () => {
  const { reconcileMustAnswerItems } = await api();
  const base = {
    resolvedQuestion: '如何开启 X，以及多久生效？',
    completenessReview: { status: 'complete', missingElements: [], reason: 'ok' },
  };
  const invalidCollections = [
    undefined,
    '如何开启 X',
    [],
    Array.from({ length: 6 }, (_, index) => `item_${index}`),
    ['如何开启 X', 42],
    ['如何开启 X', ''],
    ['如何开启 X', '甲'.repeat(81)],
    ['如何开启 X', '包含\u0000控制字符'],
    ['如何开启 X', 'token=sk-123456789012345678901234'],
  ];

  for (const proposedItems of invalidCollections) {
    const result = reconcileMustAnswerItems({ ...base, proposedItems });
    assert.deepEqual(result.items, [SENTINEL]);
    assert.equal(result.source, 'fallback');
  }
});

test('Gate B: out-of-scope diagnostic or tool-routing text rejects the entire set without keyword guessing', async () => {
  const { reconcileMustAnswerItems } = await api();
  for (const proposedItems of [
    ['如何开启 X', '调用 MCP 搜索配置'],
    ['如何开启 X', '检查 worker 日志'],
    ['如何开启 X', '另一个不在原问题里的目标'],
  ]) {
    const result = reconcileMustAnswerItems({
      resolvedQuestion: '如何开启 X，以及多久生效？',
      proposedItems,
      completenessReview: { status: 'complete', missingElements: [], reason: 'ok' },
    });
    assert.deepEqual(result.items, [SENTINEL]);
    assert.equal(result.reason, 'item_out_of_scope');
  }
});

test('Gate B: incomplete, unavailable, malformed, or proposer-self-certified review cannot replace the independent decision', async () => {
  const { reconcileMustAnswerItems } = await api();
  const base = {
    resolvedQuestion: '如何开启 X，以及多久生效？',
    proposedItems: ['如何开启 X'],
  };
  for (const completenessReview of [
    undefined,
    { status: 'unknown', missingElements: [], reason: 'unavailable' },
    { status: 'incomplete', missingElements: ['多久生效'], reason: 'missing_obligation' },
    { status: 'complete', missingElements: ['多久生效'], reason: 'self_conflict' },
    { status: 'complete', missingElements: [], reason: 'ok', proposerCertified: true },
  ]) {
    const result = reconcileMustAnswerItems({ ...base, completenessReview });
    assert.deepEqual(result.items, [SENTINEL]);
    assert.equal(result.source, 'fallback');
  }
});

test('Gate B: completeness service uses a separate bounded model call and validates its schema', async () => {
  const { AnswerGoalCompletenessReviewService } = await import(
    '../dist/runtime/answer-goal-completeness-review-service.js'
  );
  const calls = [];
  const service = new AnswerGoalCompletenessReviewService({
    async complete(messages, options) {
      calls.push({ messages, options });
      return JSON.stringify({
        status: 'complete',
        missingElements: [],
        reason: 'all_obligations_represented',
      });
    },
  }, 'INDEPENDENT COMPLETENESS AGENT');

  const review = await service.review({
    resolvedQuestion: '如何开启 X，以及多久生效？',
    proposedItems: ['如何开启 X', '多久生效'],
  });

  assert.equal(review.status, 'complete');
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[0].content, /INDEPENDENT COMPLETENESS AGENT/);
  assert.doesNotMatch(JSON.stringify(calls[0]), /proposerRationale|selfAssessment/);
});

test('Gate B: completeness failure reasons are bounded and secret-redacted', async () => {
  const { AnswerGoalCompletenessReviewService } = await import(
    '../dist/runtime/answer-goal-completeness-review-service.js'
  );
  const service = new AnswerGoalCompletenessReviewService({
    async complete() {
      throw new Error(`token=sk-${'a'.repeat(40)} ${'错'.repeat(300)}`);
    },
  }, 'INDEPENDENT COMPLETENESS AGENT');

  const review = await service.review({
    resolvedQuestion: '任意问题',
    proposedItems: ['任意问题'],
  });

  assert.equal(review.status, 'unknown');
  assert.doesNotMatch(review.reason, /sk-|a{20}/);
  assert.ok(Array.from(review.reason).length <= 187);
});

test('Gate B production wiring: Preflight carries accepted items once and invokes the independent reviewer', () => {
  const preflight = readFileSync(
    new URL('../src/runtime/preflight-service.ts', import.meta.url),
    'utf8',
  );
  const runtime = readFileSync(
    new URL('../src/runtime/diagnostic-runtime.ts', import.meta.url),
    'utf8',
  );
  assert.match(preflight, /mustAnswerItems/);
  assert.match(preflight, /AnswerGoalCompletenessReviewService/);
  assert.match(preflight, /reconcileMustAnswerItems/);
  assert.match(runtime, /answer_goal_completeness/);
  assert.doesNotMatch(
    preflight,
    /modelDecision\.request\.answerGoal\s*=\s*resolvedTurn\s*\?\s*buildAnswerGoal/,
  );
});

test('Gate B: accepted item identities survive the production Preflight reconcile path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'answer-goal-gate-b-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.agent.useModelForPreflight = true;
    config.agent.modelProvider = 'fake';
    config.workspaces = [{
      id: 'current',
      name: 'Current',
      rootPath: process.cwd(),
      mcpToolIds: [],
    }];
    const store = new FileMemoryStore(root);
    const caseSession = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: 'test',
    });
    store.addMessage(caseSession, {
      role: 'user',
      body: '如何开启 X，以及多久生效？',
    });
    const calls = [];
    const model = {
      async complete(messages) {
        calls.push(messages);
        if (messages[0].content.includes('INDEPENDENT COMPLETENESS')) {
          return JSON.stringify({
            status: 'complete',
            missingElements: [],
            reason: 'all_obligations_represented',
          });
        }
        return JSON.stringify({
          action: 'dispatch',
          reason: 'inspectable',
          missingInfo: [],
          mustAnswerItems: ['如何开启 X', '多久生效'],
          resolvedTurn: {
            confirmedFacts: [],
            userClaims: [],
            hypotheses: [],
            unknowns: [],
          },
        });
      },
    };
    const service = new PreflightService(
      config,
      store,
      model,
      new CaseRuntimeEventRecorder(store),
      'MAIN',
      'INPUT REVIEW',
      'EXPERIENCE',
      'INDEPENDENT COMPLETENESS',
    );

    const decision = await service.decide(caseSession, '如何开启 X，以及多久生效？');

    assert.equal(decision.action, 'dispatch');
    assert.deepEqual(decision.request.answerGoal.mustAnswerItems, ['如何开启 X', '多久生效']);
    assert.equal(calls.length, 2);
    assert.match(calls[1][0].content, /INDEPENDENT COMPLETENESS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Gate B: Preflight dispatch readiness does not depend on business-language keyword lists', () => {
  const decisionSource = readFileSync(
    new URL('../src/runtime/preflight-decision.ts', import.meta.url),
    'utf8',
  );
  const gateSource = readFileSync(
    new URL('../src/runtime/preflight-gate.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(decisionSource, /hasActionableSignal|REQUIRED_SIGNALS/);
  assert.doesNotMatch(
    decisionSource,
    /有哪些功能|报错\|失败\|异常|哪里\|在哪\|如何|component\|组件\|配置/,
  );
  assert.doesNotMatch(gateSource, /isGenericWorkspaceFollowUp|产品\|系统\|项目\|工作区/);
});

test('Gate B: Experience exact-goal identity compares resolved question, answer object, and item set', async () => {
  const { hasExactExperienceAnswerGoal } = await import('../dist/runtime/experience-agent.js');
  const current = {
    rawUserQuestion: '原始问法可不同',
    resolvedQuestion: '如何开启 X，以及多久生效？',
    answerObject: 'X',
    mustAnswerItems: ['如何开启 X', '多久生效'],
    diagnosticObjective: '仅供内部排查',
    sourceMessageIds: ['current_message'],
  };
  const source = {
    ...current,
    rawUserQuestion: '历史原始问法',
    diagnosticObjective: '历史内部目标',
    sourceMessageIds: ['source_message'],
    mustAnswerItems: ['多久生效', '如何开启   X'],
  };

  assert.equal(hasExactExperienceAnswerGoal(current, source), true);
  assert.equal(hasExactExperienceAnswerGoal(current, { ...source, resolvedQuestion: '如何开启 X？' }), false);
  assert.equal(hasExactExperienceAnswerGoal(current, { ...source, answerObject: 'Y' }), false);
  assert.equal(hasExactExperienceAnswerGoal(current, { ...source, mustAnswerItems: ['如何开启 X'] }), false);
  assert.equal(hasExactExperienceAnswerGoal(
    { ...current, resolvedQuestion: '问题 A', answerObject: '问题 A', mustAnswerItems: [SENTINEL] },
    { ...source, resolvedQuestion: '问题 B', answerObject: '问题 B', mustAnswerItems: [SENTINEL] },
  ), false);
});

test('Gate B: Experience source never wraps historical rendered reply as a primary claim', () => {
  const source = readFileSync(
    new URL('../src/runtime/experience-agent.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /claim_history_reply/);
  assert.doesNotMatch(source, /text:\s*reply\.body/);
  assert.match(source, /currentEvidenceResolver/);
});

test('Gate B: Knowledge Experience revalidation pins and rechecks one active generation', () => {
  const source = readFileSync(
    new URL('../src/runtime/knowledge-experience-resolver.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /readKnowledgeChunks\(\s*workspaceRoot,\s*activeGeneration\.generation_id/);
  assert.match(source, /currentGeneration\?\.generation_id !== activeGeneration\.generation_id/);
});

test('Gate B observability records item source, count, and fallback reason without candidate text', () => {
  const source = readFileSync(
    new URL('../src/runtime/event-recorder/preflight.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /answerGoalItemsReconciled/);
  assert.doesNotMatch(source, /raw:\s*redactSecretText\(raw\)/);
});

test('Gate B: Experience replays structured claims only after an exact goal and current resolver', async () => {
  const { findExperienceMatch } = await import('../dist/runtime/experience-agent.js');
  const root = mkdtempSync(join(tmpdir(), 'experience-exact-current-'));
  try {
    const store = new FileMemoryStore(root);
    const source = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: 'source',
    });
    const question = '如何开启 X，以及多久生效？';
    const sourceMessage = store.addMessage(source, { role: 'user', body: question });
    store.addMessage(source, {
      role: 'helper',
      body: '这是历史渲染文本，不得复用。',
      replyToMessageId: sourceMessage.id,
    });
    const goal = {
      rawUserQuestion: question,
      resolvedQuestion: question,
      answerObject: 'X',
      mustAnswerItems: ['如何开启 X', '多久生效'],
      diagnosticObjective: 'internal',
      sourceMessageIds: [sourceMessage.id],
    };
    store.addRun(source, {
      id: 'run_source',
      caseId: source.id,
      status: 'concluded',
      request: {
        caseId: source.id,
        runId: 'run_source',
        workspaceId: 'current',
        answerGoal: goal,
        userGoal: question,
        knownFacts: [],
        unknowns: [],
        constraints: [],
        allowedMcpToolIds: [],
        context: {
          isFollowUp: false,
          currentUserMessage: question,
          recentMessages: [],
          previousRuns: [],
          resolvedTurn: {
            latestUserMessage: question,
            resolvedQuery: question,
            sourceMessageIds: [sourceMessage.id],
            isFollowUp: false,
            confirmedFacts: [],
            userClaims: [],
            hypotheses: [],
            unknowns: [],
          },
        },
      },
      result: {
        status: 'concluded',
        summary: '历史摘要不得成为主答',
        missingInfo: [],
        evidence: [{
          id: 'ev_kb_x_001',
          kind: 'knowledge',
          source: 'old',
          summary: '旧内容',
          confidence: 'high',
        }],
        claims: [{
          id: 'claim_structured',
          type: 'fact',
          role: 'primary_answer',
          text: '在设置页开启 X，保存后五分钟生效。',
          evidenceIds: ['ev_kb_x_001'],
          answers: [...goal.mustAnswerItems],
        }],
        recommendedNextAction: 'final_answer',
      },
    });
    source.status = 'concluded';
    store.saveCase(source);
    const current = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: 'current',
    });
    const match = findExperienceMatch({
      store,
      currentCase: current,
      userMessage: question,
      answerGoal: { ...goal, sourceMessageIds: ['current_message'] },
      currentEvidenceResolver: {
        resolve({ evidence }) {
          return {
            evidence: {
              ...evidence,
              source: 'current-v4',
              summary: '当前 canonical 内容',
              validation: {
                status: 'active',
                visibility: 'internal',
                quality: 'ok',
                lastVerifiedAt: new Date().toISOString(),
              },
            },
            coverageEvidenceEnvelope: {
              evidenceId: evidence.id,
              kind: 'knowledge',
              safeText: '当前 canonical 内容',
              freshness: 'current_knowledge_v4',
              validated: true,
              generationId: 'gen_current',
              currentGenerationId: 'gen_current',
              strictEligible: true,
            },
          };
        },
      },
    });
    assert.equal(match.result.claims[0].id, 'claim_structured');
    assert.equal(match.result.claims[0].text, '在设置页开启 X，保存后五分钟生效。');
    assert.notEqual(match.result.claims[0].text, '这是历史渲染文本，不得复用。');
    assert.equal(match.result.evidence[0].summary, '当前 canonical 内容');
    assert.equal(match.coverageEvidenceEnvelopes[0].generationId, 'gen_current');

    const withoutCurrentResolver = findExperienceMatch({
      store,
      currentCase: current,
      userMessage: question,
      answerGoal: { ...goal, sourceMessageIds: ['current_message'] },
    });
    assert.equal(withoutCurrentResolver, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
