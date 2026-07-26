import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import test from 'node:test';
import { DiagnosticRuntime } from '../dist/runtime/diagnostic-runtime.js';
import { initKnowledgeWorkspace, resolveKnowledgeWorkspaceRoot, updateKnowledgeIndex } from '../dist/knowledge/index.js';
import { NoopModelClient } from '../dist/providers/model/adapter.js';
import { CaseRuntimeEventRecorder } from '../dist/runtime/event-recorder.js';
import { ReviewPresentationService } from '../dist/runtime/review-presentation.js';
import { completePresentedTurn } from '../dist/runtime/turn-completion.js';
import { FileMemoryStore } from '../dist/storage.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function baseConfig(rootDir) {
  return {
    version: 1,
    server: { host: '127.0.0.1', port: 4317 },
    storage: { rootDir, isolateByWorkspace: true },
    knowledge: { rootDir: join(rootDir, 'knowledge-store'), isolateByWorkspace: true },
    agent: {
      name: 'super helper',
      language: 'zh-CN',
      tone: 'calm_professional',
      modelProvider: 'minimax',
      useModelForPreflight: true,
      defaultUserPersona: 'operations',
      contextWindowTokens: 200000,
    },
    models: {
      providers: {
        minimax: {
          type: 'openai-compatible',
          baseUrl: 'https://api.example.test/v1',
          apiKey: 'test-key',
          model: 'MiniMax-M3',
          temperature: 0,
        },
      },
    },
    claude: {
      enabled: true,
      command: 'claude',
      commandWhitelist: ['claude', process.execPath],
      permissionMode: 'dontAsk',
      tools: ['Read', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Glob', 'Grep'],
      disallowedTools: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch'],
      timeoutMs: 1000,
      maxBudgetUsd: 0.2,
      sessionBusyMaxRetries: 0,
      sessionBusyRetryDelayMs: 1,
    },
    workspaces: [{ id: 'current', name: 'Current Project', rootPath: process.cwd(), mcpToolIds: [] }],
    mcpTools: [],
  };
}

function concludedWorkerResult(suffix) {
  return {
    result: {
      status: 'concluded',
      summary: `已确认诊断${suffix ?? ''}。`,
      missingInfo: [],
      evidence: [
        {
          id: `ev_${suffix ?? '1'}`,
          kind: 'workspace',
          source: 'package.json',
          summary: `已确认诊断结论${suffix ?? ''}。`,
          confidence: 'high',
        },
      ],
      claims: [
        {
          id: `claim_${suffix ?? '1'}`,
          type: 'fact',
          role: 'primary_answer',
          text: `已确认问题原因${suffix ?? ''}。`,
          evidenceIds: [`ev_${suffix ?? '1'}`],
          answers: ['direct_answer'],
        },
      ],
      recommendedNextAction: 'final_answer',
    },
    trace: {
      command: 'claude -p --session-id ...',
      cwd: process.cwd(),
      stdout: '{"result":"ok"}',
      stderr: '',
      exitCode: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    },
  };
}

function createAgent(dir, worker) {
  const config = baseConfig(dir);
  config.agent.useModelForPreflight = false;
  config.agent.modelProvider = undefined;
  const store = new FileMemoryStore(dir);
  const agent = new DiagnosticRuntime(config, store, worker);
  return { agent, store, config };
}

test('turn completion persists the formal helper reply before terminal case status', () => {
  const order = [];
  const caseSession = {
    id: 'case_completion',
    status: 'diagnosing',
    messages: [],
  };
  const store = {
    addMessage(session, message) {
      order.push('helper_message');
      session.messages.push({
        ...message,
        id: 'msg_helper',
        createdAt: '2026-07-26T00:00:00.000Z',
      });
    },
    saveCase() {
      order.push('terminal_status');
    },
  };
  const events = {
    presentationPrepared() {
      order.push('presentation_prepared');
    },
    finalReplyCreated() {
      order.push('final_reply_created');
    },
  };

  const response = completePresentedTurn({
    store,
    events,
    caseSession,
    review: {
      reply: '已完成正式回复。',
      decision: 'final',
      caseStatus: 'concluded',
    },
    replyToMessageId: 'msg_user',
  });

  assert.deepEqual(order, [
    'presentation_prepared',
    'helper_message',
    'final_reply_created',
    'terminal_status',
  ]);
  assert.equal(caseSession.messages.at(-1).replyToMessageId, 'msg_user');
  assert.equal(caseSession.status, 'concluded');
  assert.equal(response.assistantMessage, '已完成正式回复。');
});

test('review freezes case status without publishing it before presentation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-'));
  try {
    const { config, store } = createAgent(dir, { async diagnose() { return concludedWorkerResult(); } });
    const caseSession = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: 'Review status contract',
    });
    caseSession.status = 'diagnosing';
    const run = { id: 'run_review_status', caseId: caseSession.id, status: 'running' };
    const reviewer = new ReviewPresentationService(
      config,
      new NoopModelClient(),
      new CaseRuntimeEventRecorder(store),
      '',
      '',
      '',
    );

    const review = await reviewer.reviewAndFormat(caseSession, concludedWorkerResult().result, run);

    assert.equal(caseSession.status, 'diagnosing');
    assert.equal(review.caseStatus, 'concluded');
    assert.equal(run.status, 'concluded');
    assert.equal(run.result.status, 'concluded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function modelChatResponse(content) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function createModelAgent(dir, worker, modelPayload) {
  const config = baseConfig(dir);
  config.agent.useModelForPreflight = false;
  config.agent.modelProvider = 'test';
  config.models.providers.test = {
    type: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    temperature: 0,
  };
  const store = new FileMemoryStore(dir);
  const agent = new DiagnosticRuntime(config, store, worker);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => modelChatResponse(
    typeof modelPayload === 'string' ? modelPayload : JSON.stringify(modelPayload),
  );
  return { agent, store, config, restore: () => { globalThis.fetch = originalFetch; } };
}

function createReviewPause() {
  let releaseReview;
  let markReviewStarted;
  const reviewStarted = new Promise((resolve) => {
    markReviewStarted = resolve;
  });
  const reviewReleased = new Promise((resolve) => {
    releaseReview = resolve;
  });
  return {
    reviewStarted,
    release() {
      releaseReview();
    },
    async fetch() {
      markReviewStarted();
      await reviewReleased;
      return modelChatResponse('{}');
    },
  };
}

function configurePausedReview(config) {
  config.agent.useModelForPreflight = false;
  config.agent.useModelForRagAnswerability = false;
  config.agent.modelProvider = 'test';
  config.models.providers.test = {
    type: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    temperature: 0,
  };
}

function seedReusableExperience(store, message) {
  const prior = store.createCase({
    tenantId: 'local',
    userId: 'local-user',
    workspaceId: 'current',
    title: '历史诊断',
  });
  const priorUser = store.addMessage(prior, { role: 'user', body: message });
  store.addMessage(prior, {
    role: 'helper',
    body: '历史诊断确认配置缺失会导致保存失败。',
    replyToMessageId: priorUser.id,
  });
  store.addRun(prior, {
    id: 'run_prior',
    caseId: prior.id,
    status: 'concluded',
    request: {
      caseId: prior.id,
      runId: 'run_prior',
      workspaceId: prior.workspaceId,
      claudeSessionId: prior.claudeSessionId,
      answerGoal: {
        rawUserQuestion: message,
        resolvedQuestion: message,
        answerObject: message,
        mustAnswerItems: ['direct_answer'],
        diagnosticObjective: message,
        sourceMessageIds: [priorUser.id],
      },
      userGoal: message,
      knownFacts: [],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    },
    result: {
      status: 'concluded',
      summary: '历史诊断已有当前工作区证据。',
      missingInfo: [],
      evidence: [{
        id: 'ev_prior',
        kind: 'workspace',
        source: 'src/task.ts',
        summary: '配置缺失会导致保存失败。',
        confidence: 'high',
        validation: {
          status: 'active',
          visibility: 'internal',
          lastVerifiedAt: new Date().toISOString(),
          quality: 'ok',
        },
      }],
      claims: [{
        id: 'claim_prior',
        type: 'fact',
        role: 'primary_answer',
        text: '配置缺失会导致保存失败。',
        evidenceIds: ['ev_prior'],
        answers: ['direct_answer'],
      }],
      recommendedNextAction: 'final_answer',
    },
  });
  prior.status = 'concluded';
  store.saveCase(prior);
}

function seedAnswerableKnowledge(config) {
  const workspaceRoot = resolveKnowledgeWorkspaceRoot(config, 'current');
  initKnowledgeWorkspace({ workspaceRoot });
  const faqDir = join(workspaceRoot, 'knowledge', 'faq', 'ai-companion');
  mkdirSync(faqDir, { recursive: true });
  writeFileSync(
    join(faqDir, 'learning-plan.md'),
    `---
id: kb_faq_ai_companion_learning_plan
title: AI伴学助手如何制定学习计划
type: faq
module: ai-companion
intent: how_to
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
  - AI伴学助手
  - 制定学习计划
  - 学习计划
related_repos: []
last_verified_at: 2026-07-26
owner: support
source_document: knowledge/_sources/manual/learning-plan.md
source_document_id: src_learning_plan
source_block_ids:
  - blk_learning_plan
section_path:
  - AI伴学助手如何制定学习计划
quality_status: ok
---

# AI伴学助手如何制定学习计划

## 答案

学员加入课程后，可以通过 AI 伴学助手制定学习计划。学习计划包含任务数、学习总时长、学习起止时间、每周学习日和每日学习时长。
`,
    'utf8',
  );
  updateKnowledgeIndex({ workspaceRoot });
}

const activeUntilFormalReplyScenarios = [
  {
    name: 'Experience path',
    message: '课程任务保存失败是什么原因？',
    setup({ store }) {
      seedReusableExperience(store, this.message);
      return {};
    },
    verify({ settled, workerCalls }) {
      assert.equal(workerCalls.count, 0);
      assert.equal(settled.caseSession.logs.some((event) => event.phase === 'experience_hit'), true);
    },
  },
  {
    name: 'Knowledge path',
    message: 'AI伴学助手如何制定学习计划？',
    setup({ config }) {
      seedAnswerableKnowledge(config);
      return {};
    },
    verify({ settled, workerCalls }) {
      assert.equal(workerCalls.count, 0);
      assert.equal(settled.caseSession.runs.at(-1).result.evidence[0].kind, 'knowledge');
    },
  },
  {
    name: 'MCP path',
    message: '请确认配置证据路径。',
    setup({ config }) {
      config.workspaces[0].mcpToolIds = ['local-docs'];
      config.mcpTools = [{
        id: 'local-docs',
        name: 'Local Docs',
        protocol: 'stdio',
        permission: 'read_only',
        enabled: true,
        allowedToolNames: ['answer'],
        timeoutMs: 1_000,
        config: { command: process.execPath, args: [], env: {} },
      }];
      return {
        mcp: {
          createClient: async () => ({
            async listTools() {
              return [{ name: 'answer' }];
            },
            async callTool() {
              return {
                content: [{ type: 'text', text: 'MCP 已确认配置证据路径。' }],
                structuredContent: {
                  superHelperEvidence: {
                    confidence: 'high',
                    claims: [{
                      text: 'MCP 已确认配置证据路径。',
                      type: 'fact',
                      role: 'primary_answer',
                      answers: ['direct_answer'],
                    }],
                  },
                },
              };
            },
            async close() {},
          }),
        },
      };
    },
    verify({ settled, workerCalls }) {
      assert.equal(workerCalls.count, 0);
      assert.equal(settled.caseSession.runs.at(-1).result.evidence[0].kind, 'mcp');
    },
  },
  {
    name: 'Worker path',
    message: '请检查项目的运行时拆分是否可诊断。',
    setup() {
      return {};
    },
    verify({ settled, workerCalls }) {
      assert.equal(workerCalls.count, 1);
      assert.equal(settled.caseSession.runs.at(-1).result.evidence[0].kind, 'workspace');
    },
  },
];

for (const scenario of activeUntilFormalReplyScenarios) {
  test(`keeps ${scenario.name} active until formal reply`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-active-'));
    const originalFetch = globalThis.fetch;
    const pause = createReviewPause();
    const workerCalls = { count: 0 };
    let completion;
    try {
      const config = baseConfig(dir);
      configurePausedReview(config);
      const store = new FileMemoryStore(dir);
      const runtimeOptions = scenario.setup({ config, store });
      const worker = {
        async diagnose() {
          workerCalls.count += 1;
          return concludedWorkerResult();
        },
      };
      const agent = new DiagnosticRuntime(config, store, worker, runtimeOptions);
      globalThis.fetch = () => pause.fetch();

      const turn = agent.startUserTurn({ workspaceId: 'current', message: scenario.message });
      completion = agent.completeUserTurn(turn.caseSession.id, turn.userMessageId);
      await pause.reviewStarted;

      const snapshot = store.loadCase(turn.caseSession.id);
      assert.ok(['ready_for_diagnosis', 'queued', 'diagnosing'].includes(snapshot.status));
      assert.equal(snapshot.messages.some((message) => (
        message.role === 'helper' && message.replyToMessageId === turn.userMessageId
      )), false);

      pause.release();
      const settled = await completion;
      const formalReplies = settled.caseSession.messages.filter((message) => (
        message.role === 'helper' && message.replyToMessageId === turn.userMessageId
      ));
      assert.equal(settled.caseSession.status, 'concluded');
      assert.equal(formalReplies.length, 1);
      scenario.verify({ settled, workerCalls });
    } finally {
      pause.release();
      await completion?.catch(() => undefined);
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('startUserTurn returns AcceptedUserTurn exposing userMessageId', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-'));
  try {
    const workerRequests = [];
    const worker = { async diagnose(request) { workerRequests.push(request); return concludedWorkerResult(); } };
    const { agent } = createAgent(dir, worker);

    const turn = agent.startUserTurn({ message: '请检查项目的运行时拆分是否可诊断。' });

    assert.equal(typeof turn.userMessageId, 'string', 'startUserTurn must expose userMessageId');
    assert.ok(turn.userMessageId.length > 0, 'userMessageId must be non-empty');
    assert.ok(turn.caseSession, 'AcceptedUserTurn must expose caseSession');
    const lastMessage = turn.caseSession.messages.at(-1);
    assert.equal(lastMessage.role, 'user');
    assert.equal(lastMessage.body, '请检查项目的运行时拆分是否可诊断。');
    assert.equal(lastMessage.id, turn.userMessageId, 'userMessageId must match the accepted user message id');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completeUserTurn consumes message ID and binds replyToMessageId', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-'));
  try {
    const workerRequests = [];
    const worker = { async diagnose(request) { workerRequests.push(request); return concludedWorkerResult(); } };
    const { agent } = createAgent(dir, worker);

    const turn = agent.startUserTurn({ message: '请检查项目的运行时拆分是否可诊断。' });
    const response = await agent.completeUserTurn(turn.caseSession.id, turn.userMessageId);

    assert.equal(response.decision, 'final');
    const helperMessages = response.caseSession.messages.filter((message) => message.role === 'helper' && message.replyToMessageId);
    const reply = helperMessages.at(-1);
    assert.ok(reply, 'a helper reply must be created');
    assert.equal(reply.replyToMessageId, turn.userMessageId, 'reply must bind to the accepted user message id, not the body');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two identical-body messages bind to distinct message IDs when completing the second first', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-'));
  try {
    const workerRequests = [];
    const worker = { async diagnose(request) { workerRequests.push(request); return concludedWorkerResult(); } };
    const { agent } = createAgent(dir, worker);

    const first = agent.startUserTurn({ message: '请确认这条相同的消息' });
    const second = agent.startUserTurn({ caseId: first.caseSession.id, message: '请确认这条相同的消息' });

    assert.notEqual(first.userMessageId, second.userMessageId, 'two identical-body messages must have distinct ids');

    const secondResponse = await agent.completeUserTurn(second.caseSession.id, second.userMessageId);
    const secondReply = secondResponse.caseSession.messages
      .filter((message) => message.role === 'helper' && message.replyToMessageId)
      .at(-1);
    assert.ok(secondReply, 'second turn must produce a reply');
    assert.equal(secondReply.replyToMessageId, second.userMessageId, 'second reply must bind to the second message id, not the first identical-body message');

    const firstResponse = await agent.completeUserTurn(first.caseSession.id, first.userMessageId);
    const firstReply = firstResponse.caseSession.messages
      .filter((message) => message.role === 'helper' && message.replyToMessageId === first.userMessageId)
      .at(-1);
    assert.ok(firstReply, 'first turn must produce a reply bound to the first message id');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completeUserTurn by ID no longer locates the turn by message body', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-'));
  try {
    const workerRequests = [];
    const worker = { async diagnose(request) { workerRequests.push(request); return concludedWorkerResult(); } };
    const { agent } = createAgent(dir, worker);

    const turn = agent.startUserTurn({ message: '请检查项目的配置加载是否可诊断。' });
    const alteredBody = '这条正文已经不是原来那条了';
    const caseBefore = agent.loadCase(turn.caseSession.id);
    const userMessage = caseBefore.messages.find((message) => message.id === turn.userMessageId);
    assert.equal(userMessage.body, '请检查项目的配置加载是否可诊断。');

    const response = await agent.completeUserTurn(turn.caseSession.id, turn.userMessageId);

    assert.ok(!response.caseSession.messages.some((message) => message.body === alteredBody), 'completion must not search by body');
    const reply = response.caseSession.messages
      .filter((message) => message.role === 'helper' && message.replyToMessageId)
      .at(-1);
    assert.equal(reply.replyToMessageId, turn.userMessageId, 'reply binds to the message id even when callers no longer pass body');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first turn context excludes the second accepted message when both are persisted before completion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-'));
  try {
    const workerRequests = [];
    const worker = { async diagnose(request) { workerRequests.push(request); return concludedWorkerResult(); } };
    const { agent } = createAgent(dir, worker);

    const first = agent.startUserTurn({ message: '请检查项目的运行时拆分是否可诊断。' });
    const second = agent.startUserTurn({ caseId: first.caseSession.id, message: '请检查项目的配置加载是否可诊断。' });

    const response = await agent.completeUserTurn(first.caseSession.id, first.userMessageId);

    assert.equal(workerRequests.length, 1);
    const request = workerRequests[0];
    const recentMessageBodies = (request.context?.recentMessages ?? []).map((message) => message.body);
    assert.ok(!recentMessageBodies.includes('请检查项目的配置加载是否可诊断。'),
      'first turn recentMessages must not include the second accepted message');
    assert.ok(recentMessageBodies.includes('请检查项目的运行时拆分是否可诊断。'),
      'first turn recentMessages must include the first message');

    const sourceMessageIds = request.context?.resolvedTurn?.sourceMessageIds ?? [];
    assert.ok(!sourceMessageIds.includes(second.userMessageId),
      'first turn resolvedTurn.sourceMessageIds must not reference the second message id');
    assert.ok(sourceMessageIds.includes(first.userMessageId),
      'first turn resolvedTurn.sourceMessageIds must reference the first message id');
    assert.equal(request.context?.currentUserMessage, '请检查项目的运行时拆分是否可诊断。',
      'first turn currentUserMessage must be the first message body');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('second turn context excludes later runs and includes only messages up to its own cutoff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-'));
  try {
    const workerRequests = [];
    const worker = { async diagnose(request) { workerRequests.push(request); return concludedWorkerResult(`_${workerRequests.length + 1}`); } };
    const { agent } = createAgent(dir, worker);

    const first = agent.startUserTurn({ message: '请检查项目的运行时拆分是否可诊断。' });
    const second = agent.startUserTurn({ caseId: first.caseSession.id, message: '请检查项目的配置加载是否可诊断。' });

    await agent.completeUserTurn(first.caseSession.id, first.userMessageId);
    const secondResponse = await agent.completeUserTurn(second.caseSession.id, second.userMessageId);

    assert.equal(workerRequests.length, 2);
    const secondRequest = workerRequests[1];
    const recentMessageBodies = (secondRequest.context?.recentMessages ?? []).map((message) => message.body);
    assert.ok(recentMessageBodies.includes('请检查项目的运行时拆分是否可诊断。'), 'second turn sees the first user message');
    assert.ok(recentMessageBodies.includes('请检查项目的配置加载是否可诊断。'), 'second turn sees its own message');
    const helperReplies = recentMessageBodies.filter((body) => body.includes('已确认问题原因'));
    assert.equal(helperReplies.length, 0, 'second turn recentMessages must not include the first turn helper reply body');

    const previousRunIds = (secondRequest.context?.previousRuns ?? []).map((run) => run.runId);
    assert.ok(previousRunIds.includes(`run_01`), 'second turn sees the first turn run as previous run history');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const baseWorkerResult = {
  result: {
    status: 'concluded',
    summary: '已找到配置入口。',
    missingInfo: [],
    evidence: [{ id: 'ev_01', kind: 'workspace', source: 'src/Settings.php', summary: '配置入口证据。', confidence: 'high' }],
    claims: [{ id: 'claim_1', type: 'fact', role: 'primary_answer', text: '配置入口在后台教务参数设置。', evidenceIds: ['ev_01'], answers: ['direct_answer'] }],
    recommendedNextAction: 'final_answer',
  },
  trace: { command: 'claude -p', cwd: process.cwd(), stdout: '{"result":"ok"}', stderr: '', exitCode: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
};

test('deterministic presentation blocks extra facts not present in reviewed claims', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-'));
  const worker = { async diagnose() { return baseWorkerResult; } };
  const maliciousReply = [
    '**结论：配置入口在后台教务参数设置。**',
    '',
    '额外发现：系统使用 Redis 缓存处理会话，这可能影响配置生效。',
  ].join('\n');
  const harness = createModelAgent(dir, worker, {
    answerTarget: '配置入口在哪',
    directAnswer: '配置入口在后台教务参数设置。',
    reply: maliciousReply,
    claimIds: ['claim_1'],
    evidenceIds: ['ev_01'],
    directAnswerClaimIds: ['claim_1'],
  });
  try {
    const response = await harness.agent.handleUserMessage({ persona: 'operations', message: '配置入口在哪？' });
    assert.doesNotMatch(response.assistantMessage, /Redis/, 'extra facts not in any reviewed claim must not appear in the visible reply');
    assert.match(response.assistantMessage, /配置入口在后台教务参数设置/, 'accepted claim text must appear');
  } finally {
    harness.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Q2 keyword in result does not trigger a fixed Q2 template', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-'));
  const worker = {
    async diagnose() {
      return {
        result: {
          status: 'concluded',
          summary: 'Q2 event_v2 流程已确认。',
          missingInfo: [],
          evidence: [{ id: 'ev_01', kind: 'workspace', source: 'src/Q2Event.php', summary: 'Q2 事件入口确认。', confidence: 'high' }],
          claims: [{ id: 'claim_1', type: 'fact', role: 'primary_answer', text: 'Q2 事件入口在 src/Q2Event.php。', evidenceIds: ['ev_01'], answers: ['direct_answer'] }],
          recommendedNextAction: 'final_answer',
        },
        trace: { command: 'claude -p', cwd: process.cwd(), stdout: '{}', stderr: '', exitCode: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
      };
    },
  };
  const { agent } = createAgent(dir, worker);
  const response = await agent.handleUserMessage({ persona: 'operations', message: 'Q2 事件入口在哪里？' });
  assert.doesNotMatch(response.assistantMessage, /# Q2 分析结果|## 接口入口|## 一句话结论/, 'Q2 keyword must not trigger a fixed template');
  assert.match(response.assistantMessage, /Q2 事件入口/, 'accepted claim text must appear');
});

test('process_note claim never enters the visible reply projection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-'));
  const worker = {
    async diagnose() {
      return {
        result: {
          status: 'concluded',
          summary: '已确认。',
          missingInfo: [],
          evidence: [{ id: 'ev_01', kind: 'workspace', source: 'src/App.php', summary: '入口确认。', confidence: 'high' }],
          claims: [
            { id: 'claim_1', type: 'fact', role: 'primary_answer', text: '配置入口在后台教务参数设置。', evidenceIds: ['ev_01'], answers: ['direct_answer'] },
            { id: 'claim_note', type: 'inference', role: 'process_note', text: '内部路由分数为 0.85，证据覆盖率为 60%，路由决策为 knowledge_direct。', evidenceIds: ['ev_01'], answers: [] },
          ],
          recommendedNextAction: 'final_answer',
        },
        trace: { command: 'claude -p', cwd: process.cwd(), stdout: '{}', stderr: '', exitCode: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
      };
    },
  };
  const harness = createModelAgent(dir, worker, {
    answerTarget: '配置入口在哪',
    directAnswer: '配置入口在后台教务参数设置。',
    reply: '配置入口在后台教务参数设置。\n\n内部路由分数为 0.85，证据覆盖率为 60%，路由决策为 knowledge_direct。',
    claimIds: ['claim_1', 'claim_note'],
    evidenceIds: ['ev_01'],
    directAnswerClaimIds: ['claim_1'],
  });
  try {
    const response = await harness.agent.handleUserMessage({ persona: 'operations', message: '配置入口在哪？' });
    assert.doesNotMatch(response.assistantMessage, /内部路由分数|证据覆盖率|路由决策/, 'process_note must never appear in visible reply');
    assert.match(response.assistantMessage, /配置入口在后台教务参数设置/, 'primary answer must appear');
  } finally {
    harness.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evidence judge score does not leak into the visible reply', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-integrity-'));
  const worker = {
    async diagnose() {
      return {
        result: {
          status: 'concluded',
          summary: '已确认。',
          missingInfo: [],
          evidence: [{ id: 'ev_01', kind: 'workspace', source: 'src/App.php', summary: '入口确认。', confidence: 'high' }],
          claims: [{ id: 'claim_1', type: 'fact', role: 'primary_answer', text: '配置入口在后台教务参数设置。', evidenceIds: ['ev_01'], answers: ['direct_answer'] }],
          recommendedNextAction: 'final_answer',
        },
        trace: { command: 'claude -p', cwd: process.cwd(), stdout: '{}', stderr: '', exitCode: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
      };
    },
  };
  const harness = createModelAgent(dir, worker, {
    answerTarget: '配置入口在哪',
    directAnswer: '配置入口在后台教务参数设置。',
    reply: '配置入口在后台教务参数设置。\n\nEvidence Judge 分数：0.92，证据质量为 high。',
    claimIds: ['claim_1'],
    evidenceIds: ['ev_01'],
    directAnswerClaimIds: ['claim_1'],
  });
  try {
    const response = await harness.agent.handleUserMessage({ persona: 'operations', message: '配置入口在哪？' });
    assert.doesNotMatch(response.assistantMessage, /Evidence Judge 分数|0\.92/, 'judge score must stay in logs only');
    assert.match(response.assistantMessage, /配置入口在后台教务参数设置/, 'primary answer must appear');
  } finally {
    harness.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent docs describe Case-scoped Claude session, not per-run disposable', () => {
  const mainMd = readFileSync(join(repoRoot, 'src', 'agents', 'main.md'), 'utf8');
  assert.doesNotMatch(mainMd, /per run and disposable/, 'docs must not say sessions are per run and disposable');
  assert.doesNotMatch(mainMd, /per_run_session:\s*true/, 'docs must not mark per_run_session as true');
  assert.ok(
    /Case-scoped|case-scoped|per-case|Case.*session.*reus/i.test(mainMd),
    'docs must describe Case-scoped Claude session reuse',
  );
  assert.doesNotMatch(mainMd, /worker_session_persistence:\s*false/, 'docs must not disable worker session persistence for Case-scoped reuse');
});

test('worker prompt tells Claude to prefer current DiagnosticRequest over session memory', () => {
  const promptPath = join(repoRoot, 'src', 'workers', 'claude', 'claude-prompts.ts');
  const promptSrc = readFileSync(promptPath, 'utf8');
  assert.ok(/Reuse the current Claude session context/.test(promptSrc), 'prompt reuses session context');
  assert.ok(/prefer current userGoal/.test(promptSrc), 'prompt prefers current DiagnosticRequest over session memory');
});
