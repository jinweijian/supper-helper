import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { startServer } from '../dist/gateway/http-server.js';
import { renderSetupApp } from '../dist/setup-ui.js';
import { draftInputFixture } from './helpers/onboarding-fixtures.mjs';

class FakeOnboardingService {
  constructor(completed = false, needsReview = false) {
    this.completed = completed;
    this.review = {
      required: needsReview,
      pendingCount: needsReview ? 1 : 0,
      blockedCount: 0,
      items: needsReview ? [{
        id: 'drf_pending',
        sourceDocumentId: 'src_pending',
        title: 'Pending slice',
        module: 'general',
        path: 'knowledge/_pipeline/drafts/src_pending/001.md',
        qualitySeverity: 'warn',
        issues: [],
        excerptPreview: 'preview',
      }] : [],
    };
    this.draft = undefined;
    this.run = undefined;
    this.listeners = new Set();
    this.lastReviewQuery = undefined;
  }
  getState() {
    return { completed: this.completed, needsReview: this.review.required, draft: this.draft, latestRun: this.run, review: this.review };
  }
  getReviewState(query) {
    this.lastReviewQuery = query;
    return this.review;
  }
  async submitReview() {
    this.review = { required: false, pendingCount: 0, blockedCount: 0, items: [] };
    return { review: this.review, publishedSlices: 1, indexedDocuments: 1, indexedChunks: 1 };
  }
  async saveDraft(input) {
    this.draft = {
      ...input.draft,
      agent: {
        ...input.draft.agent,
        provider: { ...input.draft.agent.provider, hasApiKey: Boolean(input.secrets?.agentApiKey) },
      },
    };
    return this.getState();
  }
  async validateDraft() {
    return { ok: true, issues: [] };
  }
  async startRun() {
    this.run = {
      id: 'run_http',
      status: 'running',
      draftRevision: 1,
      overallProgress: 1,
      stages: [],
      counters: {},
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return this.run;
  }
  getRun(id) {
    return this.run?.id === id ? this.run : undefined;
  }
  async retryRun(id) {
    if (!this.getRun(id)) throw new Error('run not found');
    return this.startRun();
  }
  subscribe(_id, listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  completeRun() {
    this.run = {
      ...this.run,
      status: 'completed',
      overallProgress: 100,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    for (const listener of this.listeners) {
      listener({ type: 'run.completed', runId: this.run.id, at: this.run.updatedAt, run: this.run });
    }
  }
}

async function startOnboardingServer(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-http-'));
  const config = defaultConfig();
  config.storage.rootDir = root;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.server.host = '127.0.0.1';
  config.server.port = 0;
  if (options.completed) config.onboarding.completedAt = new Date().toISOString();
  const service = new FakeOnboardingService(Boolean(options.completed), Boolean(options.needsReview));
  const server = await startServer({ config, onboarding: service });
  return {
    ...server,
    root,
    service,
    startRun: () => service.startRun(),
    completeRun: () => service.completeRun(),
    async close() {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('onboarding HTTP API saves draft, starts run, and restores snapshot', async () => {
  const fixture = await startOnboardingServer();
  try {
    const saved = await fetch(`${fixture.url}/api/onboarding/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draftInputFixture()),
    }).then((res) => res.json());
    assert.equal(saved.draft.workspace.name, 'Demo');

    const started = await fetch(`${fixture.url}/api/onboarding/runs`, {
      method: 'POST',
    }).then((res) => res.json());
    assert.equal(started.run.status, 'running');

    const restored = await fetch(`${fixture.url}/api/onboarding/runs/${started.run.id}`).then((res) => res.json());
    assert.equal(restored.run.id, started.run.id);
  } finally {
    await fixture.close();
  }
});

test('setup render symbol returns the compiled Vue entry', () => {
  const html = renderSetupApp();
  assert.match(html, /<div id="app"><\/div>/);
  assert.match(html, /\/assets\/setup-.+\.js/);
  assert.doesNotMatch(html, /onclick=/);
});

test('root redirects to setup until onboarding is completed', async () => {
  const fixture = await startOnboardingServer({ completed: false });
  try {
    const response = await fetch(`${fixture.url}/`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/setup');
  } finally {
    await fixture.close();
  }
});

test('root redirects to setup while onboarding review is pending', async () => {
  const fixture = await startOnboardingServer({ completed: true, needsReview: true });
  try {
    const response = await fetch(`${fixture.url}/`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/setup');
  } finally {
    await fixture.close();
  }
});

test('onboarding review API exposes and clears pending review state', async () => {
  const fixture = await startOnboardingServer({ completed: true, needsReview: true });
  try {
    const pending = await fetch(`${fixture.url}/api/onboarding/review`).then((res) => res.json());
    assert.equal(pending.review.required, true);
    assert.equal(pending.review.pendingCount, 1);

    const reviewed = await fetch(`${fixture.url}/api/onboarding/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'accept_warnings', notes: 'accepted in test' }),
    }).then((res) => res.json());
    assert.equal(reviewed.review.required, false);
    assert.equal(reviewed.publishedSlices, 1);
  } finally {
    await fixture.close();
  }
});

test('onboarding review API passes pagination and filters to service', async () => {
  const fixture = await startOnboardingServer({ completed: true, needsReview: true });
  try {
    const response = await fetch(`${fixture.url}/api/onboarding/review?offset=20&limit=10&severity=warn&search=${encodeURIComponent('登录')}`);
    assert.equal(response.status, 200);
    assert.deepEqual(fixture.service.lastReviewQuery, {
      offset: 20,
      limit: 10,
      severity: 'warn',
      search: '登录',
    });
  } finally {
    await fixture.close();
  }
});

test('onboarding SSE emits named progress events and disconnect does not cancel run', async () => {
  const fixture = await startOnboardingServer();
  try {
    const run = await fixture.startRun();
    const response = await fetch(`${fixture.url}/api/onboarding/runs/${run.id}/events`);
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /event: (run|stage)\./);
    await reader.cancel();
    await fixture.completeRun();
    assert.equal(fixture.service.getRun(run.id).status, 'completed');
  } finally {
    await fixture.close();
  }
});

test('production onboarding HTTP and SSE traverse focused owners and persist the completed run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-real-http-'));
  const projectRoot = join(root, 'project');
  const sourceDir = join(root, 'sources');
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'login.md'), [
    '# 登录排查',
    '',
    '用户无法登录时，应确认账号状态、密码错误次数和认证日志，并根据已审核结果处理。',
  ].join('\n'), 'utf8');
  const config = defaultConfig();
  config.storage.rootDir = root;
  config.knowledge.rootDir = join(root, 'knowledge-store');
  config.server.host = '127.0.0.1';
  config.server.port = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    if (String(input).startsWith('https://api.example.test/')) {
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    }
    return originalFetch(input, init);
  };
  const server = await startServer({ config });
  try {
    const savedResponse = await originalFetch(`${server.url}/api/onboarding/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...draftInputFixture({
          workspace: { id: 'current', name: 'HTTP Owner', rootPath: projectRoot },
          knowledge: { rootDir: config.knowledge.rootDir, sourceDir, buildVectorIndex: false },
          agent: { provider: { baseUrl: 'https://api.example.test/v1', model: 'fixture-model' } },
          embedding: { enabled: false },
          rerank: { enabled: false },
        }),
        secrets: { agentApiKey: 'http-owner-secret' },
      }),
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal(saved.draft.agent.provider.hasApiKey, true);
    assert.equal(JSON.stringify(saved).includes('http-owner-secret'), false);

    const startedResponse = await originalFetch(`${server.url}/api/onboarding/runs`, { method: 'POST' });
    assert.equal(startedResponse.status, 200);
    const started = (await startedResponse.json()).run;
    const events = await originalFetch(`${server.url}/api/onboarding/runs/${started.id}/events`);
    const reader = events.body.getReader();
    const firstEvent = new TextDecoder().decode((await reader.read()).value);
    assert.match(firstEvent, /event: run\.snapshot/);
    await reader.cancel();

    const deadline = Date.now() + 10_000;
    let completed;
    while (Date.now() < deadline) {
      const body = await originalFetch(`${server.url}/api/onboarding/runs/${started.id}`).then((response) => response.json());
      if (body.run?.status === 'completed' || body.run?.status === 'failed') {
        completed = body.run;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(completed?.status, 'completed', completed?.safeError?.message);
    assert.equal(completed?.overallProgress, 100);
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
