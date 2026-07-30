import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig, loadConfig, saveConfig } from '../dist/config.js';
import { chunksPath, manifestPath, vectorManifestPath } from '../dist/knowledge/paths.js';
import {
  FileOnboardingDraftRepository,
  FileOnboardingRunRepository,
  FileSecretsRepository,
  OnboardingProgressHub,
  OnboardingRunner,
  OnboardingService,
  buildOnboardingPlan,
  createOnboardingRun,
  materializeConfigSecrets,
  migrateLegacyConfigSecrets,
  runOnboardingKnowledgePipeline,
  testOnboardingProviders,
  validateOnboardingDraft,
} from '../dist/onboarding/index.js';
import {
  draftInputFixture,
  embeddingFixture,
  onboardingDraftFixture,
} from './helpers/onboarding-fixtures.mjs';
import { fullOnboardingFixture } from './helpers/full-onboarding-fixture.mjs';

function createServiceFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-service-'));
  const drafts = new FileOnboardingDraftRepository(root);
  const runs = new FileOnboardingRunRepository(root);
  const secrets = new FileSecretsRepository(root);
  const progress = new OnboardingProgressHub();
  const runner = {
    async execute(run) {
      if (options.runnerNeverCompletes) return new Promise(() => {});
      return runs.save({
        ...run,
        status: 'completed',
        overallProgress: 100,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
    },
    async retry(id) {
      return this.execute(runs.load(id));
    },
  };
  const config = defaultConfig();
  config.storage.rootDir = root;
  return {
    root,
    config,
    drafts,
    secrets,
    secretsPath: join(root, 'secrets.json'),
    service: new OnboardingService({
      config,
      drafts,
      runs,
      secrets,
      progress,
      runner,
      validate: () => ({ ok: true, issues: [] }),
    }),
  };
}

test('secret repository stores file secrets outside config and materializes runtime config', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const secrets = new FileSecretsRepository(root);
    const ref = secrets.set('providers.agent.default', 'sk-agent-secret');
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.models.providers.default = {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      apiKeyRef: ref,
    };
    config.agent.modelProvider = 'default';

    saveConfig(config, join(root, 'config.json'));
    const persisted = readFileSync(join(root, 'config.json'), 'utf8');
    assert.doesNotMatch(persisted, /sk-agent-secret/);
    assert.match(persisted, /providers\.agent\.default/);
    assert.equal(statSync(join(root, 'secrets.json')).mode & 0o777, 0o600);

    const runtime = materializeConfigSecrets(loadConfig(join(root, 'config.json')), secrets);
    assert.equal(runtime.models.providers.default.apiKey, 'sk-agent-secret');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy inline keys migrate to file SecretRefs without leaking plaintext', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.models.providers.default = {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      apiKey: 'legacy-secret',
    };
    config.agent.modelProvider = 'default';
    const secrets = new FileSecretsRepository(root);

    const migrated = migrateLegacyConfigSecrets(config, secrets);
    saveConfig(migrated, join(root, 'config.json'));

    assert.equal(migrated.models.providers.default.apiKey, undefined);
    assert.equal(migrated.models.providers.default.apiKeyRef.key, 'providers.agent.default');
    assert.doesNotMatch(readFileSync(join(root, 'config.json'), 'utf8'), /legacy-secret/);
    assert.equal(secrets.resolve(migrated.models.providers.default.apiKeyRef), 'legacy-secret');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('draft repository increments revision and persists provider refs', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const repository = new FileOnboardingDraftRepository(root);
    const saved = repository.save({
      version: 1,
      revision: 0,
      workspace: { id: 'current', name: 'Demo', rootPath: '/tmp/demo' },
      knowledge: { rootDir: '/tmp/kb', sourceDir: '/tmp/sources', buildVectorIndex: true },
      server: { bindMode: 'loopback', port: 4317 },
      agent: {
        providerId: 'default',
        provider: {
          type: 'openai-compatible',
          baseUrl: 'https://api.test/v1',
          model: 'm',
          apiKeyRef: { source: 'file', key: 'providers.agent.default' },
        },
      },
      embedding: {
        enabled: false,
        provider: 'fake',
        model: 'e',
        dimensions: 4,
        distance: 'cosine',
      },
      rerank: { enabled: false, provider: 'siliconflow', model: 'r' },
      updatedAt: new Date().toISOString(),
    });
    assert.equal(saved.revision, 1);
    assert.equal(repository.load().workspace.name, 'Demo');
    assert.match(readFileSync(join(root, 'onboarding', 'draft.json'), 'utf8'), /providers\.agent\.default/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('draft repository rejects plaintext provider secrets', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const repository = new FileOnboardingDraftRepository(root);
    assert.throws(() => repository.save({
      version: 1,
      revision: 0,
      workspace: { id: 'current', name: 'Demo', rootPath: '/tmp/demo' },
      knowledge: { rootDir: '/tmp/kb', buildVectorIndex: false },
      server: { bindMode: 'loopback', port: 4317 },
      agent: {
        providerId: 'default',
        provider: {
          type: 'openai-compatible',
          baseUrl: 'https://api.test/v1',
          model: 'm',
          apiKey: 'must-not-persist',
        },
      },
      embedding: {
        enabled: false,
        provider: 'fake',
        model: 'e',
        dimensions: 4,
        distance: 'cosine',
      },
      rerank: { enabled: false, provider: 'siliconflow', model: 'r' },
      updatedAt: new Date().toISOString(),
    }), /plaintext secrets/);
    assert.equal(repository.load(), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('service exposes existing config as sanitized setup defaults when no draft exists', () => {
  const fixture = createServiceFixture();
  try {
    const agentRef = fixture.secrets.set('providers.agent.minimax', 'agent-secret');
    const embeddingRef = fixture.secrets.set('providers.embedding', 'embedding-secret');
    const rerankRef = fixture.secrets.set('providers.rerank', 'rerank-secret');
    fixture.config.server = { host: '0.0.0.0', bindMode: 'lan', port: 4455 };
    fixture.config.workspaces = [{
      id: 'current',
      name: 'Saved Workspace',
      rootPath: fixture.root,
      mcpToolIds: ['read_only_db'],
    }];
    fixture.config.knowledge = {
      ...fixture.config.knowledge,
      rootDir: join(fixture.root, 'knowledge'),
      sourceDir: fixture.root,
      buildVectorIndex: true,
    };
    fixture.config.models.providers.minimax = {
      type: 'openai-compatible',
      baseUrl: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M3',
      apiKeyRef: agentRef,
    };
    fixture.config.agent.modelProvider = 'minimax';
    fixture.config.embedding = {
      ...embeddingFixture({ enabled: true }),
      provider: 'siliconflow',
      model: 'Qwen/Qwen3-Embedding-0.6B',
      dimensions: 1024,
      apiKeyRef: embeddingRef,
    };
    fixture.config.rerank = {
      enabled: true,
      provider: 'siliconflow',
      model: 'BAAI/bge-reranker-v2-m3',
      topN: 8,
      apiKeyRef: rerankRef,
    };

    const state = fixture.service.getState();

    assert.equal(state.draft.workspace.name, 'Saved Workspace');
    assert.equal(state.draft.workspace.rootPath, fixture.root);
    assert.equal(state.draft.knowledge.rootDir, join(fixture.root, 'knowledge'));
    assert.equal(state.draft.server.bindMode, 'lan');
    assert.equal(state.draft.server.port, 4455);
    assert.equal(state.draft.agent.providerId, 'minimax');
    assert.equal(state.draft.agent.provider.model, 'MiniMax-M3');
    assert.equal(state.draft.agent.provider.hasApiKey, true);
    assert.equal(state.draft.embedding.hasApiKey, true);
    assert.equal(state.draft.rerank.hasApiKey, true);
    assert.equal(JSON.stringify(state).includes('agent-secret'), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('service preserves existing setup secret refs when saving defaults without new keys', async () => {
  const fixture = createServiceFixture();
  try {
    const agentRef = fixture.secrets.set('providers.agent.minimax', 'agent-secret');
    const embeddingRef = fixture.secrets.set('providers.embedding', 'embedding-secret');
    const rerankRef = fixture.secrets.set('providers.rerank', 'rerank-secret');
    fixture.config.models.providers.minimax = {
      type: 'openai-compatible',
      baseUrl: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M3',
      apiKeyRef: agentRef,
    };
    fixture.config.agent.modelProvider = 'minimax';
    fixture.config.embedding = {
      ...embeddingFixture({ enabled: true }),
      provider: 'siliconflow',
      model: 'Qwen/Qwen3-Embedding-0.6B',
      dimensions: 1024,
      apiKeyRef: embeddingRef,
    };
    fixture.config.rerank = {
      enabled: true,
      provider: 'siliconflow',
      model: 'BAAI/bge-reranker-v2-m3',
      topN: 8,
      apiKeyRef: rerankRef,
    };

    await fixture.service.saveDraft({
      draft: {
        version: 1,
        workspace: { id: 'current', name: 'Saved Workspace', rootPath: fixture.root },
        knowledge: { rootDir: join(fixture.root, 'knowledge'), sourceDir: fixture.root, buildVectorIndex: true },
        server: { bindMode: 'loopback', port: 4317 },
        agent: {
          providerId: 'minimax',
          provider: {
            type: 'openai-compatible',
            baseUrl: 'https://api.minimaxi.com/v1',
            model: 'MiniMax-M3',
          },
        },
        embedding: {
          enabled: true,
          provider: 'siliconflow',
          model: 'Qwen/Qwen3-Embedding-0.6B',
          dimensions: 1024,
          distance: 'cosine',
        },
        rerank: {
          enabled: true,
          provider: 'siliconflow',
          model: 'BAAI/bge-reranker-v2-m3',
          topN: 8,
        },
      },
    });

    const saved = fixture.drafts.load();
    assert.deepEqual(saved.agent.provider.apiKeyRef, agentRef);
    assert.deepEqual(saved.embedding.apiKeyRef, embeddingRef);
    assert.deepEqual(saved.rerank.apiKeyRef, rerankRef);
    assert.equal((await fixture.service.validateDraft()).ok, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('run repository recovers interrupted runs as retryable failures', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const repository = new FileOnboardingRunRepository(root);
    repository.save({
      id: 'run_test',
      status: 'running',
      draftRevision: 1,
      currentStage: 'slice_sources',
      overallProgress: 45,
      stages: [],
      counters: {},
      startedAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });
    const recovered = repository.recoverInterrupted();
    assert.equal(recovered[0].status, 'failed');
    assert.equal(recovered[0].retryableStage, 'slice_sources');
    assert.equal(recovered[0].safeError.code, 'interrupted');
    assert.equal(repository.load('run_test').status, 'failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('service stores input secrets as refs and exposes only sanitized draft', async () => {
  const fixture = createServiceFixture();
  try {
    const state = await fixture.service.saveDraft({
      ...draftInputFixture(),
      secrets: {
        agentApiKey: 'agent-secret',
        embeddingApiKey: 'embedding-secret',
        rerankApiKey: 'rerank-secret',
      },
    });
    assert.equal(state.draft.agent.provider.hasApiKey, true);
    assert.equal(JSON.stringify(state).includes('agent-secret'), false);
    assert.equal(readFileSync(fixture.secretsPath, 'utf8').includes('agent-secret'), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('service rejects a second active onboarding run', async () => {
  const fixture = createServiceFixture({ runnerNeverCompletes: true });
  try {
    await fixture.service.saveDraft(draftInputFixture());
    await fixture.service.startRun();
    await assert.rejects(() => fixture.service.startRun(), /already active/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('runner persists real progress and commits only after health succeeds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const order = [];
    const drafts = new FileOnboardingDraftRepository(root);
    const runs = new FileOnboardingRunRepository(root);
    const progress = new OnboardingProgressHub();
    const draft = drafts.save(onboardingDraftFixture({ revision: 0 }));
    const run = createOnboardingRun({
      id: 'run_success',
      draft,
      plan: buildOnboardingPlan({
        draft,
        sourceChanges: { added: ['a.md'], changed: [], unchanged: [] },
        keywordIndexDirty: true,
        vectorCompatibility: 'missing-index',
      }),
      now: '2026-06-15T00:00:00.000Z',
    });
    runs.save(run);
    const runner = new OnboardingRunner({
      drafts,
      runs,
      progress,
      validate: async () => order.push('validate'),
      testProviders: async () => order.push('providers'),
      prepareWorkspace: async () => order.push('prepare'),
      runKnowledge: async ({ report }) => {
        order.push('knowledge');
        report({ stage: 'slice_sources', processed: 2, total: 4, message: '2/4' });
        return { draftSlices: 4 };
      },
      healthCheck: async () => (order.push('health'), { ok: true }),
      commitConfig: async () => {
        order.push('commit');
        return { ...defaultConfig(), onboarding: { version: 1, lastRunId: run.id } };
      },
      onConfigCommitted: async () => order.push('reload'),
    });
    const completed = await runner.execute(run);
    assert.equal(completed.status, 'completed');
    assert.deepEqual(order, ['validate', 'providers', 'prepare', 'knowledge', 'health', 'commit', 'reload']);
    assert.equal(runs.load(run.id).overallProgress, 100);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runner failure preserves old config and retries from failed stage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    let attempts = 0;
    const drafts = new FileOnboardingDraftRepository(root);
    const runs = new FileOnboardingRunRepository(root);
    const progress = new OnboardingProgressHub();
    const draft = drafts.save(onboardingDraftFixture({ revision: 0 }));
    const run = createOnboardingRun({
      id: 'run_retry',
      draft,
      plan: buildOnboardingPlan({
        draft,
        sourceChanges: { added: ['a.md'], changed: [], unchanged: [] },
        keywordIndexDirty: true,
        vectorCompatibility: 'missing-index',
      }),
      now: '2026-06-15T00:00:00.000Z',
    });
    runs.save(run);
    const commitCalls = [];
    const runner = new OnboardingRunner({
      drafts,
      runs,
      progress,
      validate: async () => undefined,
      testProviders: async () => ({ ok: true }),
      prepareWorkspace: async () => undefined,
      runKnowledge: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('slice failed');
        return {};
      },
      healthCheck: async () => ({ ok: true }),
      commitConfig: async () => {
        commitCalls.push('commit');
        return defaultConfig();
      },
    });
    const failed = await runner.execute(run);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.retryableStage, 'ingest_sources');
    assert.equal(commitCalls.length, 0);

    const completed = await runner.retry(failed.id);
    assert.equal(completed.status, 'completed');
    assert.equal(commitCalls.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validator reports missing workspace without blocking optional embedding credentials', () => {
  const draft = onboardingDraftFixture({
    workspace: { id: 'current', name: 'Demo', rootPath: '/does/not/exist' },
    knowledge: { buildVectorIndex: true },
    embedding: {
      ...embeddingFixture(),
      enabled: true,
      provider: 'siliconflow',
      apiKeyRef: undefined,
    },
  });
  const result = validateOnboardingDraft(draft, { resolveSecret: () => undefined });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.field === 'workspace.rootPath'));
  assert.equal(result.issues.some((issue) => issue.field === 'embedding.apiKeyRef'), false);
});

test('validator allows enabled embedding without credentials so retrieval can degrade to BM25', () => {
  const draft = onboardingDraftFixture({
    knowledge: { buildVectorIndex: true },
    embedding: {
      ...embeddingFixture(),
      enabled: true,
      provider: 'siliconflow',
      apiKeyRef: undefined,
    },
  });
  const result = validateOnboardingDraft(draft, {
    resolveSecret: (ref) => ref?.key === 'providers.agent.default' ? 'agent-secret' : undefined,
  });
  assert.equal(result.ok, true);
  assert.equal(result.issues.some((issue) => issue.field === 'embedding.apiKeyRef'), false);
});

test('planner skips unchanged sources and compatible vector artifacts', () => {
  const plan = buildOnboardingPlan({
    draft: onboardingDraftFixture({
      knowledge: { sourceDir: process.cwd(), buildVectorIndex: true },
      embedding: { enabled: true },
    }),
    sourceChanges: { added: [], changed: [], unchanged: ['a.md'] },
    keywordIndexDirty: false,
    vectorCompatibility: 'compatible',
  });
  assert.equal(plan.stage('ingest_sources').action, 'skip');
  assert.equal(plan.stage('build_keyword_index').action, 'skip');
  assert.equal(plan.stage('build_vector_index').action, 'skip');
});

test('provider test runner reports agent embedding and rerank independently', async () => {
  const calls = [];
  const result = await testOnboardingProviders(onboardingDraftFixture({
    embedding: { enabled: true },
    rerank: { enabled: true, provider: 'fake' },
  }), {
    testAgent: async () => (calls.push('agent'), {
      ok: true,
      model: 'agent',
      durationMs: 1,
    }),
    testEmbedding: async () => (calls.push('embedding'), {
      ok: true,
      model: 'embed',
      durationMs: 1,
      dimensions: 4,
      provider: 'fake',
    }),
    testRerank: async () => (calls.push('rerank'), {
      ok: true,
      model: 'rerank',
      durationMs: 1,
      provider: 'fake',
    }),
  });
  assert.deepEqual(new Set(calls), new Set(['agent', 'embedding', 'rerank']));
  assert.equal(result.ok, true);
  assert.equal(result.agent.ok, true);
});

test('provider test runner skips enabled retrieval providers when credentials are absent', async () => {
  const calls = [];
  const result = await testOnboardingProviders(onboardingDraftFixture({
    embedding: { enabled: true, provider: 'siliconflow', apiKeyRef: undefined },
    rerank: { enabled: true, provider: 'siliconflow', apiKeyRef: undefined },
  }), {
    testAgent: async () => (calls.push('agent'), {
      ok: true,
      model: 'agent',
      durationMs: 1,
      provider: 'fake',
    }),
    testEmbedding: async () => {
      throw new Error('embedding test should be skipped without credentials');
    },
    testRerank: async () => {
      throw new Error('rerank test should be skipped without credentials');
    },
  });
  assert.deepEqual(calls, ['agent']);
  assert.equal(result.ok, true);
  assert.equal(result.embedding.skipped, true);
  assert.equal(result.embedding.reason, 'missing_credentials');
  assert.equal(result.rerank.skipped, true);
  assert.equal(result.rerank.reason, 'missing_credentials');
});

test('knowledge pipeline reports real file and slice counts', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-pipeline-'));
  const sourceDir = mkdtempSync(join(tmpdir(), 'super-helper-sources-'));
  try {
    writeFileSync(
      join(sourceDir, 'a.md'),
      '# 账号登录排查\n\n当学员反馈账号无法登录时，需要先确认账号状态、密码错误次数、浏览器缓存和服务端认证日志；如果账号被锁定，运营应记录证据并引导用户完成密码重置。',
      'utf8',
    );
    writeFileSync(
      join(sourceDir, 'b.md'),
      '# 课程退款处理\n\n当学员申请课程退款时，需要检查订单支付状态、课程观看进度、退款窗口和售后凭证；如果满足规则，运营应提交退款记录并通知学员处理结果。',
      'utf8',
    );
    const events = [];
    const result = await runOnboardingKnowledgePipeline({
      draft: onboardingDraftFixture({
        knowledge: { rootDir: workspaceRoot, sourceDir, buildVectorIndex: false },
      }),
      workspaceRoot,
      report: (event) => events.push(event),
    });
    assert.ok(events.some((event) =>
      event.stage === 'ingest_sources' && event.processed === 2 && event.total === 2));
    assert.ok(events.some((event) => event.stage === 'audit_slices'));
    assert.ok(events.some((event) => event.stage === 'publish_approved'));
    assert.ok(result.draftSlices >= 2);
    assert.ok(result.approvedSlices >= 2);
    assert.equal(result.pendingReviewSlices, 0);
    assert.equal(result.blockedSlices, 0);
    assert.ok(result.publishedSlices >= 2);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('knowledge pipeline reports vector build batch progress', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-pipeline-vector-'));
  const sourceDir = mkdtempSync(join(tmpdir(), 'super-helper-sources-vector-'));
  try {
    writeFileSync(
      join(sourceDir, 'vector.md'),
      '# 课程访问排查\n\n当学员反馈课程无法访问时，需要检查课程发布状态、班级授权、订单支付状态和浏览器缓存；如果授权缺失，运营应补充授权记录并通知学员重新进入课程。',
      'utf8',
    );
    const events = [];
    const result = await runOnboardingKnowledgePipeline({
      draft: onboardingDraftFixture({
        knowledge: { rootDir: workspaceRoot, sourceDir, buildVectorIndex: true },
        embedding: { enabled: true, provider: 'fake', model: 'fake-vector', dimensions: 4, distance: 'cosine', batchSize: 1 },
      }),
      workspaceRoot,
      report: (event) => events.push(event),
    });

    const vectorEvents = events.filter((event) => event.stage === 'build_vector_index');
    assert.ok(vectorEvents.length >= 1);
    assert.deepEqual(
      { processed: vectorEvents.at(-1).processed, total: vectorEvents.at(-1).total },
      { processed: result.vectorCount, total: result.vectorCount },
    );
    assert.ok(result.vectorCount >= 1);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('knowledge pipeline skips vector build when default embedding credentials are absent', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-pipeline-no-embedding-key-'));
  const sourceDir = mkdtempSync(join(tmpdir(), 'super-helper-sources-no-embedding-key-'));
  try {
    writeFileSync(
      join(sourceDir, 'vector.md'),
      '# 课程访问排查\n\n当学员反馈课程无法访问时，需要检查课程发布状态、班级授权、订单支付状态和浏览器缓存。',
      'utf8',
    );
    const events = [];
    const result = await runOnboardingKnowledgePipeline({
      draft: onboardingDraftFixture({
        knowledge: { rootDir: workspaceRoot, sourceDir, buildVectorIndex: true },
        embedding: {
          enabled: true,
          provider: 'siliconflow',
          model: 'Qwen/Qwen3-Embedding-0.6B',
          dimensions: 1024,
          distance: 'cosine',
          apiKeyRef: undefined,
        },
      }),
      workspaceRoot,
      report: (event) => events.push(event),
    });

    const vectorEvent = events.find((event) => event.stage === 'build_vector_index');
    assert.equal(result.vectorCount, 0);
    assert.match(vectorEvent?.message ?? '', /credentials unavailable/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('one dashboard run configures providers, publishes clean knowledge, and commits config', async () => {
  const fixture = await fullOnboardingFixture({
    sources: {
      'login.md': [
        '# 账号登录排查',
        '',
        '当学员反馈账号无法登录时，需要先确认账号状态、密码错误次数、浏览器缓存和服务端认证日志；如果账号被锁定，运营应记录证据并引导用户完成密码重置。',
      ].join('\n'),
      'refund.md': [
        '# 课程退款处理',
        '',
        '当学员申请课程退款时，需要检查订单支付状态、课程观看进度、退款窗口和售后凭证；如果满足规则，运营应提交退款记录并通知学员处理结果。',
      ].join('\n'),
    },
  });
  try {
    await fixture.saveDraft();
    const run = await fixture.startAndWait();
    assert.equal(run.status, 'completed', run.safeError?.message);
    assert.equal(run.overallProgress, 100);
    assert.ok(run.counters.indexedDocuments >= 1);
    assert.ok(run.counters.indexedChunks >= 1);
    assert.ok(run.counters.vectorCount >= 1);

    const configJson = readFileSync(fixture.configPath, 'utf8');
    assert.equal(JSON.parse(configJson).onboarding.lastRunId, run.id);
    assert.doesNotMatch(configJson, /fixture-secret/);
    assert.equal(existsSync(manifestPath(fixture.knowledgeWorkspace)), true);
    assert.equal(existsSync(chunksPath(fixture.knowledgeWorkspace)), true);
    assert.equal(existsSync(vectorManifestPath(fixture.knowledgeWorkspace)), true);
  } finally {
    await fixture.close();
  }
});

test('dashboard review accepts warning slices before starting daily use', async () => {
  const fixture = await fullOnboardingFixture({
    sources: {
      'short.md': '# 短切片\n\n内容较短。',
    },
  });
  try {
    await fixture.saveDraft();
    const run = await fixture.startAndWait();
    assert.equal(run.status, 'completed', run.safeError?.message);
    assert.equal(run.counters.pendingReviewSlices, 1);

    const pending = fixture.getReviewState();
    assert.equal(pending.required, true);
    assert.equal(pending.pendingCount, 1);

    const reviewed = await fixture.submitReview({
      action: 'accept_warnings',
      reviewer: 'tester',
      notes: 'accepted warning slice in regression test',
    });
    assert.equal(reviewed.review.required, false);
    assert.equal(reviewed.publishedSlices, 1);
    assert.ok(reviewed.indexedDocuments >= 1);

    const state = fixture.getState();
    assert.equal(state.completed, true);
    assert.equal(state.needsReview, false);
    assert.equal(state.latestRun.counters.pendingReviewSlices, 0);
  } finally {
    await fixture.close();
  }
});

test('dashboard review state supports pagination, search, and issue explanations', async () => {
  const fixture = await fullOnboardingFixture({
    sources: {
      'login-short.md': '# 登录短切片\n\n内容较短。',
      'refund-short.md': '# 退款短切片\n\n内容较短。',
    },
  });
  try {
    await fixture.saveDraft();
    const run = await fixture.startAndWait();
    assert.equal(run.status, 'completed', run.safeError?.message);

    const firstPage = fixture.getReviewState({ offset: 0, limit: 1, severity: 'warn' });
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.page.offset, 0);
    assert.equal(firstPage.page.limit, 1);
    assert.equal(firstPage.page.returned, 1);
    assert.equal(firstPage.page.total, 2);
    assert.equal(firstPage.page.hasMore, true);

    const issue = firstPage.items[0].issues.find((item) => item.code === 'not_answer_bearing')
      ?? firstPage.items[0].issues[0];
    assert.ok(issue.explanation.reason.includes('原因'));
    if (issue.code === 'not_answer_bearing') {
      assert.equal(issue.explanation.reason, '原因：这段内容没有可直接回答用户问题的完整句子。');
    }
    assert.ok(issue.explanation.impact.includes('影响'));
    assert.ok(issue.explanation.suggestion.includes('建议'));
    assert.ok(Array.isArray(issue.explanation.missingInfo));
    assert.ok(issue.explanation.missingInfo.length >= 1);

    const searchResult = fixture.getReviewState({ offset: 0, limit: 20, search: '登录' });
    assert.equal(searchResult.items.length, 1);
    assert.match(searchResult.items[0].title, /登录/);
  } finally {
    await fixture.close();
  }
});

test('dashboard review publishes only selected warning slices', async () => {
  const fixture = await fullOnboardingFixture({
    sources: {
      'login-short.md': '# 登录短切片\n\n内容较短。',
      'refund-short.md': '# 退款短切片\n\n内容较短。',
    },
  });
  try {
    await fixture.saveDraft();
    const run = await fixture.startAndWait();
    assert.equal(run.status, 'completed', run.safeError?.message);

    const pending = fixture.getReviewState({ offset: 0, limit: 20 });
    assert.equal(pending.pendingCount, 2);

    const reviewed = await fixture.submitReview({
      action: 'accept_warnings',
      reviewer: 'tester',
      notes: '只发布选中的登录切片',
      ids: [pending.items[0].id],
    });
    assert.equal(reviewed.publishedSlices, 1);
    assert.equal(reviewed.review.pendingCount, 1);
    assert.equal(reviewed.review.items.length, 1);
    assert.notEqual(reviewed.review.items[0].id, pending.items[0].id);
  } finally {
    await fixture.close();
  }
});
