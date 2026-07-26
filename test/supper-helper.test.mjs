import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { DiagnosticRuntime } from '../dist/runtime/diagnostic-runtime.js';
import { ClaudeCodeWorker } from '../dist/workers/claude/claude-code-worker.js';
import { loadConfig, saveConfig } from '../dist/config.js';
import { createModelClient } from '../dist/model.js';
import { renderApp } from '../dist/ui.js';
import { FileMemoryStore } from '../dist/storage.js';
import { startServer } from '../dist/gateway/http-server.js';
import { initKnowledgeWorkspace, resolveKnowledgeWorkspaceRoot, updateKnowledgeIndex } from '../dist/knowledge/index.js';
import { failedExecutionDiagnosticResult, mockDiagnosticResponse, parseClaudeOutput } from '../dist/workers/claude/claude-output-parser.js';
import { assertHostCommandAllowed, readOnlyTools } from '../dist/workers/claude/claude-policy.js';
import { buildClaudeSystemPrompt, buildClaudeUserPrompt } from '../dist/workers/claude/claude-prompts.js';
import { buildDiagnosticRequestContext } from '../dist/sessions/context-builder.js';
import { buildDiagnosticRequest, buildFollowUpDiagnosticRequest } from '../dist/runtime/request-builder.js';
import { buildLocalPreflightDecision, isGenericWorkspaceFollowUp, summarizePreflightDecision } from '../dist/runtime/preflight-gate.js';
import {
  caseStatusFromDiagnosticResult,
  decisionFromDiagnosticResult,
  decisionFromReviewOutcome,
  shouldRunFollowUp,
} from '../dist/runtime/review-gate.js';
import { validateDiagnosticResult } from '../dist/runtime/result-validator.js';
import { sessionSummary } from '../dist/gateway/dto.js';
import { formatPreflightQuestion, personaGuide, personaName, ruleBasedReviewAndFormat } from '../dist/runtime/presenter.js';
import { listPublicAgentConfigs, loadAgentRegistry, resolveAgentConfig } from '../dist/runtime/agent-configs.js';
import { judgeKnowledgeEvidence } from '../dist/runtime/evidence-judge.js';
import { planDeepQuery } from '../dist/runtime/deep-query-planner.js';
import { curateSolvedCase, hasCuratableDiagnosticResult, isResolutionConfirmation } from '../dist/runtime/case-curator.js';
import { runKnowledgeAcceptance } from '../dist/runtime/knowledge-acceptance.js';
import { resolveSessionStorageRoot } from '../dist/sessions/storage-scope.js';
import { updateModelSettings } from '../dist/settings/model-settings.js';

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

test('saveConfig replaces config atomically and leaves no temp file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const target = join(dir, 'config.json');
  try {
    const config = baseConfig(dir);
    saveConfig(config, target);
    const first = readFileSync(target, 'utf8');
    config.server.port = 4555;
    saveConfig(config, target);
    const second = readFileSync(target, 'utf8');
    assert.notEqual(first, second);
    assert.equal(JSON.parse(second).server.port, 4555);
    assert.equal(existsSync(`${target}.tmp`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function chatResponse(content) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

async function waitFor(assertion, timeoutMs = 2000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}

test('dashboard render symbol returns the compiled Vue entry', () => {
  const html = renderApp();
  assert.match(html, /<div id="app"><\/div>/);
  assert.match(html, /\/assets\/dashboard-.+\.js/);
  assert.doesNotMatch(html, /onclick=/);
});

test('partial fallback leads with accepted inference instead of generic downgrade summary', () => {
  const reply = ruleBasedReviewAndFormat({
    status: 'concluded',
    summary: '问题根因是短信防御模块拦截了该学员的请求。',
    missingInfo: ['短信防御命中日志或可复核的发送流水'],
    evidence: [
      {
        id: 'ev_sms_defense',
        kind: 'workspace',
        source: 'src/Topxia/WebBundle/Controller/LoginController.php',
        summary: '短信防御 deny 分支会返回 ACK=ok 且 allowance=0，前端可能显示发送成功但实际未发送。',
        confidence: 'medium',
      },
    ],
    claims: [
      {
        type: 'inference',
        role: 'supporting_context',
        text: '短信防御模块可能拦截了该学员的请求，前端仍显示发送成功，导致实际短信未发出。',
        evidenceIds: ['ev_sms_defense'],
        answers: [],
      },
    ],
    recommendedNextAction: 'final_answer',
  }, 'operations', '学员pc端手机号快捷登录收不到验证码，这个是什么问题');

  assert.match(reply, /^\*\*初步判断：短信防御模块可能拦截了该学员的请求/m);
  assert.doesNotMatch(reply, /^(\*\*)?结论：诊断结果包含未通过证据校验的内容/m);
  assert.match(reply, /\*\*证据状态：当前证据不足，不能作为最终结论。\*\*/);
  assert.match(reply, /\*\*仍需确认：.*短信防御命中日志.*可验证的 medium\/high confidence 证据/);
});

test('final worker result without claim role and answers is downgraded instead of shown as concluded', () => {
  const result = {
    status: 'concluded',
    summary: '学员PC端手机号快捷登录功能入口为 /login/sms，收不到验证码的常见原因包括云短信配置、额度、锁定或发送频率限制。',
    missingInfo: [],
    evidence: [
      {
        id: 'ev_sms_login',
        kind: 'workspace',
        source: 'src/AppBundle/Controller/LoginController.php',
        summary: '短信登录入口和云短信配置检查。',
        confidence: 'high',
      },
    ],
    claims: [
      {
        id: 'claim_sms_common',
        type: 'fact',
        text: '收不到验证码的常见原因包括 cloud_sms 未启用、短信签名未配置、短信额度用尽、服务被锁定或发送频率限制。',
        evidenceIds: ['ev_sms_login'],
      },
    ],
    recommendedNextAction: 'final_answer',
  };

  const validation = validateDiagnosticResult(result, {
    rawUserQuestion: '学员pc端手机号快捷登录收不到验证码，这个是什么问题',
    resolvedQuestion: '学员pc端手机号快捷登录收不到验证码，这个是什么问题',
    answerObject: '手机号快捷登录验证码',
    mustAnswerItems: ['observed_symptom', 'cause_or_likely_cause', 'next_action'],
    diagnosticObjective: '排查短信发送失败原因',
    sourceMessageIds: ['msg_user'],
  });

  assert.equal(validation.result.status, 'partial');
  assert.equal(validation.result.recommendedNextAction, 'ask_user');
  assert.equal(validation.acceptedPrimaryAnswerClaimIds.length, 0);
  assert.equal(validation.issues.some((issue) => issue.code === 'missing_claim_role'), true);

  assert.equal(caseStatusFromDiagnosticResult(validation.result), 'partial');
  assert.equal(decisionFromDiagnosticResult(validation.result), 'ask_user');

  const summary = sessionSummary({
    id: 'case_035d82a6',
    claudeSessionId: 'claude-session',
    tenantId: 'local',
    userId: 'local-user',
    workspaceId: 'current',
    title: '学员pc端手机号快捷登录收不到验证码，这个是什么问题',
    status: 'concluded',
    userPersona: 'operations',
    messages: [],
    runs: [
      {
        id: 'run_01',
        caseId: 'case_035d82a6',
        status: 'concluded',
        result,
      },
    ],
    logs: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  assert.equal(summary.status, 'partial');
});

test('session summary keeps a newly accepted turn active despite an older terminal run', () => {
  const summary = sessionSummary({
    id: 'case_turn_race',
    claudeSessionId: 'claude-session',
    tenantId: 'local',
    userId: 'local-user',
    workspaceId: 'current',
    title: '继续追问',
    status: 'ready_for_diagnosis',
    userPersona: 'operations',
    messages: [{ id: 'msg_new', role: 'user', body: '新的问题' }],
    runs: [{
      id: 'run_old',
      caseId: 'case_turn_race',
      status: 'partial',
      result: {
        status: 'partial',
        summary: '旧回合',
        evidence: [],
        claims: [],
        missingInfo: ['旧信息'],
        recommendedNextAction: 'ask_user',
      },
    }],
    logs: [],
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:01.000Z',
  });

  assert.equal(summary.status, 'ready_for_diagnosis');
});

test('settings API sanitizes secrets and can test model connectivity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  let server;

  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const urlText = String(url);
    if (urlText.endsWith('/embeddings')) {
      assert.equal(body.model, 'Qwen/Qwen3-Embedding-0.6B');
      assert.equal(body.dimensions, 4);
      return new Response(JSON.stringify({
        model: body.model,
        data: [{ index: 0, embedding: [1, 2, 3, 4] }],
        usage: { total_tokens: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (urlText.endsWith('/rerank')) {
      assert.equal(body.model, 'BAAI/bge-reranker-v2-m3');
      assert.equal(body.return_documents, false);
      return new Response(JSON.stringify({
        id: 'rerank-test',
        results: [{ index: 0, relevance_score: 0.9 }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    assert.equal(body.model, 'MiniMax-M3');
    assert.equal(body.messages.at(-1).content.includes('super helper model connectivity test'), true);
    return chatResponse('model ok');
  };

  try {
    const config = baseConfig(dir);
    config.server.port = 43971;
    config.models.providers.minimax.apiKey = 'secret-value';
    server = await startServer({ config });

    const settings = await originalFetch('http://127.0.0.1:43971/api/settings').then((res) => res.json());
    assert.equal(settings.agent.modelProvider, 'minimax');
    assert.equal(settings.models.providers.minimax.hasApiKey, true);
    assert.equal('apiKey' in settings.models.providers.minimax, false);
    assert.equal(settings.embedding.provider, 'siliconflow');
    assert.equal(settings.embedding.hasApiKey, false);
    assert.equal('apiKey' in settings.embedding, false);
    assert.equal(settings.rerank.provider, 'siliconflow');
    assert.equal('apiKey' in settings.rerank, false);
    assert.equal(settings.claude.timeoutMs, 1000);

    const claudeSettings = await originalFetch('http://127.0.0.1:43971/api/settings/claude', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeoutMs: 180000, maxBudgetUsd: 0.5 }),
    }).then((res) => res.json());

    assert.equal(claudeSettings.claude.timeoutMs, 180000);
    assert.equal(claudeSettings.claude.maxBudgetUsd, 0.5);

    const testResult = await originalFetch('http://127.0.0.1:43971/api/settings/model/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'minimax' }),
    }).then((res) => res.json());

    assert.equal(testResult.ok, true);
    assert.equal(testResult.providerId, 'minimax');
    assert.equal(testResult.model, 'MiniMax-M3');

    const embeddingTest = await originalFetch('http://127.0.0.1:43971/api/settings/embedding/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        provider: 'siliconflow',
        model: 'Qwen/Qwen3-Embedding-0.6B',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: 'sk-test-secret',
        dimensions: 4,
        distance: 'cosine',
      }),
    }).then((res) => res.json());

    assert.equal(embeddingTest.ok, true);
    assert.equal(embeddingTest.provider, 'siliconflow');
    assert.equal(embeddingTest.model, 'Qwen/Qwen3-Embedding-0.6B');
    assert.equal(embeddingTest.dimensions, 4);
    assert.doesNotMatch(JSON.stringify(embeddingTest), /sk-test-secret|\\[1,2,3,4\\]/);

    const rerankTest = await originalFetch('http://127.0.0.1:43971/api/settings/rerank/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        provider: 'siliconflow',
        model: 'BAAI/bge-reranker-v2-m3',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: 'sk-test-secret',
      }),
    }).then((res) => res.json());

    assert.equal(rerankTest.ok, true);
    assert.equal(rerankTest.provider, 'siliconflow');
    assert.equal(rerankTest.model, 'BAAI/bge-reranker-v2-m3');
    assert.equal(typeof rerankTest.topScore, 'number');
    assert.doesNotMatch(JSON.stringify(rerankTest), /sk-test-secret|apple|banana/);
  } finally {
    if (server) {
      await server.close();
    }
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('settings API stores submitted keys in secrets file instead of config', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 0;
    config.agent.useModelForPreflight = false;
    config.claude.enabled = false;
    server = await startServer({ config });

    const settings = await fetch(`${server.url}/api/settings/model`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'minimax',
        baseUrl: 'https://api.test/v1',
        model: 'test-model',
        apiKey: 'submitted-secret',
      }),
    }).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });

    assert.equal(settings.models.providers.minimax.hasApiKey, true);
    assert.equal(settings.models.providers.minimax.apiKey, undefined);
    assert.doesNotMatch(readFileSync(join(dir, 'config.json'), 'utf8'), /submitted-secret/);
    assert.match(readFileSync(join(dir, 'secrets.json'), 'utf8'), /submitted-secret/);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model settings preserve rag answerability switch when form omits it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForRagAnswerability = false;
    config.agent.useModelForEvidenceCoverage = false;
    const secrets = {
      has: () => false,
      set: (key) => ({ source: 'file', key }),
    };

    updateModelSettings({
      config,
      secrets,
      body: {
        providerId: 'minimax',
        baseUrl: 'https://api.example.test/v1',
        model: 'MiniMax-M3',
        useModelForPreflight: true,
      },
    });

    assert.equal(config.agent.useModelForRagAnswerability, false);
    assert.equal(config.agent.useModelForEvidenceCoverage, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model client times out instead of hanging agent review forever', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
    });

  try {
    const client = createModelClient({
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'test-key',
      model: 'MiniMax-M3',
      timeoutMs: 10,
    });

    await assert.rejects(
      () => client.complete([{ role: 'user', content: 'hello' }]),
      /Model request timed out after 10ms/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sessions API lists, creates, and loads reusable chat sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43972;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    server = await startServer({ config });

    const created = await fetch('http://127.0.0.1:43972/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '你好，这是一个新会话。' }),
    }).then((res) => res.json());

    const sessions = await fetch('http://127.0.0.1:43972/api/sessions').then((res) => res.json());
    assert.equal(sessions.sessions.length, 1);
    assert.equal(sessions.sessions[0].id, created.caseId);
    assert.equal(typeof sessions.sessions[0].claudeSessionId, 'string');

    const loaded = await fetch(`http://127.0.0.1:43972/api/session?caseId=${created.caseId}`).then((res) => res.json());
    assert.equal(loaded.session.id, created.caseId);
    assert.equal(loaded.session.messages.length, 2);

    const blank = await fetch('http://127.0.0.1:43972/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '新项目提问' }),
    }).then((res) => res.json());
    assert.equal(blank.session.title, '新项目提问');
    assert.equal(blank.session.messages.length, 0);

    const lightweight = await fetch(`http://127.0.0.1:43972/api/session?caseId=${blank.session.id}&includeKnowledgeHealth=false`).then((res) => res.json());
    assert.equal(lightweight.session.id, blank.session.id);
    assert.equal(Object.hasOwn(lightweight.session, 'knowledgeHealth'), false);

    const blankLightweight = await fetch('http://127.0.0.1:43972/api/sessions?includeKnowledgeHealth=false', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '轻量新会话' }),
    }).then((res) => res.json());
    assert.equal(blankLightweight.session.title, '轻量新会话');
    assert.equal(Object.hasOwn(blankLightweight.session, 'knowledgeHealth'), false);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shareable session page route serves the chat app shell', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43984;
    config.onboarding = { completedAt: new Date().toISOString() };
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    server = await startServer({
      config,
      onboarding: {
        getState: () => ({
          completed: true,
          needsReview: false,
          draft: null,
          latestRun: null,
          review: { required: false, pendingCount: 0, blockedCount: 0, items: [] },
        }),
      },
    });

    const res = await fetch('http://127.0.0.1:43984/sessions/case_share_123');
    const html = await res.text();

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.match(html, /super helper/);
    assert.match(html, /\/assets\/dashboard-.+\.js/);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('server scopes session storage by active workspace root', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'super-helper-shared-storage-'));
  const workspaceOne = mkdtempSync(join(tmpdir(), 'super-helper-workspace-one-'));
  const workspaceTwo = mkdtempSync(join(tmpdir(), 'super-helper-workspace-two-'));
  let firstServer;
  let secondServer;

  try {
    const firstConfig = baseConfig(storageDir);
    firstConfig.server.port = 43980;
    firstConfig.agent.useModelForPreflight = false;
    firstConfig.agent.modelProvider = undefined;
    firstConfig.claude.enabled = false;
    firstConfig.workspaces[0] = {
      id: 'current',
      name: 'Workspace One',
      rootPath: workspaceOne,
      mcpToolIds: [],
    };
    firstServer = await startServer({ config: firstConfig });

    const created = await fetch('http://127.0.0.1:43980/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '第一个 workspace 的会话' }),
    }).then((res) => res.json());

    const firstSessions = await fetch('http://127.0.0.1:43980/api/sessions').then((res) => res.json());
    assert.equal(firstSessions.sessions.length, 1);
    assert.equal(firstSessions.sessions[0].id, created.caseId);

    const secondConfig = baseConfig(storageDir);
    secondConfig.server.port = 43981;
    secondConfig.agent.useModelForPreflight = false;
    secondConfig.agent.modelProvider = undefined;
    secondConfig.claude.enabled = false;
    secondConfig.workspaces[0] = {
      id: 'current',
      name: 'Workspace Two',
      rootPath: workspaceTwo,
      mcpToolIds: [],
    };
    secondServer = await startServer({ config: secondConfig });

    const secondInitialSessions = await fetch('http://127.0.0.1:43981/api/sessions').then((res) => res.json());
    assert.equal(secondInitialSessions.sessions.length, 0);

    const secondCreated = await fetch('http://127.0.0.1:43981/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '第二个 workspace 的会话' }),
    }).then((res) => res.json());

    const secondSessions = await fetch('http://127.0.0.1:43981/api/sessions').then((res) => res.json());
    assert.equal(secondSessions.sessions.length, 1);
    assert.equal(secondSessions.sessions[0].id, secondCreated.caseId);
    assert.notEqual(secondCreated.caseId, created.caseId);

    const firstSessionsAfterSecondWorkspace = await fetch('http://127.0.0.1:43980/api/sessions').then((res) => res.json());
    assert.equal(firstSessionsAfterSecondWorkspace.sessions.length, 1);
    assert.equal(firstSessionsAfterSecondWorkspace.sessions[0].id, created.caseId);
  } finally {
    if (secondServer) {
      await secondServer.close();
    }
    if (firstServer) {
      await firstServer.close();
    }
    rmSync(storageDir, { recursive: true, force: true });
    rmSync(workspaceOne, { recursive: true, force: true });
    rmSync(workspaceTwo, { recursive: true, force: true });
  }
});

test('public API routes keep compatible response shapes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  let server;

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'MiniMax-M3');
    assert.match(body.messages.at(-1).content, /connectivity test/);
    return chatResponse('model ok');
  };

  try {
    const config = baseConfig(dir);
    config.server.port = 43977;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    server = await startServer({ config });

    const baseUrl = 'http://127.0.0.1:43977';
    const chat = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'developer', message: '请解释这个项目的 package.json 主要做什么。' }),
    }).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });

    assert.equal(typeof chat.caseId, 'string');
    assert.equal(typeof chat.claudeSessionId, 'string');
    assert.equal(typeof chat.title, 'string');
    assert.equal(typeof chat.status, 'string');
    assert.equal(typeof chat.message, 'string');
    assert.equal(typeof chat.decision, 'string');
    assert.equal(chat.persona, 'developer');
    assert.equal(typeof chat.contextUsage.estimatedTokens, 'number');

    const scopedStore = new FileMemoryStore(resolveSessionStorageRoot(config, 'current'));
    const persistedCase = scopedStore.loadCase(chat.caseId);
    scopedStore.addRun(persistedCase, {
      id: 'run_legacy_trace',
      caseId: chat.caseId,
      status: 'failed',
      workerTrace: {
        command: 'claude --api-key legacy-secret',
        cwd: '/private/workspace',
        stdout: 'Authorization: Bearer legacy-bearer',
        stderr: 'cookie=legacy-cookie',
        error: 'token=legacy-token',
        exitCode: 1,
        startedAt: '',
        finishedAt: '',
      },
    });

    const session = await originalFetch(`${baseUrl}/api/session?caseId=${chat.caseId}`).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });
    assert.equal(session.session.id, chat.caseId);
    assert.equal(Array.isArray(session.session.messages), true);
    assert.equal(Array.isArray(session.session.runs), true);
    assert.equal(typeof session.session.runs.find((run) => run.id === 'run_legacy_trace').workerTrace.stdout, 'string');
    assert.doesNotMatch(JSON.stringify(session.session.runs), /legacy-secret|legacy-bearer|legacy-cookie|legacy-token/);
    assert.equal(typeof session.session.contextUsage.limitTokens, 'number');

    const sessions = await originalFetch(`${baseUrl}/api/sessions`).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });
    assert.equal(Array.isArray(sessions.sessions), true);
    assert.ok(sessions.sessions.some((item) => item.id === chat.caseId));

    const settings = await originalFetch(`${baseUrl}/api/settings`).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });
    assert.equal(typeof settings.agent.name, 'string');
    assert.equal(settings.models.providers.minimax.hasApiKey, true);
    assert.equal(settings.models.providers.minimax.apiKey, undefined);
    assert.equal(typeof settings.claude.timeoutMs, 'number');

    const modelTest = await originalFetch(`${baseUrl}/api/settings/model/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'minimax' }),
    }).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });
    assert.equal(modelTest.ok, true);
    assert.equal(modelTest.reply, 'model ok');

    const logs = await originalFetch(`${baseUrl}/api/logs?caseId=${chat.caseId}`).then((res) => {
      assert.equal(res.status, 200);
      return res.json();
    });
    assert.equal(Array.isArray(logs.blocks), true);
    assert.equal(Array.isArray(logs.logs), true);
    assert.ok(logs.blocks.some((block) => block.phase === 'input_received'));
    assert.doesNotMatch(JSON.stringify(logs), /legacy-secret|legacy-bearer|legacy-cookie|legacy-token/);
  } finally {
    if (server) {
      await server.close();
    }
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('case store records structured diagnostic log events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const store = new FileMemoryStore(dir);
    const caseSession = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: '日志测试',
    });

    assert.equal(typeof store.addLogEvent, 'function');
    store.addLogEvent(caseSession, {
      actor: 'agent',
      phase: 'preflight',
      summary: 'Agent started preflight',
      detail: { action: 'dispatch' },
    });

    const loaded = store.loadCase(caseSession.id);
    assert.equal(loaded.logs.length, 1);
    assert.equal(loaded.logs[0].actor, 'agent');
    assert.equal(loaded.logs[0].phase, 'preflight');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude Code worker reuses the per-case Claude session instead of disabling persistence', async () => {
  const config = baseConfig(mkdtempSync(join(tmpdir(), 'super-helper-test-')));
  config.claude.command = process.execPath;
  config.claude.timeoutMs = 1000;
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_01',
      workspaceId: 'current',
      claudeSessionId: '11111111-1111-4111-8111-111111111111',
      userGoal: '查一下项目里 package.json 的用途',
      knownFacts: ['用户在问项目问题'],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    });

    assert.match(response.trace.command, /--session-id 11111111-1111-4111-8111-111111111111/);
    assert.doesNotMatch(response.trace.command, /--no-session-persistence/);
    assert.match(response.trace.command, /read that file first/);
  } finally {
    rmSync(config.storage.rootDir, { recursive: true, force: true });
  }
});

test('Claude Code worker resumes an existing Claude session on follow-up runs', async () => {
  const config = baseConfig(mkdtempSync(join(tmpdir(), 'super-helper-test-')));
  config.claude.command = process.execPath;
  config.claude.timeoutMs = 1000;
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_02',
      workspaceId: 'current',
      claudeSessionId: '55555555-5555-4555-8555-555555555555',
      userGoal: '继续追问 doing 流程',
      knownFacts: ['上一轮已经分析过 q2'],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    });

    assert.match(response.trace.command, /--resume 55555555-5555-4555-8555-555555555555/);
    assert.doesNotMatch(response.trace.command, /--session-id 55555555-5555-4555-8555-555555555555/);
  } finally {
    rmSync(config.storage.rootDir, { recursive: true, force: true });
  }
});

test('Claude Code worker separates system prompt from user payload and enforces read-only tools', async () => {
  const config = baseConfig(mkdtempSync(join(tmpdir(), 'super-helper-test-')));
  config.claude.command = process.execPath;
  config.claude.tools = ['Read', 'Glob', 'Grep', 'Bash', 'Edit'];
  config.claude.timeoutMs = 1000;
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_01',
      workspaceId: 'current',
      claudeSessionId: '22222222-2222-4222-8222-222222222222',
      userGoal: '只读分析 package.json',
      knownFacts: ['用户要求只读'],
      unknowns: [],
      constraints: ['Do not modify files.'],
      allowedMcpToolIds: [],
      userPersona: 'operations',
    });

    assert.match(response.trace.command, /--system-prompt /);
    assert.match(response.trace.command, /--allowedTools Read,Glob,Grep/);
    assert.match(response.trace.command, /--tools Read,Glob,Grep/);
    assert.match(response.trace.command, /--disallowedTools /);
    assert.match(response.trace.command, /DiagnosticRequest\.context/);
    assert.match(response.trace.command, /answer the latest userGoal first/i);
    assert.match(response.trace.command, /Before returning need_input for a selected workspace/);
    assert.match(response.trace.command, /Use Glob or Grep to inspect the current workspace/);
    assert.match(response.trace.command, /Do not cite paths outside the active workspace root as workspace evidence/);
    assert.match(response.trace.command, /Bash/);
    assert.match(response.trace.command, /Edit/);
    assert.doesNotMatch(response.trace.command, /--tools [^']*Bash/);
    assert.doesNotMatch(response.trace.command, /--allowedTools [^']*Edit/);
  } finally {
    rmSync(config.storage.rootDir, { recursive: true, force: true });
  }
});

test('Claude Code worker retries when a reused session is temporarily busy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const counterPath = join(dir, 'counter.txt');
  const workerPath = join(dir, 'fake-claude-worker.mjs');
  writeFileSync(
    workerPath,
    `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const counterPath = ${JSON.stringify(counterPath)};
const count = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;
writeFileSync(counterPath, String(count + 1));
if (count === 0) {
  console.error('Error: Session ID 33333333-3333-4333-8333-333333333333 is already in use.');
  process.exit(1);
}
const result = {
  status: 'concluded',
  summary: 'retry succeeded',
  missingInfo: [],
  evidence: [{ id: 'ev_01', kind: 'workspace', source: 'package.json', summary: 'read-only evidence', confidence: 'high' }],
  claims: [{ type: 'fact', role: 'primary_answer', text: 'retry succeeded after busy session', evidenceIds: ['ev_01'], answers: ['direct_answer'] }],
  recommendedNextAction: 'final_answer'
};
console.log(JSON.stringify({ result: JSON.stringify(result) }));
`,
    'utf8',
  );
  chmodSync(workerPath, 0o755);

  const config = baseConfig(dir);
  config.claude.command = workerPath;
  config.claude.commandWhitelist = [workerPath];
  config.claude.timeoutMs = 5000;
  config.claude.sessionBusyMaxRetries = 2;
  config.claude.sessionBusyRetryDelayMs = 1;
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_01',
      workspaceId: 'current',
      claudeSessionId: '33333333-3333-4333-8333-333333333333',
      userGoal: '只读分析 package.json',
      knownFacts: [],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    });

    assert.equal(response.result.summary, 'retry succeeded');
    assert.equal(response.trace.exitCode, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude Code worker turns Claude result subtypes into partial diagnostics', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workerPath = join(dir, 'fake-budget-worker.mjs');
  writeFileSync(
    workerPath,
    `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', total_cost_usd: 0.21, errors: [] }));
`,
    'utf8',
  );
  chmodSync(workerPath, 0o755);

  const config = baseConfig(dir);
  config.claude.command = workerPath;
  config.claude.commandWhitelist = [workerPath];
  config.claude.timeoutMs = 5000;
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_01',
      workspaceId: 'current',
      claudeSessionId: '44444444-4444-4444-8444-444444444444',
      userGoal: '分析 q2',
      knownFacts: [],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    });

    assert.equal(response.result.status, 'partial');
    assert.match(response.result.summary, /error_max_budget_usd/);
    assert.equal(response.result.recommendedNextAction, 'continue_diagnosis');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('worker prompt includes answer goal and partial rag escalation focus', () => {
  const userGoal = '学员统计缺少6月份如何补上，有没有命令行处理';
  const request = {
    caseId: 'case_worker_prompt_contract',
    runId: 'run_worker_prompt_contract',
    workspaceId: 'current',
    claudeSessionId: 'claude_worker_prompt_contract',
    answerGoal: {
      rawUserQuestion: userGoal,
      resolvedQuestion: userGoal,
      answerObject: '学员统计缺少6月份如何补上，有没有命令行处理',
      mustAnswerItems: ['direct_answer'],
      diagnosticObjective: userGoal,
      sourceMessageIds: ['msg_worker_prompt_contract'],
    },
    userGoal,
    knownFacts: [],
    unknowns: [],
    constraints: [],
    allowedMcpToolIds: [],
    userPersona: 'operations',
    context: {
      isFollowUp: false,
      currentUserMessage: userGoal,
      recentMessages: [],
      previousRuns: [],
      knowledge: {
        evidence: [],
        judge: {
          answerable: false,
          confidence: 'low',
          need_code_escalation: true,
          reason: 'partial RAG',
          evidence: [],
          risks: [],
          missing_info: ['现成命令名称'],
          conflicts: [],
          recommended_next_action: 'dispatch_code_diagnosis',
          answer_score: 0.4,
        },
        answerability: {
          answerability: 'partial',
          selectedEvidenceIds: ['ev_stat_task'],
          coveredClaims: [{
            id: 'rag_claim_1',
            text: '学员统计由定时任务生成。',
            evidenceIds: ['ev_stat_task'],
            coveredRequirementIds: ['generation_source'],
            usefulness: '补数排查背景',
          }],
          missingElements: ['现成命令名称', '月份参数'],
          shouldEscalate: true,
          escalationFocus: '查找统计补数命令和月份参数',
          reason: '知识库缺命令',
        },
      },
    },
  };

  const prompt = `${buildClaudeSystemPrompt()}\n${buildClaudeUserPrompt(request)}`;

  assert.match(prompt, /DiagnosticRequest\.answerGoal/);
  assert.match(prompt, /answerGoal\.mustAnswerItems/);
  assert.match(prompt, /查找统计补数命令和月份参数/);
  assert.match(prompt, /学员统计由定时任务生成/);
});

test('Claude Code worker omits budget limit when no budget is configured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workerPath = join(dir, 'fake-no-budget-worker.mjs');
  writeFileSync(
    workerPath,
    `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', total_cost_usd: 0 }));
`,
    'utf8',
  );
  chmodSync(workerPath, 0o755);

  const config = baseConfig(dir);
  config.claude.command = workerPath;
  config.claude.commandWhitelist = [workerPath];
  delete config.claude.maxBudgetUsd;
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_01',
      workspaceId: 'current',
      claudeSessionId: '55555555-5555-4555-8555-555555555555',
      userGoal: '分析 q3',
      knownFacts: [],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    });

    assert.equal(response.trace.command.includes('--max-budget-usd'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude Code worker surfaces CLI API connection failures in the diagnostic result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workerPath = join(dir, 'fake-connection-worker.mjs');
  writeFileSync(
    workerPath,
    `#!/usr/bin/env node
console.log(JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: true,
  result: 'API Error: Connection error.',
  usage: { input_tokens: 0, output_tokens: 0 },
  total_cost_usd: 0
}));
process.exit(1);
`,
    'utf8',
  );
  chmodSync(workerPath, 0o755);

  const config = baseConfig(dir);
  config.claude.command = workerPath;
  config.claude.commandWhitelist = [workerPath];
  const worker = new ClaudeCodeWorker(config);

  try {
    const response = await worker.diagnose({
      caseId: 'case_test',
      runId: 'run_01',
      workspaceId: 'current',
      claudeSessionId: '66666666-6666-4666-8666-666666666666',
      userGoal: '查找倍速播放路由',
      knownFacts: [],
      unknowns: [],
      constraints: [],
      allowedMcpToolIds: [],
    });

    assert.equal(response.result.status, 'partial');
    assert.match(response.result.summary, /Claude Code 调用失败：API Error: Connection error\./);
    assert.doesNotMatch(response.result.summary, /模拟诊断结果/);
    assert.match(response.result.evidence[0].summary, /exitCode=1/);
    assert.equal(response.result.recommendedNextAction, 'escalate_to_human');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude worker helper modules parse output, downgrade failures, and narrow policy', () => {
  const request = {
    caseId: 'case_test',
    runId: 'run_01',
    workspaceId: 'current',
    claudeSessionId: '77777777-7777-4777-8777-777777777777',
    userGoal: '分析 package.json',
    knownFacts: [],
    unknowns: ['traceId'],
    constraints: [],
    allowedMcpToolIds: [],
  };
  const structured = {
    status: 'concluded',
    summary: 'parsed result',
    missingInfo: [],
    evidence: [{ id: 'ev_01', kind: 'workspace', source: 'package.json', summary: 'read evidence', confidence: 'high' }],
    claims: [{ type: 'fact', role: 'primary_answer', text: 'parsed', evidenceIds: ['ev_01'], answers: ['direct_answer'] }],
    recommendedNextAction: 'final_answer',
  };

  const parsed = parseClaudeOutput(JSON.stringify({ result: JSON.stringify(structured) }), request);
  assert.equal(parsed.summary, 'parsed result');
  assert.equal(parsed.recommendedNextAction, 'final_answer');

  const fenced = parseClaudeOutput(
    JSON.stringify({
      result: `The template uses {% if org.depth < 15 %} before the real result.

\`\`\`json
${JSON.stringify({ ...structured, summary: 'parsed fenced result with earlier braces' }, null, 2)}
\`\`\``,
    }),
    request,
  );
  assert.equal(fenced.summary, 'parsed fenced result with earlier braces');
  assert.equal(fenced.recommendedNextAction, 'final_answer');

  const disabled = mockDiagnosticResponse(request, 'Claude Code worker disabled in config.', '2026-01-01T00:00:00.000Z');
  assert.equal(disabled.result.status, 'partial');
  assert.equal(disabled.result.missingInfo[0], 'traceId');
  assert.equal(disabled.trace.command, 'claude worker not executed');

  const failed = failedExecutionDiagnosticResult(request, {
    stdout: JSON.stringify({ result: 'API Error: Connection error.' }),
    stderr: '',
    exitCode: 1,
  });
  assert.equal(failed.status, 'partial');
  assert.match(failed.summary, /API Error: Connection error\./);
  assert.equal(failed.recommendedNextAction, 'escalate_to_human');

  assert.deepEqual(readOnlyTools(['Read', 'Bash', 'Edit']), ['Read']);
  assert.deepEqual(readOnlyTools(['Bash']), ['Read', 'Glob', 'Grep']);
  assert.equal(assertHostCommandAllowed('claude', ['claude']), undefined);
  assert.match(assertHostCommandAllowed('rm', ['claude']), /not in super helper command whitelist/);
});

test('model client includes fetch cause codes in connection errors', async () => {
  const originalFetch = globalThis.fetch;
  const cause = new Error('Connect Timeout Error');
  cause.code = 'UND_ERR_CONNECT_TIMEOUT';
  globalThis.fetch = async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause });
  };

  try {
    const client = createModelClient({
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'test-key',
      model: 'MiniMax-M3',
      timeoutMs: 1000,
    });

    await assert.rejects(
      () => client.complete([{ role: 'user', content: 'test' }]),
      /fetch failed: UND_ERR_CONNECT_TIMEOUT Connect Timeout Error/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('config activates the only configured model provider for local agent runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const configPath = join(dir, 'config.json');
  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.models.providers = {
      minimax: {
        type: 'openai-compatible',
        baseUrl: 'https://api.example.test/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M3',
      },
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    const loaded = loadConfig(configPath);

    assert.equal(loaded.agent.modelProvider, 'minimax');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config defaults missing knowledge storage under the configured storage root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const configPath = join(dir, 'config.json');
  try {
    const config = baseConfig(dir);
    delete config.knowledge;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    const loaded = loadConfig(configPath);

    assert.equal(loaded.knowledge.rootDir, join(dir, 'knowledge'));
    assert.equal(loaded.knowledge.isolateByWorkspace, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime answers directly from knowledge evidence before calling the worker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      return {
        result: {
          status: 'concluded',
          summary: 'worker should not be called for answerable knowledge',
          missingInfo: [],
          evidence: [{ id: 'ev_worker', kind: 'workspace', source: 'worker', summary: 'worker called', confidence: 'low' }],
          claims: [{ type: 'fact', role: 'primary_answer', text: 'worker called', evidenceIds: ['ev_worker'], answers: ['direct_answer'] }],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'worker',
          cwd: workspace,
          stdout: '',
          stderr: '',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeFaq(knowledgeWorkspace, {
      module: 'ai-companion',
      intent: 'how_to',
      title: 'AI伴学助手如何制定学习计划',
      body: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。学习计划生成后包含任务数、学习总时长、学习起止时间、每周学习日和每日学习时长。',
      terms: ['AI伴学助手', '制定学习计划', '学习计划'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new DiagnosticRuntime(config, store, worker);

    const response = await agent.handleUserMessage({
      message: 'AI伴学助手如何制定学习计划？',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 0);
    assert.equal(existsSync(join(workspace, 'knowledge')), false);
    assert.equal(response.decision, 'final');
    assert.equal(response.caseSession.runs.length, 1);
    assert.equal(response.caseSession.runs[0].result.evidence[0].kind, 'knowledge');
    assert.match(response.assistantMessage, /AI伴学助手如何制定学习计划/);
    assert.match(response.assistantMessage, /\*\*(结论|答案)：/);
    assert.doesNotMatch(response.assistantMessage, /支撑证据/);
    assert.match(response.caseSession.runs[0].result.evidence[0].source, /knowledge\/faq\/ai-companion/);
    assert.equal(response.caseSession.logs.some((event) => event.phase === 'knowledge_search_result'), true);
    assert.equal(response.caseSession.logs.some((event) => event.phase === 'preflight_decision' && event.detail?.decision === 'knowledge_answer'), true);
    const retrievalTrace = response.caseSession.logs.find((event) => event.phase === 'knowledge_retrieval_trace')?.detail;
    assert.equal(retrievalTrace.strategies.find((item) => item.id === 'bm25')?.status, 'ran');
    assert.equal(retrievalTrace.strategies.find((item) => item.id === 'embedding')?.status, 'skipped');
    assert.equal(retrievalTrace.rerank.status, 'skipped');
    assert.equal(retrievalTrace.fusion.finalCandidateCount > 0, true);
    assert.deepEqual(retrievalTrace.filters, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runtime broadens source type filters so whitepaper evidence can answer natural how-to questions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      throw new Error('worker should not be called for whitepaper-backed knowledge answer');
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeWhitepaper(knowledgeWorkspace, {
      module: 'ai-companion',
      title: '学习日晚上8点',
      body: '学习日晚上8点未完成当日学习任务时向以对话框消息和APP通知的形式向学员发送学习提醒。',
      terms: ['AI伴学助手', '督学提醒', '学习日晚上8点'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new DiagnosticRuntime(config, store, worker);

    const response = await agent.handleUserMessage({
      message: 'AI伴学助手学习日晚上8点未完成任务会怎么提醒？',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 0);
    assert.equal(response.decision, 'final');
    assert.match(response.assistantMessage, /学习日晚上8点/);
    assert.match(response.assistantMessage, /APP通知/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runtime carries partial RAG claims into code escalation instead of discarding them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    const userContent = body.messages?.find((message) => message.role === 'user')?.content ?? '{}';
    let payload = {};
    try {
      payload = JSON.parse(userContent);
    } catch {
      payload = {};
    }
    if (payload.answerGoal && Array.isArray(payload.evidence)) {
      const evidenceId = payload.evidence[0].id;
      return chatResponse(JSON.stringify({
        answerability: 'partial',
        selectedEvidenceIds: [evidenceId],
        coveredClaims: [{
          id: 'rag_claim_entry',
          text: '知识库确认学员加入课程后可以通过 AI 伴学助手制定学习计划。',
          evidenceIds: [evidenceId],
          coveredRequirementIds: ['operation_method'],
          usefulness: '说明学习计划制定方式。',
        }],
        missingElements: ['入口路径', '验证或注意事项'],
        shouldEscalate: true,
        escalationFocus: '查找 AI 伴学学习计划入口和验证方式。',
        reason: '知识库只覆盖制定方式，缺入口和验证方式。',
      }));
    }
    return chatResponse('{bad json');
  };
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      return {
        result: {
          status: 'concluded',
          summary: '知识库确认制定方式，代码确认入口和验证方式。',
          missingInfo: [],
          evidence: [
            { id: 'ev_rag_entry', kind: 'knowledge', source: 'knowledge/faq/ai-companion/how-to.md', summary: '知识库确认学习计划制定方式。', confidence: 'high' },
            { id: 'ev_code_items', kind: 'workspace', source: 'learning-plan.ts', summary: '代码确认学习计划入口和验证方式。', confidence: 'high' },
          ],
          claims: [
            { id: 'claim_rag_entry', type: 'fact', role: 'supporting_context', text: '知识库确认学员加入课程后可以通过 AI 伴学助手制定学习计划。', evidenceIds: ['ev_rag_entry'], answers: [] },
            { id: 'claim_code_items', type: 'fact', role: 'primary_answer', text: '代码确认学习计划入口会保存学习时间段、每周学习日，并可通过计划生成结果验证。', evidenceIds: ['ev_code_items'], answers: ['direct_answer'] },
          ],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'worker',
          cwd: workspace,
          stdout: '',
          stderr: '',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    },
  };

  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.useModelForRagAnswerability = true;
    config.agent.useModelForEvidenceCoverage = true;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeFaq(knowledgeWorkspace, {
      module: 'ai-companion',
      intent: 'how_to',
      title: 'AI伴学助手如何制定学习计划',
      body: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。学习计划生成后包含任务数、学习总时长、学习起止时间、每周学习日和每日学习时长。',
      terms: ['AI伴学助手', '制定学习计划', '学习计划'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new DiagnosticRuntime(config, store, worker);
    const response = await agent.handleUserMessage({
      persona: 'operations',
      message: 'AI伴学助手如何制定学习计划？',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 1);
    assert.equal(workerRequests[0].context.knowledge.answerability.answerability, 'partial');
    assert.match(workerRequests[0].context.knowledge.answerability.coveredClaims[0].text, /制定学习计划/);
    assert.match(workerRequests[0].context.knowledge.answerability.escalationFocus, /入口和验证方式/);
    assert.match(workerRequests[0].context.deepQuery.anchorTerms.join('\n'), /入口路径|验证或注意事项|入口和验证方式/);
    assert.match(response.assistantMessage, /制定学习计划/);
    assert.match(response.assistantMessage, /学习时间段|每周学习日/);
    assert.match(response.assistantMessage, /验证/);
    assert.doesNotMatch(response.assistantMessage, /配置或使用问题|对业务的影响|你可以怎么处理/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runtime escalates scheduled-statistics backfill questions even with matching knowledge evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      return {
        result: {
          status: 'concluded',
          summary: '已升级到当前实现排查，需确认补统计命令。',
          missingInfo: [],
          evidence: [{ id: 'ev_code_escalated', kind: 'workspace', source: 'Grep:console command', summary: '已进入命令行和定时任务实现排查。', confidence: 'medium' }],
          claims: [{ type: 'unknown', text: '现成补统计命令仍需当前代码证据确认。', evidenceIds: ['ev_code_escalated'] }],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'worker',
          cwd: workspace,
          stdout: '',
          stderr: '',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeWhitepaper(knowledgeWorkspace, {
      module: 'edusoho-training',
      title: '用户数据统计',
      body: '用户数据统计用于查看学员管理中的用户统计数据，包含注册、登录、学习等运营统计信息。',
      terms: ['学员管理', '用户数据统计', '学员数据统计', '数据统计'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new DiagnosticRuntime(config, store, worker);

    const response = await agent.handleUserMessage({
      message: '学员管理的学员数据统计里面缺少6月份的数据，已经确认是定时任务没执行的问题，现在已经解决了定时任务。如何补上这个数据统计，有没有现成的命令行处理？',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 1);
    assert.equal(workerRequests[0].context.knowledge.judge.need_code_escalation, true);
    assert.equal(workerRequests[0].context.knowledge.judge.blockers.includes('question_not_answered'), true);
    assert.equal(workerRequests[0].context.knowledge.route.codeEscalationSignals.includes('command_or_job'), false);
    assert.equal(workerRequests[0].context.knowledge.route.codeEscalationSignals.includes('data_backfill'), false);
    assert.equal(workerRequests[0].context.knowledge.evidence.some((item) => item.title === '用户数据统计'), true);
    assert.equal(workerRequests[0].context.deepQuery.artifactTargets.includes('scheduler'), true);
    assert.doesNotMatch(response.assistantMessage, /设计使然/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runtime runs rag answerability even when evidence judge blocks direct answer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    const userContent = body.messages?.find((message) => message.role === 'user')?.content ?? '{}';
    let payload = {};
    try {
      payload = JSON.parse(userContent);
    } catch {
      payload = {};
    }
    if (payload.answerGoal && Array.isArray(payload.evidence)) {
      const evidenceId = payload.evidence[0].id;
      return chatResponse(JSON.stringify({
        answerability: 'partial',
        selectedEvidenceIds: [evidenceId],
        coveredClaims: [{
          id: 'rag_claim_generation_source',
          text: '知识库确认学员数据统计用于查看运营统计数据。',
          evidenceIds: [evidenceId],
          coveredRequirementIds: ['generation_source'],
          usefulness: '可作为补统计排查背景。',
        }],
        missingElements: ['现成补跑命令', '月份参数', '执行验证方式'],
        shouldEscalate: true,
        escalationFocus: '查找学员数据统计补跑命令、月份参数和执行验证方式。',
        reason: '知识库只覆盖统计功能背景，未覆盖补跑命令。',
      }));
    }
    return chatResponse('{bad json');
  };
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      return {
        result: {
          status: 'concluded',
          summary: '已结合知识库背景升级排查补统计命令。',
          missingInfo: [],
          evidence: [{ id: 'ev_code_escalated', kind: 'workspace', source: 'Grep:console command', summary: '已进入命令行和定时任务实现排查。', confidence: 'medium' }],
          claims: [{ type: 'unknown', text: '现成补统计命令仍需当前代码证据确认。', evidenceIds: ['ev_code_escalated'] }],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'worker',
          cwd: workspace,
          stdout: '',
          stderr: '',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    },
  };

  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.useModelForRagAnswerability = true;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeWhitepaper(knowledgeWorkspace, {
      module: 'edusoho-training',
      title: '用户数据统计',
      body: '用户数据统计用于查看学员管理中的用户统计数据，包含注册、登录、学习等运营统计信息。',
      terms: ['学员管理', '用户数据统计', '学员数据统计', '数据统计'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new DiagnosticRuntime(config, store, worker);

    await agent.handleUserMessage({
      message: '学员管理的学员数据统计里面缺少6月份的数据，如何补上这个数据统计，有没有现成的命令行处理？',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 1);
    assert.equal(workerRequests[0].context.knowledge.judge.blockers.includes('question_not_answered'), true);
    assert.equal(workerRequests[0].context.knowledge.answerability.answerability, 'partial');
    assert.match(workerRequests[0].context.knowledge.answerability.coveredClaims[0].text, /运营统计数据/);
    assert.match(workerRequests[0].context.knowledge.answerability.escalationFocus, /补跑命令/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runtime skips legacy coverage agent when rag answerability has no model provider', async () => {
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
    config.rerank = { enabled: true, provider: 'fake', model: 'fake-reranker', topN: 8, apiKeyEnv: '' };
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeWhitepaper(knowledgeWorkspace, {
      module: 'edusoho-training',
      title: '学员数据统计补跑命令',
      body: '学员数据统计缺失时可通过命令行补跑统计：执行 php app/console student:statistics:rebuild --month=YYYY-MM 补跑指定月份的学员数据统计。',
      terms: ['学员数据统计', '补跑', '命令行', 'app/console'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new DiagnosticRuntime(config, store, worker);

    await agent.handleUserMessage({
      message: '学员数据统计缺失如何补跑，有没有现成命令行处理？',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 0, 'missing rag answerability model should fall back to Evidence Judge direct answer');

    const cases = store.listCases();
    const caseSession = cases.find((c) => c.messages.some((message) => /student:statistics:rebuild|补跑指定月份/.test(message.body)));
    assert.ok(caseSession, 'case should have direct knowledge answer');
    assert.equal(caseSession.logs.some((log) => log.phase === 'evidence_coverage_result'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runtime escalates no-hit or implementation-detail knowledge questions with deep query context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      return {
        result: {
          status: 'concluded',
          summary: '已升级并检查当前接口实现',
          missingInfo: [],
          evidence: [{ id: 'ev_code_partial', kind: 'workspace', source: 'Grep:/api/orders', summary: '需要进一步静态调查', confidence: 'low' }],
          claims: [{ type: 'unknown', text: '知识库没有命中，需要代码证据', evidenceIds: ['ev_code_partial'] }],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'worker',
          cwd: workspace,
          stdout: '',
          stderr: '',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeFaq(knowledgeWorkspace, {
      module: 'ai-companion',
      intent: 'how_to',
      title: 'AI伴学助手如何制定学习计划',
      body: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。',
      terms: ['AI伴学助手', '制定学习计划'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new DiagnosticRuntime(config, store, worker);

    await agent.handleUserMessage({
      message: '接口 /api/orders 返回 500，帮我看当前实现为什么失败',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 1);
    assert.equal(workerRequests[0].context.knowledge.judge.need_code_escalation, true);
    assert.equal(workerRequests[0].context.deepQuery.permission, 'read_only');
    assert.equal(workerRequests[0].context.deepQuery.artifactTargets.includes('route'), true);
    assert.match(workerRequests[0].constraints.join('\n'), /知识库证据不足/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runtime applies deep query pivot on one retry after insufficient code evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      if (workerRequests.length === 1) {
        return {
          result: {
            status: 'partial',
            summary: '只找到 route 定义，尚未找到 controller/service 实现证据。',
            missingInfo: [],
            evidence: [{ id: 'ev_route', kind: 'workspace', source: 'routes.ts', summary: '只找到路由入口', confidence: 'medium' }],
            claims: [{ type: 'unknown', text: '还缺少实现层证据', evidenceIds: ['ev_route'] }],
            recommendedNextAction: 'continue_diagnosis',
          },
          trace: {
            command: 'worker',
            cwd: workspace,
            stdout: '',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      }
      return {
        result: {
          status: 'concluded',
          summary: '第二轮 pivot 到 controller/service 后找到实现证据。',
          missingInfo: [],
          evidence: [{ id: 'ev_controller', kind: 'workspace', source: 'src/controller.ts', summary: 'controller 调用 service。', confidence: 'high' }],
          claims: [{ type: 'fact', role: 'primary_answer', text: '实现证据已找到。', evidenceIds: ['ev_controller'], answers: ['direct_answer'] }],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'worker',
          cwd: workspace,
          stdout: '',
          stderr: '',
          exitCode: 0,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeFaq(knowledgeWorkspace, {
      module: 'ai-companion',
      intent: 'how_to',
      title: 'AI伴学助手如何制定学习计划',
      body: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。',
      terms: ['AI伴学助手', '制定学习计划'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new DiagnosticRuntime(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '接口 /api/orders 返回 500，帮我看当前 route 和 controller 实现',
      workspaceId: 'current',
    });

    assert.equal(workerRequests.length, 2);
    assert.equal(workerRequests[1].claudeSessionId, workerRequests[0].claudeSessionId);
    assert.equal(workerRequests[1].context.deepQuery.attempt, 2);
    assert.equal(workerRequests[1].context.deepQuery.previousArtifactTargets.includes('route'), true);
    assert.equal(workerRequests[1].context.deepQuery.artifactTargets.includes('controller'), true);
    assert.match(workerRequests[1].constraints.join('\n'), /Deep Query retry/);
    assert.equal(response.caseSession.logs.some((event) => event.phase === 'deep_query_retry_requested'), true);
    assert.equal(response.caseSession.logs.some((event) => event.phase === 'deep_query_pivot_selected'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runtime does not expose restricted knowledge directly to customer persona', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      return {
        result: {
          status: 'concluded',
          summary: 'restricted knowledge was not shown directly',
          missingInfo: [],
          evidence: [{ id: 'ev_worker', kind: 'workspace', source: 'worker', summary: 'worker fallback used', confidence: 'low' }],
          claims: [{ type: 'unknown', text: 'restricted knowledge requires controlled handling', evidenceIds: ['ev_worker'] }],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'worker',
          cwd: workspace,
          stdout: '',
          stderr: '',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      };
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeFaq(knowledgeWorkspace, {
      module: 'course',
      intent: 'how_to',
      title: '课程隐藏规则内部排查',
      body: '内部排查步骤：检查隐藏规则和权限策略。',
      terms: ['课程', '隐藏规则', '权限策略'],
      visibility: 'restricted',
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new DiagnosticRuntime(config, store, worker);

    const response = await agent.handleUserMessage({
      message: '课程隐藏规则怎么处理？',
      workspaceId: 'current',
      persona: 'customer',
    });

    assert.equal(workerRequests.length, 1);
    assert.doesNotMatch(response.assistantMessage, /内部排查步骤/);
    assert.match(workerRequests[0].context.knowledge.judge.reason, /restricted|受限|权限|知识库/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('evidence judge handles direct answers, stale or conflicting evidence, high risk, and query correction pivots', () => {
  const route = {
    normalizedQuestion: '课程发布后为什么学员看不到',
    moduleCandidates: ['course'],
    intentCandidates: ['how_to'],
    keywords: ['课程', '发布', '学员', '看不到'],
    sourceTypes: ['faq'],
    codeEscalationSignals: [],
    risks: [],
  };
  const activeFaq = knowledgeEvidence({
    id: 'ev_faq_active',
    status: 'active',
    sourceType: 'faq',
    matchedTerms: ['课程', '发布', '学员', '看不到'],
    verifiedAt: '2999-01-01',
  });

  const direct = judgeKnowledgeEvidence({
    route,
    evidencePack: knowledgePack([activeFaq]),
    question: route.normalizedQuestion,
  });
  assert.equal(direct.answerable, true);
  assert.equal(direct.need_code_escalation, false);
  assert.equal(direct.recommended_next_action, 'final_answer');

  const generic = judgeKnowledgeEvidence({
    route: {
      ...route,
      keywords: ['课程', '功能', '怎么', '支持'],
    },
    evidencePack: knowledgePack([
      knowledgeEvidence({
        id: 'ev_generic',
        status: 'active',
        sourceType: 'faq',
        matchedTerms: ['课程', '功能', '怎么', '支持'],
        verifiedAt: '2999-01-01',
      }),
    ]),
    question: '课程功能怎么支持',
  });
  assert.equal(generic.answerable, false);
  assert.equal(generic.blockers.includes('generic_keyword_only'), true);
  assert.equal(generic.answer_score < 0.7, true);

  const directRunbook = judgeKnowledgeEvidence({
    route,
    evidencePack: knowledgePack([
      knowledgeEvidence({
        id: 'ev_runbook_active',
        status: 'active',
        sourceType: 'runbook',
        matchedTerms: ['课程', '发布', '学员', '看不到'],
        verifiedAt: '2999-01-01',
      }),
    ]),
    question: route.normalizedQuestion,
  });
  assert.equal(directRunbook.answerable, true);
  assert.equal(directRunbook.need_code_escalation, false);

  const conflict = judgeKnowledgeEvidence({
    route,
    evidencePack: knowledgePack([
      activeFaq,
      knowledgeEvidence({
        id: 'ev_faq_deprecated',
        status: 'deprecated',
        sourceType: 'faq',
        matchedTerms: ['课程', '发布'],
        verifiedAt: '2999-01-01',
      }),
    ]),
    question: route.normalizedQuestion,
  });
  assert.equal(conflict.answerable, false);
  assert.equal(conflict.need_code_escalation, true);
  assert.deepEqual(conflict.conflicts, ['course:how_to']);

  const stale = judgeKnowledgeEvidence({
    route,
    evidencePack: knowledgePack([
      knowledgeEvidence({
        id: 'ev_review_required',
        status: 'review_required',
        sourceType: 'runbook',
        matchedTerms: ['课程', '发布', '学员'],
        verifiedAt: '2999-01-01',
      }),
    ]),
    question: route.normalizedQuestion,
  });
  assert.equal(stale.answerable, false);
  assert.equal(stale.risks.includes('stale_knowledge'), true);

  const highRisk = judgeKnowledgeEvidence({
    route: { ...route, risks: ['payment'] },
    evidencePack: knowledgePack([activeFaq]),
    question: '支付退款配置怎么修复',
  });
  assert.equal(highRisk.answerable, false);
  assert.equal(highRisk.recommended_next_action, 'escalate_to_human');

  const implementationJudge = judgeKnowledgeEvidence({
    route: { ...route, codeEscalationSignals: ['/api/orders', '500'] },
    evidencePack: knowledgePack([]),
    question: '定时任务调用 /api/orders 返回 500',
  });
  const deepQuery = planDeepQuery({
    question: '定时任务调用 /api/orders 返回 500',
    route: { ...route, codeEscalationSignals: ['/api/orders', '500'] },
    evidencePack: knowledgePack([]),
    judge: implementationJudge,
  });
  assert.equal(deepQuery.permission, 'read_only');
  assert.equal(deepQuery.correctionActions.includes('expand_aliases'), true);
  assert.equal(deepQuery.correctionActions.includes('pivot_scheduler_to_queue_callback_state'), true);
  assert.equal(deepQuery.correctionActions.includes('pivot_route_to_controller_service_config'), true);

  const draft = judgeKnowledgeEvidence({
    route,
    evidencePack: knowledgePack([
      knowledgeEvidence({
        id: 'ev_draft',
        status: 'draft',
        sourceType: 'faq',
        matchedTerms: ['课程', '发布', '学员', '看不到'],
        verifiedAt: '2999-01-01',
      }),
    ]),
    question: route.normalizedQuestion,
  });
  assert.equal(draft.answerable, false);
  assert.equal(draft.need_code_escalation, true);
});

test('runtime curates a review-required solved case after user confirms resolution', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));
  const worker = {
    async diagnose() {
      throw new Error('worker should not be called for solved-case curation');
    },
  };

  try {
    const config = baseConfig(dir);
    delete config.agent.modelProvider;
    config.agent.useModelForPreflight = false;
    config.workspaces[0].rootPath = workspace;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });
    writeKnowledgeFaq(knowledgeWorkspace, {
      module: 'ai-companion',
      intent: 'how_to',
      title: 'AI伴学助手如何制定学习计划',
      body: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。',
      terms: ['AI伴学助手', '制定学习计划'],
    });
    updateKnowledgeIndex({ workspaceRoot: knowledgeWorkspace });

    const store = new FileMemoryStore(dir);
    const agent = new DiagnosticRuntime(config, store, worker);
    const first = await agent.handleUserMessage({
      message: 'AI伴学助手如何制定学习计划？',
      workspaceId: 'current',
    });

    const confirmed = await agent.handleUserMessage({
      caseId: first.caseSession.id,
      message: '已解决，这个方案有效',
      workspaceId: 'current',
    });

    const solvedDir = join(knowledgeWorkspace, 'knowledge', 'tickets', 'solved-cases', 'ai-companion');
    const files = readdirSync(solvedDir).filter((file) => file.endsWith('.md'));
    const content = readFileSync(join(solvedDir, files[0]), 'utf8');

    assert.match(confirmed.assistantMessage, /solved case 草稿/);
    assert.match(content, /status: review_required/);
    assert.match(content, /confidence: medium/);
    assert.match(content, /## 用户最终确认/);
    assert.equal(existsSync(join(workspace, 'knowledge')), false);
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge', 'indexes', 'dirty.flag')), true);
    assert.equal(confirmed.caseSession.logs.some((event) => event.phase === 'case_curator_result'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('knowledge acceptance smoke does not write solved-case drafts into the real knowledge workspace by default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-acceptance-clean-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspace });

    runKnowledgeAcceptance({
      config,
      projectWorkspaceRoot: process.cwd(),
      knowledgeWorkspaceRoot: knowledgeWorkspace,
      reportDir: join(knowledgeWorkspace, 'reports'),
      mockWorker: true,
      realWorker: false,
      keepCases: false,
    });

    const solvedRoot = join(knowledgeWorkspace, 'knowledge', 'tickets', 'solved-cases');
    const files = existsSync(solvedRoot)
      ? execFileSync('find', [solvedRoot, '-type', 'f', '-name', '*.md'], { encoding: 'utf8' }).trim()
        .split('\n')
        .filter(Boolean)
        .filter((file) => !file.endsWith('/README.md'))
        .join('\n')
      : '';
    assert.equal(files, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('case curator keeps high-risk drafts restricted and refuses unsupported facts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kb-workspace-'));

  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const store = new FileMemoryStore(dir);
    const caseSession = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: '支付退款配置怎么修复',
    });
    caseSession.userPersona = 'developer';
    store.addMessage(caseSession, { role: 'user', body: '支付退款配置怎么修复？' });

    assert.equal(isResolutionConfirmation('还没解决，这个方案无效'), false);
    assert.equal(isResolutionConfirmation('已解决，这个方案有效'), true);
    assert.equal(hasCuratableDiagnosticResult(caseSession), false);

    store.addRun(caseSession, {
      id: 'run_01',
      caseId: caseSession.id,
      status: 'concluded',
      request: {
        caseId: caseSession.id,
        runId: 'run_01',
        workspaceId: 'current',
        claudeSessionId: caseSession.claudeSessionId,
        userGoal: '支付退款配置怎么修复？',
        knownFacts: ['支付退款配置怎么修复？'],
        unknowns: [],
        constraints: [],
        allowedMcpToolIds: [],
        userPersona: 'developer',
      },
      result: {
        status: 'concluded',
        summary: '退款配置需要管理员确认支付渠道状态后再调整。',
        missingInfo: ['当前支付渠道状态'],
        evidence: [{ id: 'ev_pay', kind: 'knowledge', source: 'knowledge/faq/payment/refund.md', summary: '退款配置 runbook', confidence: 'medium' }],
        claims: [
          { type: 'fact', role: 'primary_answer', text: '有证据的事实可沉淀', evidenceIds: ['ev_pay'], answers: ['direct_answer'] },
          { type: 'fact', role: 'supporting_context', text: '无证据根因不应沉淀', evidenceIds: [], answers: [] },
          { type: 'unknown', role: 'unknown', text: '当前支付渠道状态未知', evidenceIds: [], answers: [] },
        ],
        recommendedNextAction: 'final_answer',
      },
    });

    const draft = curateSolvedCase({
      workspaceRoot: workspace,
      caseSession,
      confirmationMessage: '已解决，这个方案有效',
    });
    const content = readFileSync(draft.path, 'utf8');

    assert.match(content, /visibility: restricted/);
    assert.match(content, /有证据的事实可沉淀/);
    assert.doesNotMatch(content, /无证据根因不应沉淀/);
    assert.match(content, /当前支付渠道状态未知/);
    assert.equal(existsSync(join(workspace, 'knowledge', 'indexes', 'dirty.flag')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('case curator refuses partial or unsupported diagnostic results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));

  try {
    const store = new FileMemoryStore(dir);
    const caseSession = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: '证据不足的问题',
    });
    store.addRun(caseSession, {
      id: 'run_partial',
      caseId: caseSession.id,
      status: 'partial',
      result: {
        status: 'partial',
        summary: '还没有足够证据。',
        missingInfo: ['当前实现证据'],
        evidence: [],
        claims: [{ type: 'fact', text: '无证据事实不能沉淀', evidenceIds: [] }],
        recommendedNextAction: 'ask_user',
      },
    });

    assert.equal(hasCuratableDiagnosticResult(caseSession), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('async chat accepts immediately, stores progress, and exposes context usage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43973;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    config.agent.contextWindowTokens = 200;
    server = await startServer({ config });

    const accepted = await fetch('http://127.0.0.1:43973/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        async: true,
        persona: 'operations',
        message: '请解释这个项目的 package.json 主要做什么，需要引用文件证据。',
      }),
    }).then((res) => {
      assert.equal(res.status, 202);
      return res.json();
    });

    assert.equal(accepted.accepted, true);
    assert.equal(typeof accepted.caseId, 'string');
    assert.equal(accepted.persona, 'operations');

    const loaded = await waitFor(async () => {
      const json = await fetch(`http://127.0.0.1:43973/api/session?caseId=${accepted.caseId}`).then((res) => res.json());
      assert.equal(json.session.messages.length >= 2, true);
      return json;
    });

    assert.equal(loaded.session.userPersona, 'operations');
    assert.equal(typeof loaded.session.contextUsage.estimatedTokens, 'number');
    assert.equal(typeof loaded.session.contextUsage.percent, 'number');
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync and async chat flows use the same runtime pipeline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    const workerRequests = [];
    const worker = {
      async diagnose(request) {
        workerRequests.push(request);
        return {
          result: {
            status: 'concluded',
            summary: '已完成同管线诊断。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_pipeline',
                kind: 'workspace',
                source: 'package.json',
                summary: '运行时管线已生成结构化请求。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                role: 'primary_answer',
                text: '同步和异步路径都调用了同一个诊断 worker 端口。',
                evidenceIds: ['ev_pipeline'],
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
      },
    };

    const agent = new DiagnosticRuntime(config, store, worker);
    const syncResponse = await agent.handleUserMessage({
      message: '请检查项目的运行时拆分是否可诊断。',
    });
    const asyncTurn = agent.startUserTurn({
      message: '请检查项目的配置加载是否可诊断。',
    });
    const asyncResponse = await agent.completeUserTurn(asyncTurn.caseSession.id, asyncTurn.userMessageId);

    const runtimePhases = (caseSession) =>
      caseSession.logs.map((event) => `${event.actor}:${event.phase}`).filter((phase) => phase !== 'system:conversation_started');

    assert.equal(syncResponse.decision, 'final');
    assert.equal(asyncResponse.decision, 'final');
    assert.equal(workerRequests.length, 2);
    assert.deepEqual(workerRequests.map((request) => request.context?.isFollowUp), [false, false]);
    assert.deepEqual(runtimePhases(syncResponse.caseSession), runtimePhases(asyncResponse.caseSession));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('context usage limit follows the current model context window', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43975;
    config.agent.useModelForPreflight = false;
    config.claude.enabled = false;
    config.agent.contextWindowTokens = 200000;
    server = await startServer({ config });

    const accepted = await fetch('http://127.0.0.1:43975/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        async: true,
        message: '请解释这个项目的 package.json 主要做什么。',
      }),
    }).then((res) => res.json());

    assert.equal(accepted.contextUsage.limitTokens, 1000000);

    const loaded = await waitFor(async () => {
      const json = await fetch(`http://127.0.0.1:43975/api/session?caseId=${accepted.caseId}`).then((res) => res.json());
      assert.equal(json.session.messages.length >= 2, true);
      return json;
    });

    assert.equal(loaded.session.contextUsage.limitTokens, 1000000);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configured provider context window overrides inferred model defaults', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43976;
    config.agent.useModelForPreflight = false;
    config.claude.enabled = false;
    config.agent.contextWindowTokens = 200000;
    config.models.providers.minimax.contextWindowTokens = 512000;
    server = await startServer({ config });

    const created = await fetch('http://127.0.0.1:43976/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '上下文窗口测试' }),
    }).then((res) => res.json());

    assert.equal(created.session.contextUsage.limitTokens, 512000);

    const settings = await fetch('http://127.0.0.1:43976/api/settings').then((res) => res.json());
    assert.equal(settings.models.providers.minimax.contextWindowTokens, 512000);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('logs API returns newest structured blocks with severity and labels', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43974;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    server = await startServer({ config });

    const accepted = await fetch('http://127.0.0.1:43974/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true, message: '请解释 package.json，需要证据。' }),
    }).then((res) => res.json());

    await waitFor(async () => {
      const json = await fetch(`http://127.0.0.1:43974/api/session?caseId=${accepted.caseId}`).then((res) => res.json());
      assert.equal(json.session.messages.length >= 2, true);
    });

    const logs = await fetch(`http://127.0.0.1:43974/api/logs?caseId=${accepted.caseId}`).then((res) => res.json());
    assert.equal(Array.isArray(logs.blocks), true);
    assert.equal(logs.blocks[0].createdAt >= logs.blocks.at(-1).createdAt, true);
    assert.ok(logs.blocks.some((block) => block.label === '输入'));
    assert.ok(logs.blocks.some((block) => block.label === '调用 CC'));
    assert.ok(logs.blocks.every((block) => ['ok', 'warn', 'error', 'info'].includes(block.severity)));
    const commandBlock = logs.blocks.find((block) => block.phase === 'command');
    assert.equal(typeof commandBlock.command, 'string');
    assert.match(commandBlock.command, /claude worker not executed|claude -p/);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session API exposes knowledge health for the current workspace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43982;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;

    const similarIndexes = join(config.knowledge.rootDir, 'workspaces', 'current-project-similar', 'knowledge', 'indexes');
    mkdirSync(similarIndexes, { recursive: true });
    writeFileSync(
      join(similarIndexes, 'manifest.json'),
      `${JSON.stringify({
        version: 1,
        updated_at: '2026-06-14T05:07:36.210Z',
        document_count: 381,
        chunk_count: 381,
        source_document_count: 3,
        documents: [],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(join(similarIndexes, 'chunks.jsonl'), '{}\n', 'utf8');

    server = await startServer({ config });

    const created = await fetch('http://127.0.0.1:43982/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'AI伴学助手有哪些功能' }),
    }).then((res) => res.json());
    const loaded = await fetch(`http://127.0.0.1:43982/api/session?caseId=${created.session.id}`).then((res) => res.json());

    assert.equal(loaded.session.knowledgeHealth.serviceBinding.status, 'error');
    assert.equal(loaded.session.knowledgeHealth.index.status, 'error');
    assert.equal(loaded.session.knowledgeHealth.search.searchedFiles, 0);
    assert.equal(loaded.session.knowledgeHealth.search.reason, 'knowledge workspace is not initialized for the current service');
    assert.equal(loaded.session.knowledgeHealth.embedding.status, 'off');
    assert.equal(loaded.session.knowledgeHealth.similarWorkspaces[0].documentCount, 381);
    assert.ok(loaded.session.knowledgeHealth.actions.includes('绑定知识库'));
    assert.ok(loaded.session.knowledgeHealth.actions.includes('测试检索'));
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('knowledge bind API initializes a service knowledge workspace shared by sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-project-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43983;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    config.workspaces[0].rootPath = workspaceRoot;

    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge')), false);

    server = await startServer({ config });

    const first = await fetch('http://127.0.0.1:43983/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '第一个会话' }),
    }).then((res) => res.json());
    const second = await fetch('http://127.0.0.1:43983/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '第二个会话' }),
    }).then((res) => res.json());

    const before = await fetch(`http://127.0.0.1:43983/api/session?caseId=${first.session.id}`).then((res) => res.json());
    assert.equal(before.session.knowledgeHealth.serviceBinding.status, 'error');

    const bound = await fetch('http://127.0.0.1:43983/api/knowledge/bind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'current' }),
    }).then((res) => res.json());

    assert.equal(bound.ok, true);
    assert.equal(bound.workspaceId, 'current');
    assert.equal(bound.knowledgeHealth.serviceBinding.status, 'ok');
    assert.equal(bound.knowledgeHealth.serviceBinding.knowledgeWorkspaceRoot, knowledgeWorkspace);
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge', 'indexes', 'manifest.json')), true);

    const firstAfter = await fetch(`http://127.0.0.1:43983/api/session?caseId=${first.session.id}`).then((res) => res.json());
    const secondAfter = await fetch(`http://127.0.0.1:43983/api/session?caseId=${second.session.id}`).then((res) => res.json());
    assert.equal(firstAfter.session.knowledgeHealth.serviceBinding.status, 'ok');
    assert.equal(secondAfter.session.knowledgeHealth.serviceBinding.status, 'ok');
    assert.equal(
      firstAfter.session.knowledgeHealth.serviceBinding.knowledgeRoot,
      secondAfter.session.knowledgeHealth.serviceBinding.knowledgeRoot,
    );
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('knowledge reindex API initializes the service workspace before rebuilding indexes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-project-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43984;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    config.workspaces[0].rootPath = workspaceRoot;

    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge')), false);

    server = await startServer({ config });
    const rebuilt = await fetch('http://127.0.0.1:43984/api/knowledge/reindex', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'current' }),
    }).then((res) => res.json());

    assert.equal(rebuilt.ok, true);
    assert.equal(rebuilt.knowledgeHealth.serviceBinding.status, 'ok');
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge', 'faq')), true);
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge', '_taxonomy', 'modules.yaml')), true);
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge', 'indexes', 'manifest.json')), true);
    assert.equal(rebuilt.knowledgeHealth.index.status, 'ok');
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('knowledge reindex API repairs a partial service knowledge skeleton', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-project-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43985;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    config.workspaces[0].rootPath = workspaceRoot;

    const knowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'current');
    mkdirSync(join(knowledgeWorkspace, 'knowledge', 'indexes'), { recursive: true });
    writeFileSync(join(knowledgeWorkspace, 'knowledge', 'indexes', 'manifest.json'), '{}\n', 'utf8');
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge', 'faq')), false);

    server = await startServer({ config });
    const rebuilt = await fetch('http://127.0.0.1:43985/api/knowledge/reindex', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'current' }),
    }).then((res) => res.json());

    assert.equal(rebuilt.ok, true);
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge', 'faq')), true);
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge', 'runbooks')), true);
    assert.equal(existsSync(join(knowledgeWorkspace, 'knowledge', '_taxonomy', 'modules.yaml')), true);
    assert.equal(rebuilt.knowledgeHealth.index.status, 'ok');
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('agent model runs before Claude dispatch and after Claude returns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  const modelCalls = [];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    modelCalls.push(body.messages);
    assert.deepEqual(body.response_format, { type: 'json_object' });

    if (modelCalls.length === 1) {
      return chatResponse(
        JSON.stringify({
          action: 'dispatch',
          reason: '信息足够进入诊断',
          missingInfo: ['traceId'],
        }),
      );
    }

    return chatResponse(
      JSON.stringify({
        claimIds: ['claim_1'],
        evidenceIds: ['ev_01'],
      }),
    );
  };

  try {
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose() {
        return {
          result: {
            status: 'concluded',
            summary: 'worker result',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_01',
                kind: 'workspace',
                source: 'src/example.ts',
                summary: '找到相关代码路径',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                role: 'primary_answer',
                text: '存在可验证证据',
                evidenceIds: ['ev_01'],
                answers: ['direct_answer'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p ...',
            cwd: process.cwd(),
            stdout: '{"result":"ok"}',
            stderr: '',
            exitCode: 0,
          },
        };
      },
    };

    const agent = new DiagnosticRuntime(baseConfig(dir), store, worker);
    const response = await agent.handleUserMessage({
      message: '课程任务保存失败，接口 /course/1/task/2/update 返回 500，账号是管理员。',
    });

    assert.equal(modelCalls.length, 2);
    assert.match(modelCalls[1][0].content, /只负责.*claim\/evidence ID/);
    assert.doesNotMatch(modelCalls[1][1].content, /claude -p|stdout|stderr/);
    assert.match(response.assistantMessage, /\*\*(结论|答案)：/);
    assert.match(response.assistantMessage, /存在可验证证据/);
    assert.equal(response.decision, 'final');
    assert.equal(response.caseSession.logs.some((item) => item.actor === 'claude' && item.phase === 'raw_output'), true);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent falls back to local reviewed formatting when presentation model returns malformed JSON after a structured result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  const rawClaudeResult = `The \`org.create\` event has no depth check before the fenced result.

\`\`\`json
{
  "status": "concluded",
  "summary": "创建入口按 15 级限制展示按钮",
  "recommendedNextAction": "final_answer"
}
\`\`\``;

  globalThis.fetch = async () => chatResponse('{"outcome":"final_answer","reply":"未闭合的模型回复');

  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose() {
        return {
          result: {
            status: 'concluded',
            summary: '结构化诊断结果已产生。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_depth',
                kind: 'workspace',
                source: 'org-manage/index.html.twig:82',
                summary: '添加子部门按钮使用 org.depth < 15 控制。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                role: 'primary_answer',
                text: '部门创建入口按 15 级限制展示。',
                evidenceIds: ['ev_depth'],
                answers: ['direct_answer'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            stdout: JSON.stringify({
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: rawClaudeResult,
            }),
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new DiagnosticRuntime(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '请在当前项目里查找部门创建支持多少级，需要引用文件证据。',
    });

    assert.equal(response.decision, 'final');
    assert.match(response.assistantMessage, /\*\*(结论|答案)：/);
    assert.match(response.assistantMessage, /部门创建入口按 15 级限制展示。/);
    assert.doesNotMatch(response.assistantMessage, /org-manage\/index\.html\.twig:82/);
    assert.match(response.caseSession.runs[0].result.evidence[0].source, /org-manage\/index\.html\.twig:82/);
    assert.doesNotMatch(response.assistantMessage, /美化输出 Agent 调用模型失败/);
    assert.doesNotMatch(response.assistantMessage, /<pre>/);
    assert.doesNotMatch(response.assistantMessage, /The `org\.create` event has no depth check/);
    assert.doesNotMatch(response.assistantMessage, /来源：run_01/);
    assert.equal(response.caseSession.logs.some((item) => item.phase === 'model_review_failed'), true);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent safely summarizes worker errors when presentation model fails before a result exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error('Model request timed out after 10ms');
  };

  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose(request) {
        const execution = {
          stdout: JSON.stringify({ result: 'API Error: Connection error.' }),
          stderr: '',
          exitCode: 1,
        };
        return {
          result: failedExecutionDiagnosticResult(request, execution),
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            ...execution,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new DiagnosticRuntime(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '请在当前项目里查找部门创建支持多少级，需要引用文件证据。',
    });

    assert.equal(response.decision, 'escalate');
    assert.match(response.assistantMessage, /诊断未完成（worker_execution_failed）/);
    assert.match(response.assistantMessage, /诊断标识：case=.*run=run_01/);
    assert.doesNotMatch(response.assistantMessage, /API Error|Connection error|exitCode|claude -p/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent asks for required information without dispatching worker when preflight blocks diagnosis', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    let workerCalls = 0;
    const worker = {
      async diagnose() {
        workerCalls += 1;
        throw new Error('worker should not be dispatched for blocked preflight');
      },
    };

    const agent = new DiagnosticRuntime(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '你好',
    });

    assert.equal(response.decision, 'ask_user');
    assert.equal(response.caseSession.status, 'need_input');
    assert.equal(workerCalls, 0);
    assert.match(response.assistantMessage, /缺少关键信息/);
    assert.equal(response.caseSession.runs.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent dispatches workspace-aware messages as structured diagnostic requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.workspaces[0].mcpToolIds = ['readonly-docs'];
    const store = new FileMemoryStore(dir);
    let receivedRequest;
    const worker = {
      async diagnose(request) {
        receivedRequest = request;
        return {
          result: {
            status: 'concluded',
            summary: '找到设置入口。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_01',
                kind: 'workspace',
                source: 'src/router.ts',
                summary: '当前 workspace 可检索到路由入口。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                role: 'primary_answer',
                text: '已基于 workspace 证据定位。',
                evidenceIds: ['ev_01'],
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
      },
    };

    const agent = new DiagnosticRuntime(config, store, worker);
    const response = await agent.handleUserMessage({
      persona: 'support',
      message: '请查找视频倍速播放设置在哪个页面路由，需要引用代码文件证据。',
    });

    assert.equal(response.decision, 'final');
    assert.ok(receivedRequest);
    assert.equal(receivedRequest.caseId, response.caseSession.id);
    assert.equal(receivedRequest.runId, 'run_01');
    assert.equal(receivedRequest.workspaceId, 'current');
    assert.equal(receivedRequest.userPersona, 'support');
    assert.deepEqual(receivedRequest.allowedMcpToolIds, ['readonly-docs']);
    assert.match(receivedRequest.userGoal, /倍速播放/);
    assert.equal(receivedRequest.context.isFollowUp, false);
    assert.ok(receivedRequest.context.recentMessages.some((message) => message.role === 'user' && /倍速播放/.test(message.body)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent blocks unsupported fact-only worker conclusions from final presentation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose() {
        return {
          result: {
            status: 'concluded',
            summary: '没有证据但声称已经定位。',
            missingInfo: [],
            evidence: [],
            claims: [
              {
                type: 'fact',
                text: '这是没有任何 evidenceIds 的事实判断。',
                evidenceIds: [],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            stdout: '{"result":"unsupported"}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new DiagnosticRuntime(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '接口 /course/task/save 返回 500，请定位原因。',
    });

    assert.equal(response.decision, 'ask_user');
    assert.match(response.assistantMessage, /目前证据不足/);
    assert.doesNotMatch(response.assistantMessage, /这是没有任何 evidenceIds 的事实判断/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime helper modules expose stable context, request, preflight, review, and presentation contracts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.workspaces[0].mcpToolIds = ['readonly-docs'];
    const store = new FileMemoryStore(dir);
    const caseSession = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: 'runtime helper test',
    });
    caseSession.userPersona = 'developer';
    store.addMessage(caseSession, { role: 'user', body: '请解释 package.json 的脚本配置，需要引用文件证据。' });

    const request = buildDiagnosticRequest({
      caseSession,
      userMessage: '请解释 package.json 的脚本配置，需要引用文件证据。',
      unknowns: ['运行环境'],
      config,
    });
    assert.equal(request.runId, 'run_01');
    assert.equal(request.userPersona, 'developer');
    assert.equal(request.answerGoal.rawUserQuestion, '请解释 package.json 的脚本配置，需要引用文件证据。');
    assert.equal(request.answerGoal.resolvedQuestion, '请解释 package.json 的脚本配置，需要引用文件证据。');
    assert.equal(request.answerGoal.answerObject, 'package.json');
    assert.deepEqual(request.answerGoal.sourceMessageIds, [caseSession.messages.at(-1).id]);
    assert.equal(request.answerGoal.mustAnswerItems.length > 0, true);
    assert.match(request.answerGoal.diagnosticObjective, /package\.json/);
    assert.deepEqual(request.allowedMcpToolIds, ['readonly-docs']);
    assert.equal(request.context.isFollowUp, false);
    assert.match(request.constraints.join('\n'), /开发视角/);
    assert.match(request.constraints.join('\n'), /问题位置、确认方式、下一步排查/);
    assert.match(request.constraints.join('\n'), /DiagnosticRequest\.answerGoal/);

    const operationsCase = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: 'operations request',
    });
    operationsCase.userPersona = 'operations';
    const operationsRequest = buildDiagnosticRequest({
      caseSession: operationsCase,
      userMessage: '后台视频倍速开关在哪里设置？',
      unknowns: [],
      config,
    });
    assert.match(operationsRequest.constraints.join('\n'), /运营视角/);
    assert.match(operationsRequest.constraints.join('\n'), /系统 bug、设计使然、配置或使用问题/);
    assert.notEqual(operationsRequest.constraints.join('\n'), request.constraints.join('\n'));

    const result = {
      status: 'partial',
      summary: '找到 package.json，但还需要继续确认脚本用途。',
      missingInfo: ['脚本运行场景'],
      evidence: [
        {
          id: 'ev_package',
          kind: 'workspace',
          source: 'package.json',
          summary: 'package.json 包含脚本配置。',
          confidence: 'high',
        },
      ],
      claims: [
        {
          type: 'fact',
          role: 'supporting_context',
          text: 'package.json 是当前判断的证据来源。',
          evidenceIds: ['ev_package'],
          answers: [],
        },
      ],
      recommendedNextAction: 'continue_diagnosis',
    };
    store.addRun(caseSession, { id: request.runId, caseId: caseSession.id, status: 'partial', request, result });
    store.addMessage(caseSession, { role: 'helper', body: '上一轮已经定位到 package.json。' });

    const context = buildDiagnosticRequestContext(caseSession, '继续看这个脚本');
    assert.equal(context.isFollowUp, true);
    assert.ok(context.previousRuns.some((run) => run.evidence.some((item) => item.id === 'ev_package')));

    const followUp = buildFollowUpDiagnosticRequest({
      caseSession,
      previousRequest: request,
      previousResult: result,
    });
    assert.equal(followUp.runId, 'run_02');
    assert.equal(followUp.answerGoal.resolvedQuestion, request.answerGoal.resolvedQuestion);
    assert.equal(followUp.answerGoal.rawUserQuestion, request.answerGoal.rawUserQuestion);
    assert.match(followUp.answerGoal.diagnosticObjective, /继续追查/);
    assert.doesNotMatch(followUp.userGoal, /继续追查/);
    assert.match(followUp.constraints.join('\n'), /Resolve follow-up references/);

    const blockedCase = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: 'blocked preflight',
    });
    store.addMessage(blockedCase, { role: 'user', body: '你好' });
    const blocked = buildLocalPreflightDecision({ config, caseSession: blockedCase, userMessage: '你好' });
    assert.equal(blocked.action, 'ask_user');
    assert.equal(summarizePreflightDecision(blocked).action, 'ask_user');
    assert.equal(isGenericWorkspaceFollowUp('请补充这是哪个产品或代码库？', ['产品名称']), true);
    assert.equal(isGenericWorkspaceFollowUp('请补充 traceId 和时间范围', ['traceId']), false);

    const finalResult = {
      ...result,
      status: 'concluded',
      recommendedNextAction: 'final_answer',
      claims: [
        {
          type: 'fact',
          role: 'primary_answer',
          text: 'package.json 是当前判断的证据来源。',
          evidenceIds: ['ev_package'],
          answers: ['direct_answer'],
        },
      ],
    };
    assert.equal(caseStatusFromDiagnosticResult(finalResult), 'concluded');
    assert.equal(decisionFromDiagnosticResult(finalResult), 'final');
    assert.equal(decisionFromReviewOutcome('ask_user', result), 'partial');
    assert.equal(shouldRunFollowUp({ reply: '继续', decision: 'partial' }, result, { command: '', cwd: '', stdout: '', stderr: '', startedAt: '', finishedAt: '' }), true);

    assert.equal(personaName('developer'), '开发人员');
    assert.equal(personaGuide('operations').focus.includes('配置入口'), true);
    assert.match(formatPreflightQuestion('请补充页面。', ['页面']), /缺少关键信息：页面/);
    const reviewedResult = {
      status: 'concluded',
      summary: '倍速开关由播放器初始化配置控制',
      missingInfo: ['线上租户配置值'],
      evidence: [
        { id: 'ev_player', kind: 'workspace', source: 'src/player.ts', summary: '播放器初始化读取 enablePlaybackRates 配置。', confidence: 'high' },
      ],
      claims: [
        {
          type: 'fact',
          role: 'primary_answer',
          text: '倍速开关由播放器初始化配置控制。',
          evidenceIds: ['ev_player'],
          answers: ['direct_answer'],
        },
      ],
      recommendedNextAction: 'final_answer',
    };
    const operationsReply = ruleBasedReviewAndFormat(reviewedResult, 'operations');
    const developerReply = ruleBasedReviewAndFormat(reviewedResult, 'developer');
    const supportReply = ruleBasedReviewAndFormat(reviewedResult, 'support');
    const customerReply = ruleBasedReviewAndFormat(reviewedResult, 'customer');
    assert.match(operationsReply, /\*\*结论：/);
    assert.match(operationsReply, /倍速开关由播放器初始化配置控制/);
    assert.doesNotMatch(operationsReply, /系统 bug|设计使然|配置或使用问题|目前不能确认/);
    assert.doesNotMatch(operationsReply, /\*\*对业务的影响：\*\*/);
    assert.doesNotMatch(operationsReply, /支撑证据：/);
    assert.doesNotMatch(operationsReply, /src\/player\.ts/);
    assert.match(developerReply, /\*\*结论：/);
    assert.match(developerReply, /\*\*定位依据：\*\*/);
    assert.doesNotMatch(developerReply, /\*\*下一步排查：\*\*/);
    assert.match(supportReply, /\*\*建议处理：\*\*/);
    assert.match(customerReply, /\*\*你现在可以这样做：\*\*/);
    assert.notEqual(operationsReply, developerReply);
    assert.match(
      ruleBasedReviewAndFormat({
        status: 'concluded',
        summary: 'unsupported',
        missingInfo: [],
        evidence: [],
        claims: [{ type: 'fact', text: '无证据事实', evidenceIds: [] }],
        recommendedNextAction: 'final_answer',
      }, 'operations'),
      /目前证据不足/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model preflight cannot block an inspectable workspace question with generic project-name follow-up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  const workerRequests = [];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);

    if (body.messages[0].content.includes('Return JSON only. Use this shape:')) {
      return chatResponse(
        JSON.stringify({
          action: 'ask_user',
          reason: '缺少产品或系统名称',
          missingInfo: ['问题对应的产品/系统名称', '是否在当前工作区已有相关文档或代码'],
          question: '请补充这个倍速播放是哪个产品或后台的功能？',
        }),
      );
    }

    return chatResponse(
      JSON.stringify({
        claimIds: ['claim_1'],
        evidenceIds: ['ev_01'],
      }),
    );
  };

  try {
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose(request) {
        workerRequests.push(request);
        return {
          result: {
            status: 'concluded',
            summary: '找到倍速播放相关入口和视频播放影响范围。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_01',
                kind: 'workspace',
                source: 'app/example/player.js',
                summary: '当前 workspace 可以只读检索倍速播放相关实现。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                role: 'primary_answer',
                text: '问题可以通过当前 workspace 先做只读排查。',
                evidenceIds: ['ev_01'],
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
      },
    };

    const agent = new DiagnosticRuntime(baseConfig(dir), store, worker);
    const response = await agent.handleUserMessage({
      persona: 'operations',
      message: '客户反馈找不到 倍速播放的页面路由，请问这个在哪？\n\n开启了倍数播放会影响微网校的视频播放吗',
    });

    assert.equal(workerRequests.length, 1);
    assert.match(workerRequests[0].userGoal, /倍速播放/);
    assert.equal(workerRequests[0].unknowns.length, 0);
    assert.equal(response.decision, 'final');
    assert.match(response.assistantMessage, /\*\*结论：/);
    assert.match(response.assistantMessage, /问题可以通过当前 workspace 先做只读排查/);
    assert.equal(
      response.caseSession.logs.some((item) => item.phase === 'model_preflight_overridden_by_local_dispatch'),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent can run one follow-up Claude turn when evidence review asks to continue diagnosis', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const originalFetch = globalThis.fetch;
  const modelCalls = [];
  const workerRequests = [];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    modelCalls.push(body.messages);
    assert.deepEqual(body.response_format, { type: 'json_object' });

    if (modelCalls.length === 1) {
      return chatResponse(JSON.stringify({ action: 'dispatch', reason: '信息足够', missingInfo: [] }));
    }

    if (modelCalls.length === 2) {
      return chatResponse(
        JSON.stringify({
          claimIds: ['claim_1'],
          evidenceIds: ['ev_01'],
        }),
      );
    }

    return chatResponse(
      JSON.stringify({
        claimIds: ['claim_1'],
        evidenceIds: ['ev_02'],
      }),
    );
  };

  try {
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose(request) {
        workerRequests.push(request);
        if (workerRequests.length === 1) {
          return {
            result: {
              status: 'partial',
              summary: '还需要继续查路由',
              missingInfo: [],
              evidence: [
                {
                  id: 'ev_01',
                  kind: 'workspace',
                  source: 'src/router.ts',
                  summary: '只找到疑似路由入口',
                  confidence: 'medium',
                },
              ],
              claims: [
                {
                  type: 'inference',
                  role: 'supporting_context',
                  text: '可能需要继续查播放器配置。',
                  evidenceIds: ['ev_01'],
                  answers: [],
                },
              ],
              recommendedNextAction: 'continue_diagnosis',
            },
            trace: {
              command: 'claude -p --session-id ...',
              cwd: process.cwd(),
              stdout: '{"result":"partial"}',
              stderr: '',
              exitCode: 0,
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
            },
          };
        }

        return {
          result: {
            status: 'concluded',
            summary: '找到播放器倍速配置和路由。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_02',
                kind: 'workspace',
                source: 'app/js/player/index.js',
                summary: '播放器初始化读取倍速配置。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                role: 'primary_answer',
                text: '倍速开关由播放器初始化配置控制。',
                evidenceIds: ['ev_02'],
                answers: ['direct_answer'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --session-id ...',
            cwd: process.cwd(),
            stdout: '{"result":"final"}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new DiagnosticRuntime(baseConfig(dir), store, worker);
    const response = await agent.handleUserMessage({
      message: '视频倍速开关在哪里开启？需要页面路由和证据。',
    });

    assert.equal(workerRequests.length, 2);
    assert.equal(workerRequests[1].runId, 'run_02');
    assert.equal(workerRequests[1].claudeSessionId, workerRequests[0].claudeSessionId);
    assert.match(response.assistantMessage, /\*\*结论：/);
    assert.match(response.assistantMessage, /倍速开关由播放器初始化配置控制/);
    assert.equal(response.decision, 'final');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('follow-up diagnostic requests carry prior assistant replies and evidence context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const workerRequests = [];

  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose(request) {
        workerRequests.push(request);
        if (workerRequests.length === 1) {
          return {
            result: {
              status: 'concluded',
              summary: '倍速播放设置位于管理后台云视频设置页 /edu_cloud/video/setting。',
              missingInfo: [],
              evidence: [
                {
                  id: 'ev_speed_setting',
                  kind: 'workspace',
                  source: 'app/Resources/views/admin-v2/cloud-center/edu-cloud/video/setting.html.twig:276',
                  summary: '倍速播放开关在 /edu_cloud/video/setting 页面。',
                  confidence: 'high',
                },
              ],
              claims: [
                {
                  type: 'fact',
                  text: '倍速播放开关和页面路由已经在上一轮确认。',
                  evidenceIds: ['ev_speed_setting'],
                },
              ],
              recommendedNextAction: 'final_answer',
            },
            trace: {
              command: 'claude -p --session-id ...',
              cwd: process.cwd(),
              stdout: '{"result":"first"}',
              stderr: '',
              exitCode: 0,
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
            },
          };
        }

        return {
          result: {
            status: 'concluded',
            summary: '追问已结合上一轮设置页继续排查。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_security_setting',
                kind: 'workspace',
                source: 'app/Resources/views/admin-v2/cloud-center/edu-cloud/video/setting.html.twig:448',
                summary: '同一页面存在云视频防盗增强配置。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                text: '追问上下文已串联。',
                evidenceIds: ['ev_security_setting'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p --resume ...',
            cwd: process.cwd(),
            stdout: '{"result":"second"}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };

    const agent = new DiagnosticRuntime(config, store, worker);
    const first = await agent.handleUserMessage({
      message: '客户反馈找不到倍速播放的页面路由，请问这个在哪？',
    });
    await agent.handleUserMessage({
      caseId: first.caseSession.id,
      message: '你刚刚说的设置的地方，限制只能微信浏览器内观看的配置也在吗，这个配置叫什么？',
    });

    assert.equal(workerRequests.length, 2);
    const followUpContext = workerRequests[1].context;
    assert.ok(followUpContext);
    assert.equal(followUpContext.isFollowUp, true);
    assert.ok(
      followUpContext.recentMessages.some(
        (message) => message.role === 'helper' && /倍速播放开关入口在云视频设置页|结论/.test(message.body),
      ),
    );
    assert.ok(
      followUpContext.previousRuns.some((run) =>
        run.evidence.some((item) => item.id === 'ev_speed_setting' && /倍速播放开关/.test(item.summary)),
      ),
    );
    assert.match(workerRequests[1].constraints.join('\n'), /Resolve follow-up references/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local preflight can dispatch general project questions, not only diagnostics', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    let receivedRequest;
    const worker = {
      async diagnose(request) {
        receivedRequest = request;
        return {
          result: {
            status: 'concluded',
            summary: '这是一个项目提问回答。',
            missingInfo: [],
            evidence: [
              {
                id: 'ev_01',
                kind: 'workspace',
                source: 'package.json',
                summary: 'package.json 描述了项目脚本。',
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                role: 'primary_answer',
                text: '项目通过 package.json 暴露脚本。',
                evidenceIds: ['ev_01'],
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
      },
    };

    const agent = new DiagnosticRuntime(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '请解释这个项目的 package.json 主要做什么，需要引用文件证据。',
    });

    assert.equal(response.decision, 'final');
    assert.equal(receivedRequest.userGoal.includes('package.json'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent registry exposes main and configured sub-agent contracts', () => {
  const registry = loadAgentRegistry();
  const stages = registry.agents.map((agent) => agent.stage);

  assert.deepEqual(stages, [
    'main',
    'input_review',
    'preflight',
    'experience',
    'knowledge_router',
    'evidence_judge',
    'rag_answerability',
    'mcp_planner',
    'mcp_evidence_extractor',
    'case_curator',
    'output_review',
    'presentation',
    'evidence_coverage',
  ]);
  assert.match(resolveAgentConfig('main').absolutePath, /src\/agents\/main\.md$/);
  assert.match(resolveAgentConfig('preflight').content, /Input Review Agent/);
  assert.match(resolveAgentConfig('experience').content, /Experience Agent/);
  assert.match(resolveAgentConfig('knowledge_router').content, /Knowledge Router Agent/);
  assert.match(resolveAgentConfig('evidence_judge').content, /Evidence Judge Agent/);
  assert.match(resolveAgentConfig('rag_answerability').content, /RAG Answerability Agent/);
  assert.match(resolveAgentConfig('mcp_planner').content, /MCP Planner Agent/);
  assert.match(resolveAgentConfig('mcp_evidence_extractor').content, /MCP Evidence Extractor Agent/);
  assert.match(resolveAgentConfig('case_curator').content, /Case Curator Agent/);
  assert.equal(listPublicAgentConfigs().some((agent) => agent.stage === 'presentation' && agent.mayProduceUserFacingText), true);
  assert.equal(listPublicAgentConfigs().find((agent) => agent.stage === 'presentation').executionMode, 'presentation_only');
});

test('experience agent reuses a prior reviewed answer without dispatching Claude', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    const prior = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: '历史问题',
    });
    const priorUser = store.addMessage(prior, { role: 'user', body: '课程任务保存失败是什么原因？' });
    store.addMessage(prior, {
      role: 'helper',
      body: '历史结论：课程任务保存失败通常需要检查任务配置和接口返回。',
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
          rawUserQuestion: priorUser.body,
          resolvedQuestion: priorUser.body,
          answerObject: priorUser.body,
          mustAnswerItems: ['direct_answer'],
          diagnosticObjective: priorUser.body,
          sourceMessageIds: [priorUser.id],
        },
        userGoal: priorUser.body,
        knownFacts: [],
        unknowns: [],
        constraints: [],
        allowedMcpToolIds: [],
      },
      result: {
        status: 'concluded',
        summary: '历史问题已有工作区证据。',
        missingInfo: [],
        evidence: [{
          id: 'ev_prior',
          kind: 'workspace',
          source: 'src/task.ts',
          summary: '课程任务保存失败的现象、原因和下一步检查方式。',
          confidence: 'high',
          validation: { status: 'active', visibility: 'internal', lastVerifiedAt: new Date().toISOString(), quality: 'ok' },
        }],
        claims: [
          { type: 'fact', role: 'supporting_context', text: '现象是课程任务保存失败。', evidenceIds: ['ev_prior'], answers: [] },
          { type: 'fact', role: 'primary_answer', text: '原因是任务配置缺失会导致课程任务保存失败。', evidenceIds: ['ev_prior'], answers: ['direct_answer'] },
          { type: 'fact', role: 'supporting_context', text: '下一步建议检查任务配置和接口返回。', evidenceIds: ['ev_prior'], answers: [] },
        ],
        recommendedNextAction: 'final_answer',
      },
    });
    prior.status = 'concluded';
    store.saveCase(prior);
    let workerCalls = 0;
    const worker = {
      async diagnose() {
        workerCalls += 1;
        throw new Error('experience match should not dispatch Claude');
      },
    };

    const agent = new DiagnosticRuntime(config, store, worker);
    const response = await agent.handleUserMessage({
      message: '课程任务保存失败是什么原因？',
    });

    assert.equal(workerCalls, 0);
    assert.equal(response.decision, 'final');
    assert.equal(response.caseSession.runs.length, 1);
    assert.equal(response.caseSession.runs[0].result.evidence[0].kind, 'history');
    assert.equal(response.caseSession.logs.some((event) => event.agentId === 'experience' && event.phase === 'experience_hit'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent log labels and activity are exposed through sessions and logs API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;
  try {
    const config = baseConfig(dir);
    config.server.port = 43977;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    server = await startServer({ config });

    const accepted = await fetch('http://127.0.0.1:43977/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        async: true,
        message: '请解释这个项目的 package.json 主要做什么。',
      }),
    }).then((res) => res.json());

    const loaded = await waitFor(async () => {
      const json = await fetch(`http://127.0.0.1:43977/api/session?caseId=${accepted.caseId}`).then((res) => res.json());
      assert.equal(json.session.messages.some((message) => message.role === 'helper'), true);
      return json;
    });
    const logs = await fetch(`http://127.0.0.1:43977/api/logs?caseId=${accepted.caseId}`).then((res) => res.json());

    assert.equal(loaded.session.agentActivity.some((item) => item.agentId === 'input-review'), true);
    assert.equal(logs.blocks.some((block) => block.agentName && block.tags.includes(block.agentName)), true);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session lifecycle supports title refresh, pin, archive, reject, and delete', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;
  try {
    const config = baseConfig(dir);
    config.server.port = 43978;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    config.claude.enabled = false;
    server = await startServer({ config });

    const created = await fetch('http://127.0.0.1:43978/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '新对话' }),
    }).then((res) => res.json());
    const accepted = await fetch('http://127.0.0.1:43978/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        async: true,
        caseId: created.session.id,
        message: '请解释 package.json 的脚本。',
      }),
    }).then((res) => res.json());

    const loaded = await waitFor(async () => {
      const json = await fetch(`http://127.0.0.1:43978/api/session?caseId=${accepted.caseId}`).then((res) => res.json());
      assert.notEqual(json.session.title, '新对话');
      return json;
    });

    const pinned = await fetch('http://127.0.0.1:43978/api/session', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: loaded.session.id, action: 'pin' }),
    }).then((res) => res.json());
    assert.equal(typeof pinned.session.pinnedAt, 'string');

    const archived = await fetch('http://127.0.0.1:43978/api/session', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: loaded.session.id, action: 'archive' }),
    }).then((res) => res.json());
    assert.equal(typeof archived.session.archivedAt, 'string');

    const rejected = await fetch('http://127.0.0.1:43978/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true, caseId: loaded.session.id, message: '继续问' }),
    });
    assert.equal(rejected.status, 409);

    const deleted = await fetch(`http://127.0.0.1:43978/api/session?caseId=${loaded.session.id}`, {
      method: 'DELETE',
    }).then((res) => res.json());
    assert.equal(deleted.deleted, true);
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('async same-case turns receive ordered reply-to helper messages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose(request) {
        await new Promise((resolve) => setTimeout(resolve, request.userGoal.includes('第二') ? 30 : 1));
        return {
          result: {
            status: 'concluded',
            summary: `回答 ${request.userGoal}`,
            missingInfo: [],
            evidence: [
              {
                id: 'ev_order',
                kind: 'workspace',
                source: 'test',
                summary: request.userGoal,
                confidence: 'high',
              },
            ],
            claims: [
              {
                type: 'fact',
                text: request.userGoal,
                evidenceIds: ['ev_order'],
              },
            ],
            recommendedNextAction: 'final_answer',
          },
          trace: {
            command: 'claude -p ...',
            cwd: process.cwd(),
            stdout: '{}',
            stderr: '',
            exitCode: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        };
      },
    };
    const agent = new DiagnosticRuntime(config, store, worker);
    const secondTurn = agent.startUserTurn({ message: '第二个问题：解释 scripts' });
    const secondId = secondTurn.userMessageId;
    const thirdTurn = agent.startUserTurn({ caseId: secondTurn.caseSession.id, message: '第三个问题：解释 dependencies' });
    const thirdId = thirdTurn.userMessageId;

    await Promise.all([
      agent.completeUserTurn(secondTurn.caseSession.id, secondId),
      agent.completeUserTurn(thirdTurn.caseSession.id, thirdId),
    ]);
    const loaded = store.loadCase(secondTurn.caseSession.id);
    const helperReplies = loaded.messages.filter((message) => message.role === 'helper');

    assert.equal(helperReplies.length, 2);
    assert.deepEqual(helperReplies.map((message) => message.replyToMessageId), [secondId, thirdId]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('async turn failures can reply to the accepted user message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  try {
    const config = baseConfig(dir);
    const store = new FileMemoryStore(dir);
    const worker = {
      async diagnose() {
        throw new Error('not used');
      },
    };
    const agent = new DiagnosticRuntime(config, store, worker);
    const failureTurn = agent.startUserTurn({ message: '失败路径也要绑定这一条消息' });
    const caseSession = failureTurn.caseSession;
    const userMessageId = failureTurn.userMessageId;

    agent.recordTurnFailure(caseSession.id, new Error('worker failed'), userMessageId);
    const loaded = store.loadCase(caseSession.id);
    const helper = loaded.messages.find((message) => message.role === 'helper');

    assert.equal(helper.replyToMessageId, userMessageId);
    assert.match(helper.body, /worker failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session API recovers stale in-progress runs instead of polling forever', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;

  try {
    const config = baseConfig(dir);
    config.server.port = 43983;
    config.claude.timeoutMs = 10;
    config.agent.useModelForPreflight = false;
    config.agent.modelProvider = undefined;
    server = await startServer({ config });

    const caseSession = await fetch('http://127.0.0.1:43983/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '卡住的会话' }),
    }).then((res) => res.json());
    const casePath = join(resolveSessionStorageRoot(config), 'cases', `${caseSession.session.id}.json`);
    const persisted = JSON.parse(readFileSync(casePath, 'utf8'));
    persisted.status = 'diagnosing';
    persisted.updatedAt = '2020-01-01T00:00:00.000Z';
    persisted.messages.push({
      id: 'msg_stale_user',
      role: 'user',
      body: '为什么一直诊断中',
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    persisted.runs.push({
      id: 'run_01',
      caseId: persisted.id,
      status: 'running',
      request: {
        caseId: persisted.id,
        runId: 'run_01',
        workspaceId: 'current',
        claudeSessionId: persisted.claudeSessionId,
        userGoal: '为什么一直诊断中',
        knownFacts: ['为什么一直诊断中'],
        unknowns: [],
        constraints: [],
        allowedMcpToolIds: [],
      },
    });
    writeFileSync(casePath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');

    const loaded = await fetch(`http://127.0.0.1:43983/api/session?caseId=${persisted.id}`).then((res) => res.json());
    const helper = loaded.session.messages.find((message) => message.role === 'helper');

    assert.equal(loaded.session.status, 'partial');
    assert.equal(loaded.session.runs[0].status, 'partial');
    assert.equal(helper.replyToMessageId, 'msg_stale_user');
    assert.match(helper.body, /后台诊断已超时/);
    const logs = await fetch(`http://127.0.0.1:43983/api/logs?caseId=${persisted.id}`).then((res) => res.json());
    assert.equal(logs.blocks.some((log) => log.phase === 'turn_recovery' && log.severity === 'warn'), true);

    const sessions = await fetch('http://127.0.0.1:43983/api/sessions').then((res) => res.json());
    assert.equal(sessions.sessions.find((item) => item.id === persisted.id).status, 'partial');
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agents API and settings UI expose configured multi-agent settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;
  try {
    const config = baseConfig(dir);
    config.server.port = 43979;
    server = await startServer({ config });

    const agents = await fetch('http://127.0.0.1:43979/api/agents').then((res) => res.json());
    assert.equal(agents.agents.some((agent) => agent.stage === 'experience'), true);
    assert.equal(agents.agents.find((agent) => agent.stage === 'experience').executionMode, 'deterministic');
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeKnowledgeFaq(workspace, input) {
  const faqDir = join(workspace, 'knowledge', 'faq', input.module);
  mkdirSync(faqDir, { recursive: true });
  writeFileSync(
    join(faqDir, `${input.module}-${input.intent}.md`),
    `---
id: kb_faq_${input.module}_${input.intent}
title: ${input.title}
type: faq
module: ${input.module}
intent: ${input.intent}
source_type: faq
confidence: high
status: active
visibility: ${input.visibility ?? 'internal'}
product_versions: []
related_terms:
${input.terms.map((term) => `  - ${term}`).join('\n')}
related_repos: []
last_verified_at: 2026-06-13
owner: support
source_document: knowledge/_sources/manual/test-faq.md
source_document_id: src_test_faq
source_block_ids:
  - blk_${input.module}_${input.intent}
section_path:
  - ${input.title}
quality_status: ok
---

# ${input.title}

## 答案

${input.body}
`,
    'utf8',
  );
}

function writeKnowledgeWhitepaper(workspace, input) {
  const whitepaperDir = join(workspace, 'knowledge', 'whitepapers', input.module);
  mkdirSync(whitepaperDir, { recursive: true });
  writeFileSync(
    join(whitepaperDir, `${input.module}-whitepaper.md`),
    `---
id: kb_whitepaper_${input.module}_reminder
title: ${input.title}
type: whitepaper_slice
module: ${input.module}
intent: product_rule
source_type: whitepaper
confidence: medium
status: active
visibility: internal
product_versions: []
related_terms:
${input.terms.map((term) => `  - ${term}`).join('\n')}
related_repos: []
last_verified_at: 2026-06-13
owner: product
source_document: knowledge/_sources/whitepapers/test.docx
source_document_id: src_test_whitepaper
source_pages: []
source_block_ids:
  - blk_${input.module}_reminder
section_path:
  - 督学提醒
  - ${input.title}
chunking_strategy: semantic-section-v1
quality_status: ok
---

# ${input.title}

## 核心内容

${input.body}
`,
    'utf8',
  );
}

function knowledgePack(results) {
  return {
    query: {
      normalized_question: '课程发布后为什么学员看不到',
      module_candidates: ['course'],
      intent_candidates: ['how_to'],
      keywords: ['课程', '发布', '学员', '看不到'],
    },
    results,
    coverage: {
      searched_files: results.length,
      matched_files: results.length,
      filtered_out: [],
    },
  };
}

function knowledgeEvidence(input) {
  return {
    evidence_id: input.id,
    document_id: input.id.replace(/^ev_/, 'kb_'),
    parent_id: input.id.replace(/^ev_/, 'kb_'),
    source: `knowledge/faq/course/${input.id}.md`,
    source_document: 'knowledge/_sources/manual/course-guide.md',
    source_document_id: 'src_course_guide',
    source_block_ids: ['blk_course_visibility'],
    source_pages: [],
    section_path: ['课程管理', '发布与可见性'],
    title: '课程可见性规则',
    type: input.sourceType === 'runbook' ? 'runbook' : 'faq',
    module: 'course',
    intent: 'how_to',
    source_type: input.sourceType,
    confidence: 'high',
    status: input.status,
    visibility: 'internal',
    last_verified_at: input.verifiedAt,
    matched_terms: input.matchedTerms,
    summary: '课程可见性规则命中',
    excerpt: '课程发布后需要满足可见范围、权限和上架时间条件。',
    answer_span: '课程发布后，学员需要满足可见范围、权限和上架时间条件。',
    score: input.matchedTerms.length * 10,
    retrieval: { source: 'rerank', rerankScore: 0.82 },
    quality: { severity: 'ok', issues: [] },
  };
}
