import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DiagnosticRuntime } from '../dist/runtime/diagnostic-runtime.js';
import { defaultConfig } from '../dist/config.js';
import { preflight } from '../dist/preflight.js';
import { findExperienceMatch, findRejectedExperienceCandidates } from '../dist/runtime/experience-agent.js';
import { decisionFromReviewOutcome } from '../dist/runtime/review-gate.js';
import { formatSafeWorkerFailure } from '../dist/runtime/safe-failure-presentation.js';
import { renderReviewedResultForTest as ruleBasedReviewAndFormat } from './helpers/render-reviewed-result.mjs';
import { buildDiagnosticRequest } from '../dist/runtime/request-builder.js';
import { buildResolvedTurnContext, reconcileResolvedTurnContext } from '../dist/runtime/resolved-turn.js';
import { validateDiagnosticResult } from '../dist/runtime/result-validator.js';
import { sanitizeWorkerTrace } from '../dist/observability/worker-trace.js';
import { FileMemoryStore } from '../dist/storage.js';

function agentConfig() {
  return {
    id: 'test',
    name: 'test',
    language: 'zh-CN',
    tone: 'calm_professional',
    defaultPermission: 'read_only',
    rules: {
      noGuessing: true,
      requireEvidenceForConclusion: true,
      askWhenMissingRequiredInfo: true,
      allowUnknownAnswer: true,
      distinguishFactInferenceAssumption: true,
    },
  };
}

function caseSession(overrides = {}) {
  return {
    id: 'case_current',
    claudeSessionId: 'session',
    tenantId: 'tenant_a',
    userId: 'user_a',
    workspaceId: 'current',
    title: 'test',
    status: 'need_input',
    userPersona: 'operations',
    messages: [],
    runs: [],
    logs: [],
    ...overrides,
  };
}

function chatResponse(content) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function answerGoal(question, mustAnswerItems = ['direct_answer']) {
  return {
    rawUserQuestion: question,
    resolvedQuestion: question,
    answerObject: question,
    mustAnswerItems,
    diagnosticObjective: question,
    sourceMessageIds: ['msg_test'],
  };
}

function modelConfig(root) {
  const config = defaultConfig();
  config.storage.rootDir = root;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.agent.modelProvider = 'test';
  config.agent.useModelForPreflight = false;
  config.models.providers.test = {
    type: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    temperature: 0,
  };
  return config;
}

test('resolved preflight keeps unknown and hypotheses out of confirmed known facts', () => {
  const current = caseSession({
    messages: [
      { id: 'msg_question', role: 'user', body: '课程发布后学员为什么看不到入口？', createdAt: '2026-06-20T00:00:00Z' },
      { id: 'msg_helper', role: 'helper', body: '缺少具体账号，请补充。', createdAt: '2026-06-20T00:00:01Z', replyToMessageId: 'msg_question' },
      { id: 'msg_unknown', role: 'user', body: '不清楚', createdAt: '2026-06-20T00:00:02Z' },
    ],
  });
  const unknown = preflight({ caseSession: current, userMessage: '不清楚', agentConfig: agentConfig() });
  assert.equal(unknown.action, 'dispatch');
  assert.equal(unknown.request.userGoal, '课程发布后学员为什么看不到入口？');
  assert.equal(unknown.request.knownFacts.includes('不清楚'), false);
  assert.equal(unknown.request.context?.resolvedTurn?.unknowns.some((item) => item.text === '不清楚'), true);

  const hypothesisCase = caseSession({
    messages: [{ id: 'msg_hypothesis', role: 'user', body: '是不是数据库字段问题？', createdAt: '2026-06-20T00:00:00Z' }],
  });
  const hypothesis = preflight({ caseSession: hypothesisCase, userMessage: '是不是数据库字段问题？', agentConfig: agentConfig() });
  assert.equal(hypothesis.action, 'dispatch');
  assert.equal(hypothesis.request.knownFacts.includes('是不是数据库字段问题？'), false);
  assert.equal(hypothesis.request.context?.resolvedTurn?.hypotheses[0].sourceMessageId, 'msg_hypothesis');
});

test('resolved context is bounded, source-bound, and model reconciliation cannot promote facts', () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    id: `msg_${index + 1}`,
    role: 'user',
    body: index === 15 ? '是不是缓存导致课程入口不显示？' : `第 ${index + 1} 条历史描述`,
    createdAt: `2026-06-20T00:00:${String(index).padStart(2, '0')}Z`,
  }));
  const local = buildResolvedTurnContext({
    caseSession: caseSession({ messages }),
    latestUserMessage: messages.at(-1).body,
  });
  assert.equal(local.sourceMessageIds.length, 12);
  assert.equal(local.sourceMessageIds.includes('msg_1'), false);
  assert.equal(local.hypotheses[0].sourceMessageId, 'msg_16');

  const reconciled = reconcileResolvedTurnContext({
    local,
    model: {
      confirmedFacts: [{ text: '是不是缓存导致课程入口不显示？', sourceMessageId: 'msg_16' }],
      userClaims: [{ text: '模型补充主张', sourceMessageId: 'msg_16' }],
    },
  });
  assert.equal(reconciled.confirmedFacts.some((item) => item.text.includes('缓存')), false);
  assert.equal(reconciled.userClaims.some((item) => item.text === '模型补充主张'), true);
  assert.equal(reconciled.resolvedQuery, local.resolvedQuery);
});

test('a concrete clarification is incorporated into the unresolved query', () => {
  const current = caseSession({
    messages: [
      { id: 'msg_question', role: 'user', body: '课程保存为什么失败？', createdAt: '2026-06-20T00:00:00Z' },
      { id: 'msg_helper', role: 'helper', body: '还需要补充接口报错。', createdAt: '2026-06-20T00:00:01Z', replyToMessageId: 'msg_question' },
      { id: 'msg_detail', role: 'user', body: '接口 /course/save 返回 500', createdAt: '2026-06-20T00:00:02Z' },
    ],
  });
  const resolved = buildResolvedTurnContext({ caseSession: current, latestUserMessage: '接口 /course/save 返回 500' });
  assert.match(resolved.resolvedQuery, /课程保存为什么失败/);
  assert.match(resolved.resolvedQuery, /接口 \/course\/save 返回 500/);
  assert.equal(resolved.confirmedFacts.some((item) => item.sourceMessageId === 'msg_detail'), true);
});

test('preflight dispatches concrete feature overview questions without asking for troubleshooting details', () => {
  const current = caseSession({
    messages: [
      { id: 'msg_feature', role: 'user', body: 'AI伴学助手有哪些功能？', createdAt: '2026-06-20T00:00:00Z' },
    ],
  });

  const decision = preflight({ caseSession: current, userMessage: 'AI伴学助手有哪些功能？', agentConfig: agentConfig() });

  assert.equal(decision.action, 'dispatch');
  assert.match(decision.request.userGoal, /AI伴学助手有哪些功能/);
});

test('diagnostic request carries answer goal for request builder and local preflight dispatch', () => {
  const current = caseSession({
    id: 'case_answer_goal',
    userPersona: 'operations',
    messages: [
      { id: 'msg_config', role: 'user', body: '班课在哪配置的', createdAt: '2026-06-20T00:00:00Z' },
    ],
  });
  const config = defaultConfig();

  const request = buildDiagnosticRequest({
    caseSession: current,
    userMessage: '班课在哪配置的',
    unknowns: [],
    config,
  });

  assert.equal(request.answerGoal.rawUserQuestion, '班课在哪配置的');
  assert.equal(request.answerGoal.resolvedQuestion, '班课在哪配置的');
  assert.deepEqual(request.answerGoal.mustAnswerItems, ['direct_answer']);
  assert.ok(request.constraints.some((item) => item.includes('DiagnosticRequest.answerGoal')));

  const decision = preflight({ caseSession: current, userMessage: '班课在哪配置的', agentConfig: agentConfig() });
  assert.equal(decision.action, 'dispatch');
  assert.equal(decision.request.answerGoal.rawUserQuestion, '班课在哪配置的');
  assert.equal(decision.request.answerGoal.resolvedQuestion, '班课在哪配置的');
  assert.ok(decision.request.constraints.some((item) => item.includes('DiagnosticRequest.answerGoal')));
});

test('experience keeps matching historical workspace evidence in rejected context until current-source revalidation exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-experience-binding-'));
  try {
    const store = new FileMemoryStore(root);
    const source = store.createCase({ tenantId: 'tenant_a', userId: 'user_a', workspaceId: 'current', title: 'source' });
    const firstUser = store.addMessage(source, { role: 'user', body: '课程发布后学员为什么看不到入口？' });
    store.addMessage(source, { role: 'helper', body: '第一条已验证回复', replyToMessageId: firstUser.id });
    store.addRun(source, {
      id: 'run_first', caseId: source.id, status: 'concluded',
      request: { caseId: source.id, runId: 'run_first', workspaceId: 'current', claudeSessionId: source.claudeSessionId, answerGoal: answerGoal(firstUser.body), userGoal: firstUser.body, knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: [] },
      result: {
        status: 'concluded', summary: '第一条', missingInfo: [],
        evidence: [{ id: 'ev_first', kind: 'workspace', source: 'first.ts', summary: '第一条证据', confidence: 'high', validation: { status: 'active', visibility: 'internal', lastVerifiedAt: new Date().toISOString(), quality: 'ok' } }],
        claims: [{ type: 'fact', role: 'primary_answer', text: '第一条事实', evidenceIds: ['ev_first'], answers: ['direct_answer'] }], recommendedNextAction: 'final_answer',
      },
    });
    const secondUser = store.addMessage(source, { role: 'user', body: '完全不同的账单问题是什么？' });
    store.addMessage(source, { role: 'helper', body: '第二条回复', replyToMessageId: secondUser.id });
    store.addRun(source, {
      id: 'run_latest', caseId: source.id, status: 'concluded',
      request: { caseId: source.id, runId: 'run_latest', workspaceId: 'current', claudeSessionId: source.claudeSessionId, answerGoal: answerGoal(secondUser.body), userGoal: secondUser.body, knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: [] },
      result: {
        status: 'concluded', summary: '第二条', missingInfo: [],
        evidence: [{ id: 'ev_latest', kind: 'workspace', source: 'latest.ts', summary: '错误的最新证据', confidence: 'high', validation: { status: 'active', visibility: 'internal', lastVerifiedAt: new Date().toISOString(), quality: 'ok' } }],
        claims: [{ type: 'fact', role: 'primary_answer', text: '第二条事实', evidenceIds: ['ev_latest'], answers: ['direct_answer'] }], recommendedNextAction: 'final_answer',
      },
    });
    source.status = 'concluded';
    store.saveCase(source);

    const current = { ...caseSession(), createdAt: '', updatedAt: '' };
    const match = findExperienceMatch({
      store,
      currentCase: current,
      userMessage: firstUser.body,
    });
    assert.equal(match, undefined);
    const rejected = findRejectedExperienceCandidates({
      store,
      currentCase: current,
      userMessage: firstUser.body,
    });
    assert.equal(rejected[0].sourceRunId, 'run_first');
    assert.equal(rejected[0].rejectionReason, 'answer_goal_unavailable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('experience records stale or invisible same-scope history as rejected context', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-experience-freshness-'));
  try {
    const store = new FileMemoryStore(root);
    const source = store.createCase({ tenantId: 'tenant_a', userId: 'user_a', workspaceId: 'current', title: 'stale source' });
    const user = store.addMessage(source, { role: 'user', body: '课程发布后学员为什么看不到入口？' });
    store.addMessage(source, { role: 'helper', body: '历史回复', replyToMessageId: user.id });
    store.addRun(source, {
      id: 'run_stale', caseId: source.id, status: 'concluded',
      request: { caseId: source.id, runId: 'run_stale', workspaceId: 'current', claudeSessionId: source.claudeSessionId, answerGoal: answerGoal(user.body), userGoal: user.body, knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: [] },
      result: {
        status: 'concluded', summary: '历史结论', missingInfo: [],
        evidence: [{ id: 'ev_stale', kind: 'knowledge', source: 'faq.md', summary: '旧知识', confidence: 'high', validation: { status: 'active', visibility: 'internal', lastVerifiedAt: '2020-01-01T00:00:00Z', quality: 'ok' } }],
        claims: [{ type: 'fact', role: 'primary_answer', text: '历史事实', evidenceIds: ['ev_stale'], answers: ['direct_answer'] }], recommendedNextAction: 'final_answer',
      },
    });
    source.status = 'concluded';
    store.saveCase(source);
    const current = { ...caseSession(), createdAt: '', updatedAt: '' };

    assert.equal(findExperienceMatch({ store, currentCase: current, userMessage: user.body }), undefined);
    const rejected = findRejectedExperienceCandidates({ store, currentCase: current, userMessage: user.body });
    assert.equal(rejected[0].sourceRunId, 'run_stale');
    assert.equal(rejected[0].rejectionReason, 'answer_goal_unavailable');

    source.runs[0].result.evidence[0].validation.lastVerifiedAt = new Date().toISOString();
    store.saveCase(source);
    assert.equal(findExperienceMatch({ store, currentCase: current, userMessage: user.body }), undefined);
    assert.equal(
      findRejectedExperienceCandidates({ store, currentCase: current, userMessage: user.body })[0].rejectionReason,
      'answer_goal_unavailable',
    );
    assert.equal(findExperienceMatch({ store, currentCase: { ...current, userPersona: 'customer' }, userMessage: user.body }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('experience matching is isolated by tenant and user', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-experience-isolation-'));
  try {
    const store = new FileMemoryStore(root);
    const source = store.createCase({ tenantId: 'tenant_b', userId: 'user_b', workspaceId: 'current', title: 'other scope' });
    const user = store.addMessage(source, { role: 'user', body: '课程发布后学员为什么看不到入口？' });
    store.addMessage(source, { role: 'helper', body: '跨租户回复', replyToMessageId: user.id });
    store.addRun(source, {
      id: 'run_other', caseId: source.id, status: 'concluded',
      request: { caseId: source.id, runId: 'run_other', workspaceId: 'current', claudeSessionId: source.claudeSessionId, answerGoal: answerGoal(user.body), userGoal: user.body, knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: [] },
      result: { status: 'concluded', summary: 'other', missingInfo: [], evidence: [{ id: 'ev_other', kind: 'workspace', source: 'other', summary: 'other', confidence: 'high' }], claims: [{ type: 'fact', role: 'primary_answer', text: 'other', evidenceIds: ['ev_other'], answers: ['direct_answer'] }], recommendedNextAction: 'final_answer' },
    });
    source.status = 'concluded';
    store.saveCase(source);
    const match = findExperienceMatch({ store, currentCase: { ...caseSession(), createdAt: '', updatedAt: '' }, userMessage: user.body });
    assert.equal(match, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('experience match is rejected when historical answer misses current answer goal requirements', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-experience-contract-'));
  try {
    const store = new FileMemoryStore(root);
    const prior = store.createCase({
      tenantId: 'tenant_a',
      userId: 'user_a',
      workspaceId: 'current',
      title: '历史班课配置',
    });
    const priorUser = store.addMessage(prior, { role: 'user', body: '班课在哪配置的' });
    store.addMessage(prior, {
      role: 'helper',
      body: '班课在后台管理中配置。',
      replyToMessageId: priorUser.id,
    });
    store.addRun(prior, {
      id: 'run_entry_only',
      caseId: prior.id,
      status: 'concluded',
      request: {
        caseId: prior.id,
        runId: 'run_entry_only',
        workspaceId: prior.workspaceId,
        claudeSessionId: prior.claudeSessionId,
        answerGoal: answerGoal(priorUser.body, ['entry_path']),
        userGoal: priorUser.body,
        knownFacts: [],
        unknowns: [],
        constraints: [],
        allowedMcpToolIds: [],
        context: {
          isFollowUp: false,
          currentUserMessage: priorUser.body,
          recentMessages: [],
          previousRuns: [],
          resolvedTurn: {
            latestUserMessage: priorUser.body,
            resolvedQuery: priorUser.body,
            sourceMessageIds: [priorUser.id],
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
        summary: '历史答案只覆盖班课配置入口。',
        missingInfo: [],
        evidence: [{
          id: 'ev_entry',
          kind: 'workspace',
          source: 'menus.yml',
          summary: '班课在后台管理中配置。',
          confidence: 'high',
          validation: { status: 'active', visibility: 'internal', lastVerifiedAt: new Date().toISOString(), quality: 'ok' },
        }],
        claims: [{ id: 'claim_entry', type: 'fact', role: 'primary_answer', text: '班课在后台管理中配置。', evidenceIds: ['ev_entry'], answers: ['entry_path'] }],
        recommendedNextAction: 'final_answer',
      },
    });
    prior.status = 'concluded';
    store.saveCase(prior);
    const current = caseSession({ createdAt: '', updatedAt: '' });
    const goal = answerGoal('班课在哪配置的', ['entry_path', 'permission_or_role']);

    const match = findExperienceMatch({
      store,
      currentCase: current,
      userMessage: '班课在哪配置的',
      answerGoal: goal,
    });

    assert.equal(match, undefined);
    const rejected = findRejectedExperienceCandidates({
      store,
      currentCase: current,
      userMessage: '班课在哪配置的',
      answerGoal: goal,
    });
    assert.equal(rejected[0].rejectionReason, 'answer_goal_not_exact');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('presentation cannot promote partial outcome or render nonexistent evidence claims', () => {
  const partial = {
    status: 'partial', summary: '尚未确认', missingInfo: ['日志'], evidence: [],
    claims: [{ type: 'fact', text: '不存在证据的事实', evidenceIds: ['ev_missing'] }],
    recommendedNextAction: 'ask_user',
  };
  assert.equal(decisionFromReviewOutcome('final_answer', partial), 'ask_user');
  const reply = ruleBasedReviewAndFormat(partial, 'operations');
  assert.doesNotMatch(reply, /不存在证据的事实/);
});

test('operations presentation answers feature overview without forced bug classification', () => {
  const result = {
    status: 'concluded',
    summary: 'AI伴学助手支持学习计划制定、督学提醒、学习问答、题目答疑和知识点诊断。',
    missingInfo: [],
    evidence: [
      {
        id: 'ev_feature_overview',
        kind: 'knowledge',
        source: 'knowledge/faq/ai-companion/feature-overview.md',
        summary: 'AI伴学助手功能清单',
        confidence: 'high',
      },
    ],
    claims: [
      { id: 'claim_plan', type: 'fact', role: 'primary_answer', text: '支持学习计划制定。', evidenceIds: ['ev_feature_overview'], answers: ['direct_answer'] },
      { id: 'claim_reminder', type: 'fact', role: 'primary_answer', text: '支持督学提醒。', evidenceIds: ['ev_feature_overview'], answers: ['direct_answer'] },
      { id: 'claim_qa', type: 'fact', role: 'primary_answer', text: '支持学习问答和题目答疑。', evidenceIds: ['ev_feature_overview'], answers: ['direct_answer'] },
    ],
    recommendedNextAction: 'final_answer',
  };

  const reply = ruleBasedReviewAndFormat(result, 'operations', 'AI伴学助手有哪些功能');

  assert.match(reply, /功能包括|支持/);
  assert.match(reply, /学习计划制定/);
  assert.match(reply, /督学提醒/);
  assert.doesNotMatch(reply, /系统 bug|配置或使用问题|目前不能确认归类/);
});

test('feature overview presentation stays answer-first for support customer and developer personas', () => {
  const result = {
    status: 'concluded',
    summary: 'AI伴学助手支持学习计划制定、督学提醒、学习问答、题目答疑和知识点诊断。',
    missingInfo: [],
    evidence: [
      {
        id: 'ev_feature_overview',
        kind: 'knowledge',
        source: 'knowledge/faq/ai-companion/feature-overview.md source=knowledge/_sources/manual/feature.md',
        summary: 'AI伴学助手功能清单',
        confidence: 'high',
      },
    ],
    claims: [
      { id: 'claim_plan', type: 'fact', role: 'primary_answer', text: '支持学习计划制定。', evidenceIds: ['ev_feature_overview'], answers: ['direct_answer'] },
      { id: 'claim_reminder', type: 'fact', role: 'primary_answer', text: '支持督学提醒。', evidenceIds: ['ev_feature_overview'], answers: ['direct_answer'] },
      { id: 'claim_qa', type: 'fact', role: 'primary_answer', text: '支持学习问答和题目答疑。', evidenceIds: ['ev_feature_overview'], answers: ['direct_answer'] },
      { id: 'claim_diagnosis', type: 'fact', role: 'primary_answer', text: '支持知识点诊断。', evidenceIds: ['ev_feature_overview'], answers: ['direct_answer'] },
    ],
    recommendedNextAction: 'final_answer',
  };

  for (const persona of ['support', 'customer', 'developer']) {
    const reply = ruleBasedReviewAndFormat(result, persona, 'AI伴学助手有哪些功能');

    assert.match(reply, /功能|能力|支持/);
    assert.match(reply, /学习计划制定/);
    assert.match(reply, /督学提醒/);
    assert.match(reply, /学习问答/);
    assert.match(reply, /题目答疑/);
    assert.match(reply, /知识点诊断/);
    assert.doesNotMatch(reply, /系统 bug|设计使然|配置或使用问题|目前不能确认归类/);
    assert.doesNotMatch(reply, /caseId|runId|src\/|knowledge\/_sources|knowledge\/faq/);
    assert.doesNotMatch(reply, /下一步排查/);
  }
});

test('presentation combines reviewed partial RAG context and worker conclusion without fixed template drift', () => {
  const userGoal = '学员统计缺少6月份如何补上，有没有现成命令行处理';
  const result = {
    status: 'concluded',
    summary: '知识库确认统计生成背景，代码确认存在按月份补齐统计的命令。',
    missingInfo: [],
    evidence: [
      { id: 'ev_rag_1', kind: 'knowledge', source: 'knowledge/faq/stat.md', summary: '学员统计由定时任务生成。', confidence: 'high' },
      { id: 'ev_cmd_1', kind: 'workspace', source: 'src/Command/RefreshStudentStatisticsCommand.php', summary: '命令支持按月份刷新统计。', confidence: 'high' },
    ],
    claims: [
      { id: 'claim_rag_1', type: 'fact', role: 'supporting_context', text: '学员统计由定时任务生成。', evidenceIds: ['ev_rag_1'], answers: [] },
      { id: 'claim_cmd_1', type: 'fact', role: 'primary_answer', text: '可以通过统计刷新命令按月份补齐学员统计。', evidenceIds: ['ev_cmd_1'], answers: ['direct_answer'] },
    ],
    recommendedNextAction: 'final_answer',
  };
  const reply = ruleBasedReviewAndFormat(result, 'operations', userGoal, {
    answerGoal: answerGoal(userGoal),
    ragAnswerability: {
      answerability: 'partial',
      selectedEvidenceIds: ['ev_rag_1'],
      coveredClaims: [{
        id: 'rag_claim_1',
        text: '学员统计由定时任务生成。',
        evidenceIds: ['ev_rag_1'],
        coveredRequirementIds: ['generation_source'],
        usefulness: '补数背景',
      }],
      missingElements: ['现成命令名称', '月份参数'],
      shouldEscalate: true,
      escalationFocus: '查找统计补数命令和月份参数',
      reason: '知识库只覆盖生成背景。',
    },
  });

  assert.match(reply, /定时任务/);
  assert.match(reply, /命令|按月份/);
  assert.doesNotMatch(reply, /设计使然/);
  assert.doesNotMatch(reply, /对业务的影响：[\s\S]*你可以怎么处理：/);
});

test('case_a52adc7f class lesson overview answers definition and capabilities', () => {
  const userGoal = '班课是什么，有什么功能';
  const result = {
    status: 'concluded',
    summary: '知识库可回答班课定义和功能。',
    missingInfo: [],
    evidence: [
      { id: 'ev_definition', kind: 'knowledge', source: 'knowledge/whitepapers/edusoho-training/class-definition.md', summary: '班课定义。', confidence: 'high' },
      { id: 'ev_product_library', kind: 'knowledge', source: 'knowledge/whitepapers/edusoho-training/product-library.md', summary: '产品库说明。', confidence: 'high' },
      { id: 'ev_class_management', kind: 'knowledge', source: 'knowledge/whitepapers/edusoho-training/class-management.md', summary: '班课管理说明。', confidence: 'high' },
    ],
    claims: [
      { id: 'claim_definition', type: 'fact', role: 'primary_answer', text: '班课是以班级形式按照特定时间安排所进行的课程。', evidenceIds: ['ev_definition'], answers: ['direct_answer'] },
      { id: 'claim_product_library', type: 'fact', role: 'primary_answer', text: '产品库用于管理相同课程内容的不同班课，并查看产品经营状况。', evidenceIds: ['ev_product_library'], answers: ['direct_answer'] },
      { id: 'claim_class_management', type: 'fact', role: 'primary_answer', text: '班课管理支持日常维护管理和班课巡检。', evidenceIds: ['ev_class_management'], answers: ['direct_answer'] },
    ],
    recommendedNextAction: 'final_answer',
  };

  const reply = ruleBasedReviewAndFormat(result, 'operations', userGoal);

  assert.match(reply, /班课.*(是|课程)/);
  assert.match(reply, /产品库|经营状况/);
  assert.match(reply, /班课管理|班课巡检/);
  assert.doesNotMatch(reply, /设计使然/);
  assert.doesNotMatch(reply, /对业务的影响：[\s\S]*你可以怎么处理：/);
});

test('case_73f80bc4 class lesson config preserves entry permission and configurable items', () => {
  const userGoal = '班课在哪配置的';
  const result = {
    status: 'concluded',
    summary: '班课配置入口位于后台管理 → 教务 → 参数设置。',
    missingInfo: [],
    evidence: [
      { id: 'ev_entry', kind: 'workspace', source: 'menus_admin_v2.yml', summary: '菜单路径：后台管理 → 教务 → 参数设置。', confidence: 'high' },
      { id: 'ev_route', kind: 'workspace', source: 'routing_admin_v2.yml', summary: '路由和权限。', confidence: 'high' },
      { id: 'ev_items', kind: 'workspace', source: 'menu.zh_CN.yml', summary: '班课配置项。', confidence: 'high' },
    ],
    claims: [
      { id: 'claim_entry', type: 'fact', role: 'primary_answer', text: '班课配置入口是后台管理 → 教务 → 参数设置。', evidenceIds: ['ev_entry'], answers: ['direct_answer'] },
      { id: 'claim_route', type: 'fact', role: 'primary_answer', text: '该入口对应路由 /multi_class/setting，权限节点是 admin_v2_multi_class_setting_manage。', evidenceIds: ['ev_route'], answers: ['direct_answer'] },
      { id: 'claim_items', type: 'fact', role: 'primary_answer', text: '可配置项包括基本信息、价格、封面、服务、班主任、教师、助教、课程管理、学员管理等。', evidenceIds: ['ev_items'], answers: ['direct_answer'] },
    ],
    recommendedNextAction: 'final_answer',
  };

  const reply = ruleBasedReviewAndFormat(result, 'operations', userGoal);

  assert.match(reply, /后台管理\s*→\s*教务\s*→\s*参数设置/);
  assert.match(reply, /路由|权限/);
  assert.match(reply, /基本信息|价格|封面|服务|班主任|教师|助教|课程管理|学员管理/);
  assert.doesNotMatch(reply, /配置或使用问题/);
  assert.doesNotMatch(reply, /对业务的影响：[\s\S]*你可以怎么处理：/);
});

test('case_4e905fbc statistics backfill preserves partial RAG context and command conclusion', () => {
  const userGoal = '学员管理的学员数据统计里面缺少6月份的数据，已经确认是定时任务没执行的问题，现在已经解决了定时任务。如何补上这个数据统计。有没有现成的命令行处理';
  const result = {
    status: 'concluded',
    summary: '知识库确认统计生成背景，代码确认存在补齐指定月份统计的命令。',
    missingInfo: [],
    evidence: [
      { id: 'ev_rag_1', kind: 'knowledge', source: 'knowledge/whitepapers/edusoho-training/student-statistics.md', summary: '学员数据统计由定时任务生成。', confidence: 'high' },
      { id: 'ev_cmd_1', kind: 'workspace', source: 'src/Command/RefreshStudentStatisticsCommand.php', summary: '命令支持指定月份刷新统计。', confidence: 'high' },
    ],
    claims: [
      { id: 'claim_rag_1', type: 'fact', role: 'supporting_context', text: '学员数据统计由定时任务生成。', evidenceIds: ['ev_rag_1'], answers: [] },
      { id: 'claim_cmd_1', type: 'fact', role: 'primary_answer', text: '可以通过统计刷新命令补齐指定月份的学员统计。', evidenceIds: ['ev_cmd_1'], answers: ['direct_answer'] },
    ],
    recommendedNextAction: 'final_answer',
  };

  const reply = ruleBasedReviewAndFormat(result, 'operations', userGoal);

  assert.match(reply, /6月|月份|指定月份/);
  assert.match(reply, /命令|补齐|统计刷新/);
  assert.doesNotMatch(reply, /知识库命中.*可回答/);
  assert.doesNotMatch(reply, /设计使然/);
});

test('customer presentation preserves reviewed cause without adding a keyword-template rewrite', () => {
  const result = {
    status: 'concluded',
    summary: 'AI伴学助手生成学习计划时报 500，是因为生成逻辑读取 studyPlanConfig.frequency 前没有处理空配置，触发 TypeError。',
    missingInfo: [],
    evidence: [
      {
        id: 'ev_code_null_config',
        kind: 'workspace',
        source: 'src/services/ai-companion/plan-generator.ts',
        summary: 'generatePlan 在读取 studyPlanConfig.frequency 前没有判空；课程未配置学习计划规则时会触发 TypeError。',
        confidence: 'high',
      },
    ],
    claims: [
      { id: 'claim_null_config', type: 'fact', role: 'supporting_context', text: '生成学习计划接口在读取 studyPlanConfig.frequency 前没有判空。', evidenceIds: ['ev_code_null_config'], answers: [] },
      { id: 'claim_500_reason', type: 'inference', role: 'primary_answer', text: '当课程未配置学习计划规则时，这个空配置会触发 TypeError 并导致 500。', evidenceIds: ['ev_code_null_config'], answers: ['direct_answer'] },
    ],
    recommendedNextAction: 'final_answer',
  };

  const reply = ruleBasedReviewAndFormat(result, 'customer', 'AI伴学助手生成学习计划时报 500');

  assert.match(reply, /学习计划/);
  assert.match(reply, /500/);
  assert.doesNotMatch(reply, /src\/|knowledge\/_sources/);
});

test('model presentation reply is used and preserves multiple reviewed claims', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-model-presentation-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    const system = request.messages[0].content;
    if (system.includes('Evidence Coverage Agent')) {
      return chatResponse(JSON.stringify({
        status: 'accepted',
        bindings: [
          { claimId: 'claim_1', answerItemIds: ['direct_answer'], evidenceIds: ['ev_01', 'ev_02', 'ev_03'] },
          { claimId: 'claim_3', answerItemIds: ['direct_answer'], evidenceIds: ['ev_05'] },
        ],
        fullQuestion: 'full',
        fullQuestionClaimIds: ['claim_1', 'claim_3'],
        missingElements: [],
      }));
    }
    if (system.includes('Visible Prompt Safety Agent')) {
      return chatResponse(JSON.stringify({ status: 'accepted', acceptedIds: [] }));
    }
    return chatResponse(JSON.stringify({
      claimIds: ['claim_1', 'claim_3'],
      evidenceIds: ['ev_01', 'ev_02', 'ev_03', 'ev_05'],
      directAnswerClaimIds: ['claim_1', 'claim_3'],
      actionClaimIds: [],
    }));
  };
  try {
    const worker = {
      async diagnose() {
        const result = {
            status: 'concluded',
            summary: '班课配置入口位于后台管理：教务 → 参数设置。',
            missingInfo: [],
            evidence: [
              { id: 'ev_01', kind: 'workspace', source: 'src/AppBundle/Resources/config/menus_admin_v2.yml', summary: '菜单路径：教务 > 参数设置。', confidence: 'high' },
              { id: 'ev_02', kind: 'workspace', source: 'src/AppBundle/Resources/config/routing_admin_v2.yml:103-108', summary: '路径 /multi_class/setting，权限 admin_v2_multi_class_setting_manage。', confidence: 'high' },
              { id: 'ev_03', kind: 'workspace', source: 'app/Resources/translations/menu.zh_CN.yml:468', summary: '中文菜单名：参数设置。', confidence: 'high' },
              { id: 'ev_04', kind: 'workspace', source: 'src/Biz/System/SettingModule/ClassroomSetting.php', summary: '班课配置由 ClassroomSetting 类处理。', confidence: 'medium' },
              { id: 'ev_05', kind: 'workspace', source: 'app/Resources/translations/menu.zh_CN.yml:390-437', summary: '教师端班课设置包括基本信息、价格、封面、服务、班主任、教师、助教、课程管理、学员管理等。', confidence: 'medium' },
            ],
            claims: [
              { id: 'claim_1', type: 'fact', role: 'primary_answer', text: '班课配置入口：后台管理 → 教务 → 参数设置（路由 /multi_class/setting，权限 admin_v2_multi_class_setting_manage）', evidenceIds: ['ev_01', 'ev_02', 'ev_03'], answers: ['direct_answer'] },
              { id: 'claim_2', type: 'fact', role: 'supporting_context', text: '班课业务配置由 ClassroomSetting 类处理，继承自 AbstractSetting', evidenceIds: ['ev_04'], answers: [] },
              { id: 'claim_3', type: 'fact', role: 'primary_answer', text: '教师端班课设置包括：基本信息、价格、封面、服务、班主任、教师、助教、课程管理、学员管理等', evidenceIds: ['ev_05'], answers: ['direct_answer'] },
            ],
            recommendedNextAction: 'final_answer',
          };
        return {
          result,
          trace: { command: 'claude -p', cwd: process.cwd(), stdout: '{"result":"ok"}', stderr: '', exitCode: 0 },
          coverageEvidence: result.evidence.map((item) => ({
            evidenceId: item.id,
            kind: 'workspace',
            safeText: item.summary,
            runId: 'run_01',
            validated: true,
          })),
        };
      },
    };
    const agent = new DiagnosticRuntime(modelConfig(root), new FileMemoryStore(root), worker);
    const response = await agent.handleUserMessage({ persona: 'operations', message: '班课在哪配置的' });

    assert.match(response.assistantMessage, /后台管理 → 教务 → 参数设置/);
    assert.match(response.assistantMessage, /\/multi_class\/setting/);
    assert.match(response.assistantMessage, /admin_v2_multi_class_setting_manage/);
    assert.match(response.assistantMessage, /基本信息、价格、封面、服务、班主任、教师、助教、课程管理、学员管理/);
    assert.doesNotMatch(response.assistantMessage, /配置或使用问题|对业务的影响|你可以怎么处理/);
    const parsed = response.caseSession.logs.find((event) => event.phase === 'model_review_result')?.detail?.parsed;
    assert.equal(parsed.accepted, true);
    assert.deepEqual(parsed.directAnswerClaimIds, ['claim_1', 'claim_3']);
    assert.equal(Object.hasOwn(parsed, 'reply'), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('unsafe model presentation reply falls back to reviewed local formatting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-model-presentation-safe-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => chatResponse(JSON.stringify({
    answerTarget: '班课在哪配置的',
    directAnswer: '班课配置入口在后台教务参数设置。',
    reply: '请查看 src/private.ts，并把 caseId/runId 发给用户。',
    claimIds: ['claim_1'],
    evidenceIds: ['ev_01'],
    directAnswerClaimIds: ['claim_1'],
  }));
  try {
    const worker = {
      async diagnose() {
        return {
          result: {
            status: 'concluded',
            summary: '已找到配置入口。',
            missingInfo: [],
            evidence: [{ id: 'ev_01', kind: 'workspace', source: 'src/private.ts', summary: '配置入口证据。', confidence: 'high' }],
            claims: [{ id: 'claim_1', type: 'fact', role: 'primary_answer', text: '班课配置入口在后台教务参数设置。', evidenceIds: ['ev_01'], answers: ['direct_answer'] }],
            recommendedNextAction: 'final_answer',
          },
          trace: { command: 'claude -p', cwd: process.cwd(), stdout: '{"result":"ok"}', stderr: '', exitCode: 0 },
        };
      },
    };
    const agent = new DiagnosticRuntime(modelConfig(root), new FileMemoryStore(root), worker);
    const response = await agent.handleUserMessage({ persona: 'operations', message: '班课在哪配置的' });

    assert.match(response.assistantMessage, /班课配置入口在后台教务参数设置/);
    assert.doesNotMatch(response.assistantMessage, /src\/private|caseId|runId/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('model presentation reply must preserve every selected claim signal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-model-presentation-complete-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => chatResponse(JSON.stringify({
    answerTarget: '班课在哪配置的',
    directAnswer: '班课配置入口在后台教务参数设置。',
    reply: '班课配置入口在后台教务参数设置。',
    claimIds: ['claim_1', 'claim_2'],
    evidenceIds: ['ev_01', 'ev_02'],
    directAnswerClaimIds: ['claim_1', 'claim_2'],
  }));
  try {
    const worker = {
      async diagnose() {
        return {
          result: {
            status: 'concluded',
            summary: '已找到班课配置入口和可配置项。',
            missingInfo: [],
            evidence: [
              { id: 'ev_01', kind: 'workspace', source: 'menus_admin_v2.yml', summary: '班课配置入口在后台教务参数设置。', confidence: 'high' },
              { id: 'ev_02', kind: 'workspace', source: 'menu.zh_CN.yml', summary: '可配置基本信息、价格、封面、服务、班主任、教师、助教、课程管理、学员管理。', confidence: 'high' },
            ],
            claims: [
              { id: 'claim_1', type: 'fact', role: 'primary_answer', text: '班课配置入口在后台教务参数设置。', evidenceIds: ['ev_01'], answers: ['direct_answer'] },
              { id: 'claim_2', type: 'fact', role: 'primary_answer', text: '可配置项包括基本信息、价格、封面、服务、班主任、教师、助教、课程管理、学员管理。', evidenceIds: ['ev_02'], answers: ['direct_answer'] },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: { command: 'claude -p', cwd: process.cwd(), stdout: '{"result":"ok"}', stderr: '', exitCode: 0 },
        };
      },
    };
    const agent = new DiagnosticRuntime(modelConfig(root), new FileMemoryStore(root), worker);
    const response = await agent.handleUserMessage({ persona: 'operations', message: '班课在哪配置的' });

    assert.match(response.assistantMessage, /后台教务参数设置/);
    assert.match(response.assistantMessage, /基本信息、价格、封面、服务、班主任、教师、助教、课程管理、学员管理/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime ignores a model attempt to promote a frozen partial result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-review-freeze-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ outcome: 'final_answer', reply: '模型虚构的最终结论' }) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge');
    config.agent.modelProvider = 'test';
    config.models.providers.test = {
      type: 'openai-compatible', baseUrl: 'https://api.example.test/v1', apiKey: 'test-key', model: 'test-model', temperature: 0,
    };
    const worker = {
      async diagnose() {
        return {
          result: {
            status: 'partial', summary: 'worker 未确认', missingInfo: ['服务日志'],
            evidence: [{ id: 'ev_partial', kind: 'workspace', source: 'src/router.ts', summary: '只定位到入口', confidence: 'medium' }],
            claims: [{ type: 'inference', role: 'supporting_context', text: '目前只能确认请求经过该入口。', evidenceIds: ['ev_partial'], answers: [] }],
            recommendedNextAction: 'ask_user',
          },
          trace: { command: 'claude -p', cwd: process.cwd(), stdout: '{"result":"partial"}', stderr: '', exitCode: 0 },
        };
      },
    };
    const agent = new DiagnosticRuntime(config, new FileMemoryStore(root), worker);
    const response = await agent.handleUserMessage({ message: '课程保存接口返回 500，请定位原因。' });
    assert.equal(response.decision, 'partial');
    assert.match(response.assistantMessage, /目前只能确认请求经过该入口/);
    assert.doesNotMatch(response.assistantMessage, /模型虚构的最终结论/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('deterministic validation rejects duplicate, missing, and low-confidence fact evidence', () => {
  const validation = validateDiagnosticResult({
    status: 'concluded',
    summary: '不应直接形成结论',
    missingInfo: [],
    evidence: [
      { id: 'ev_low', kind: 'workspace', source: 'a.ts', summary: '弱证据', confidence: 'low' },
      { id: 'ev_low', kind: 'workspace', source: 'b.ts', summary: '重复 ID', confidence: 'high' },
      { id: 'ev_unknown', kind: 'unknown', source: 'unknown', summary: '未知来源', confidence: 'high' },
    ],
    claims: [
      { id: 'claim_low', type: 'fact', role: 'primary_answer', text: '低置信度事实', evidenceIds: ['ev_low'], answers: ['direct_answer'] },
      { id: 'claim_missing', type: 'fact', role: 'primary_answer', text: '不存在证据', evidenceIds: ['ev_missing'], answers: ['direct_answer'] },
      { id: 'claim_unknown', type: 'fact', role: 'primary_answer', text: '未知来源事实', evidenceIds: ['ev_unknown'], answers: ['direct_answer'] },
      { id: 'claim_invalid', type: 'invented', role: 'unknown', text: '非法类型', evidenceIds: ['ev_unknown'], answers: [] },
    ],
    recommendedNextAction: 'final_answer',
  });
  assert.equal(validation.result.status, 'partial');
  assert.equal(validation.result.recommendedNextAction, 'continue_diagnosis');
  assert.deepEqual(validation.acceptedClaimIds, []);
  assert.equal(validation.issues.some((issue) => issue.code === 'duplicate_evidence_id'), true);
  assert.equal(validation.issues.some((issue) => issue.code === 'missing_evidence_reference'), true);
  assert.equal(validation.issues.some((issue) => issue.code === 'low_confidence_fact'), true);
  assert.equal(validation.issues.some((issue) => issue.code === 'invalid_claim_type'), true);
});

test('worker failure fallback never copies raw stdout stderr or secrets into main reply', () => {
  const result = {
    status: 'partial', summary: 'worker failed', missingInfo: [], evidence: [], claims: [], recommendedNextAction: 'escalate_to_human',
  };
  const reply = formatSafeWorkerFailure({
    category: 'worker_execution_failed',
    status: result.status,
    nextAction: result.recommendedNextAction,
  });
  assert.match(reply, /诊断未完成|工具调用失败/);
  assert.doesNotMatch(reply, /raw stdout|Authorization|sk-secret|token-secret|\/private\/workspace|stack internal/);
});

test('worker trace logging is bounded and redacts contextual secrets', () => {
  const safe = sanitizeWorkerTrace({
    command: `claude --api-key custom-secret-value ${'x'.repeat(3000)}`,
    cwd: '/private/workspace',
    stdout: `Authorization: Bearer bearer-secret\npassword=plain-secret\n${'x'.repeat(9000)}`,
    stderr: 'cookie=session-secret',
    error: 'token=provider-secret',
    exitCode: 1,
    startedAt: '',
    finishedAt: '',
  });
  assert.doesNotMatch(JSON.stringify(safe), /custom-secret-value|bearer-secret|plain-secret|session-secret|provider-secret/);
  assert.match(JSON.stringify(safe), /REDACTED/);
  assert.ok(safe.command.length <= 2000);
  assert.ok(safe.stdout.length <= 8000);
});

test('read-only safety is enforced by structured runtime constraints without matching write-request keywords', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-experience-safety-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge');
    config.agent.modelProvider = undefined;
    config.agent.useModelForPreflight = false;
    const store = new FileMemoryStore(root);
    const source = store.createCase({ tenantId: 'local', userId: 'local-user', workspaceId: 'current', title: '历史写请求' });
    const user = store.addMessage(source, { role: 'user', body: '请直接删除生产课程数据' });
    store.addMessage(source, { role: 'helper', body: '历史写操作回复', replyToMessageId: user.id });
    store.addRun(source, {
      id: 'run_write', caseId: source.id, status: 'concluded',
      request: { caseId: source.id, runId: 'run_write', workspaceId: 'current', claudeSessionId: source.claudeSessionId, userGoal: user.body, knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: [] },
      result: {
        status: 'concluded', summary: '历史写操作', missingInfo: [],
        evidence: [{ id: 'ev_write', kind: 'workspace', source: 'admin.ts', summary: '写操作入口', confidence: 'high', validation: { status: 'active', visibility: 'internal', lastVerifiedAt: new Date().toISOString(), quality: 'ok' } }],
        claims: [{ type: 'fact', text: '存在写操作入口', evidenceIds: ['ev_write'] }], recommendedNextAction: 'final_answer',
      },
    });
    source.status = 'concluded';
    store.saveCase(source);
    const requests = [];
    const worker = {
      async diagnose(request) {
        requests.push(request);
        return {
          result: {
            status: 'partial',
            summary: '只能进行只读检查。',
            missingInfo: [],
            evidence: [],
            claims: [],
            recommendedNextAction: 'continue_diagnosis',
          },
          trace: { command: 'readonly', cwd: root, stdout: '', stderr: '', exitCode: 0, startedAt: '', finishedAt: '' },
        };
      },
    };
    const agent = new DiagnosticRuntime(config, store, worker);
    const response = await agent.handleUserMessage({ message: user.body });

    assert.equal(requests.length > 0, true);
    assert.equal(requests.every((request) => (
      request.constraints.some((item) => /read-only permission boundary/i.test(item))
    )), true);
    assert.notEqual(response.decision, 'final');
    assert.doesNotMatch(
      readFileSync(new URL('../src/runtime/preflight-decision.ts', import.meta.url), 'utf8'),
      /如何\|怎么|删除\|清空|writeAction|requiresPermissionEscalation/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync first turn and async unknown follow-up share one resolved query across runtime stages', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-resolved-runtime-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge');
    config.agent.modelProvider = undefined;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = process.cwd();
    const requests = [];
    const worker = {
      async diagnose(request) {
        requests.push(request);
        return {
          result: {
            status: 'concluded',
            summary: '已完成只读排查。',
            missingInfo: [],
            evidence: [{ id: `ev_${requests.length}`, kind: 'workspace', source: 'src/example.ts', summary: '当前工作区证据。', confidence: 'high' }],
            claims: [{ type: 'fact', text: '当前工作区可继续核验该问题。', evidenceIds: [`ev_${requests.length}`] }],
            recommendedNextAction: 'final_answer',
          },
          trace: { command: 'claude -p', cwd: process.cwd(), stdout: '{"result":"ok"}', stderr: '', exitCode: 0 },
        };
      },
    };
    const agent = new DiagnosticRuntime(config, new FileMemoryStore(root), worker);
    const originalQuestion = '课程发布后学员为什么看不到入口？';
    const first = await agent.handleUserMessage({ message: originalQuestion });
    const accepted = agent.startUserTurn({ caseId: first.caseSession.id, message: '不清楚' });
    const second = await agent.completeUserTurn(accepted.caseSession.id, accepted.userMessageId);

    assert.equal(requests.length, 2);
    assert.equal(requests[1].userGoal, originalQuestion);
    assert.equal(requests[1].context.resolvedTurn.resolvedQuery, originalQuestion);
    assert.equal(requests[1].context.resolvedTurn.latestUserMessage, '不清楚');
    assert.equal(requests[1].unknowns.includes('不清楚'), true);
    assert.equal(second.caseSession.messages.some((message) => message.role === 'user' && message.body === '不清楚'), true);

    const phase = (name) => second.caseSession.logs.find((event) => event.phase === name && event.createdAt >= accepted.caseSession.updatedAt);
    assert.equal(phase('experience_started').detail.message, originalQuestion);
    assert.equal(phase('knowledge_router_started').detail.message, originalQuestion);
    assert.equal(phase('diagnostic_request').detail.userGoal, originalQuestion);
    assert.ok(second.caseSession.logs.findIndex((event) => event.phase === 'preflight_started') < second.caseSession.logs.findIndex((event) => event.phase === 'experience_started'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
