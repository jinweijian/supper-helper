import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { defaultConfig, getEmbeddingConfig, isEmbeddingEnabled } from '../dist/config.js';
import {
  FakeEmbeddingProvider,
  createEmbeddingProvider,
  embeddingConfigFingerprint,
  isEmbeddingManifestCompatible,
  runEmbeddingSmokeTest,
} from '../dist/providers/embedding/index.js';
import {
  createRerankProvider,
  runRerankSmokeTest,
} from '../dist/providers/rerank/index.js';
import {
  EmbeddingProviderError,
  isEmbeddingProviderError,
  redactEmbeddingErrorMessage,
} from '../dist/providers/errors.js';

test('default config keeps embedding enabled by default with graceful degradation and independent from agent model providers', () => {
  const config = defaultConfig();

  assert.equal(config.embedding.enabled, true);
  assert.equal(config.embedding.provider, 'siliconflow');
  assert.equal(config.embedding.model, 'Qwen/Qwen3-Embedding-0.6B');
  assert.equal(config.embedding.baseUrl, 'https://api.siliconflow.cn/v1');
  assert.equal(config.embedding.apiKeyEnv, 'SILICONFLOW_API_KEY');
  assert.equal(config.embedding.dimensions, 1024);
  assert.equal(config.embedding.distance, 'cosine');
  assert.equal(isEmbeddingEnabled(config), true);
  assert.equal(config.knowledge.buildVectorIndex, true);
  assert.deepEqual(config.knowledge.chunking, {
    maxChars: 800,
    overlapStrategy: 'sentence',
    overlapChars: 120,
    minChars: 80,
  });
  assert.equal(getEmbeddingConfig(config).provider, 'siliconflow');

  config.models.providers.agent = {
    type: 'openai-compatible',
    baseUrl: 'https://model.example.test/v1',
    model: 'chat-model',
    apiKeyEnv: 'MODEL_API_KEY',
  };
  config.agent.modelProvider = 'agent';
  config.embedding = {
    ...config.embedding,
    enabled: true,
    provider: 'fake',
    model: 'fake-embedding',
    dimensions: 8,
  };

  assert.equal(config.agent.modelProvider, 'agent');
  assert.equal(config.embedding.provider, 'fake');
});

test('fake embedding provider returns deterministic vectors with stable metadata', async () => {
  const provider = new FakeEmbeddingProvider({
    provider: 'fake',
    model: 'fake-embedding-v1',
    dimensions: 6,
    distance: 'cosine',
  });

  const first = await provider.embedDocuments([
    { id: 'chunk_a', text: '课程必须发布后学员端才可见', contentHash: 'hash-a' },
    { id: 'chunk_b', text: '学习日晚上8点未完成任务会提醒', contentHash: 'hash-b' },
  ]);
  const second = await provider.embedDocuments([
    { id: 'chunk_a', text: '课程必须发布后学员端才可见', contentHash: 'hash-a' },
  ]);
  const query = await provider.embedQuery({ id: 'query_1', text: '晚上8点提醒规则' });

  assert.equal(first.results.length, 2);
  assert.equal(first.results[0].id, 'chunk_a');
  assert.equal(first.results[0].provider, 'fake');
  assert.equal(first.results[0].model, 'fake-embedding-v1');
  assert.equal(first.results[0].dimensions, 6);
  assert.equal(first.results[0].distance, 'cosine');
  assert.equal(first.results[0].vector.length, 6);
  assert.deepEqual(first.results[0].vector, second.results[0].vector);
  assert.equal(query.id, 'query_1');
  assert.equal(query.vector.length, 6);
  assert.equal(first.usage?.providerRequestCount, 1);
});

test('provider factory validates config and keeps unsupported providers safe', async () => {
  assert.throws(
    () => createEmbeddingProvider({
      enabled: true,
      provider: 'unknown',
      model: 'x',
      dimensions: 3,
      distance: 'cosine',
    }),
    (error) => isEmbeddingProviderError(error) && error.code === 'unsupported_provider',
  );

  assert.throws(
    () => createEmbeddingProvider({
      enabled: true,
      provider: 'fake',
      model: 'fake',
      dimensions: 0,
      distance: 'cosine',
    }),
    (error) => isEmbeddingProviderError(error) && error.code === 'invalid_request',
  );

  const qwen = createEmbeddingProvider({
    enabled: true,
    provider: 'qwen',
    model: 'text-embedding-v4',
    dimensions: 4,
    distance: 'cosine',
  });
  await assert.rejects(
    () => qwen.embedQuery({ text: 'reserved provider' }),
    (error) => isEmbeddingProviderError(error) && error.code === 'unsupported_provider',
  );
});

test('siliconflow provider sends official embedding request and maps response metadata', async () => {
  const requests = [];
  const provider = createEmbeddingProvider({
    enabled: true,
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-Embedding-0.6B',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: 'sk-test-secret',
    dimensions: 4,
    distance: 'cosine',
    batchSize: 2,
  }, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      const body = JSON.parse(String(init.body));
      const input = Array.isArray(body.input) ? body.input : [body.input];
      return new Response(JSON.stringify({
        object: 'list',
        model: body.model,
        data: input.map((_, index) => ({
          object: 'embedding',
          index,
          embedding: [index + 0.1, index + 0.2, index + 0.3, index + 0.4],
        })),
        usage: { prompt_tokens: 12, total_tokens: 12 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await provider.embedDocuments([
    { id: 'a', text: '第一段', contentHash: 'hash-a' },
    { id: 'b', text: '第二段', contentHash: 'hash-b' },
    { id: 'c', text: '第三段', contentHash: 'hash-c' },
  ]);
  const query = await provider.embedQuery({ id: 'q1', text: '查询' });

  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://api.siliconflow.cn/v1/embeddings');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer sk-test-secret');
  assert.equal(JSON.parse(String(requests[0].init.body)).model, 'Qwen/Qwen3-Embedding-0.6B');
  assert.deepEqual(JSON.parse(String(requests[0].init.body)).input, ['第一段', '第二段']);
  assert.equal(JSON.parse(String(requests[0].init.body)).dimensions, 4);
  assert.equal(result.provider, 'siliconflow');
  assert.equal(result.results.length, 3);
  assert.equal(result.results[2].id, 'c');
  assert.equal(result.results[2].contentHash, 'hash-c');
  assert.deepEqual(result.results[2].vector, [0.1, 0.2, 0.3, 0.4]);
  assert.equal(result.usage.providerRequestCount, 2);
  assert.equal(result.usage.inputTokens, 24);
  assert.equal(query.id, 'q1');
  assert.equal(query.vector.length, 4);
});

test('siliconflow provider normalizes credentials, provider, malformed, and dimension errors safely', async () => {
  const missing = createEmbeddingProvider({
    enabled: true,
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-Embedding-0.6B',
    dimensions: 4,
    distance: 'cosine',
  });
  await assert.rejects(
    () => missing.embedQuery({ text: 'hello' }),
    (error) => isEmbeddingProviderError(error) && error.code === 'missing_credentials',
  );

  const providerError = createEmbeddingProvider({
    enabled: true,
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-Embedding-0.6B',
    apiKey: 'sk-secret-provider-error',
    dimensions: 4,
    distance: 'cosine',
  }, {
    fetch: async () => new Response(JSON.stringify({ message: 'Authorization: Bearer sk-secret-provider-error failed' }), { status: 429 }),
  });
  await assert.rejects(
    () => providerError.embedQuery({ text: 'hello' }),
    (error) => (
      isEmbeddingProviderError(error) &&
      error.code === 'rate_limited' &&
      error.retryable === true &&
      !String(error.safeMessage).includes('sk-secret-provider-error')
    ),
  );

  const nonJsonServerError = createEmbeddingProvider({
    enabled: true,
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-Embedding-0.6B',
    apiKey: 'sk-secret',
    dimensions: 4,
    distance: 'cosine',
  }, {
    fetch: async () => new Response('upstream overloaded', { status: 503 }),
  });
  await assert.rejects(
    () => nonJsonServerError.embedQuery({ text: 'hello' }),
    (error) => (
      isEmbeddingProviderError(error) &&
      error.code === 'provider_error' &&
      error.status === 503 &&
      error.retryable === true
    ),
  );

  const malformed = createEmbeddingProvider({
    enabled: true,
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-Embedding-0.6B',
    apiKey: 'sk-secret',
    dimensions: 4,
    distance: 'cosine',
  }, {
    fetch: async () => new Response(JSON.stringify({ data: [{ index: 0 }] }), { status: 200 }),
  });
  await assert.rejects(
    () => malformed.embedQuery({ text: 'hello' }),
    (error) => isEmbeddingProviderError(error) && error.code === 'malformed_response',
  );

  const partial = createEmbeddingProvider({
    enabled: true,
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-Embedding-0.6B',
    apiKey: 'sk-secret',
    dimensions: 4,
    distance: 'cosine',
  }, {
    fetch: async () => new Response(JSON.stringify({
      model: 'Qwen/Qwen3-Embedding-0.6B',
      data: [{ index: 0, embedding: [1, 2, 3, 4] }],
      usage: { total_tokens: 1 },
    }), { status: 200 }),
  });
  await assert.rejects(
    () => partial.embedDocuments([
      { id: 'a', text: 'hello a' },
      { id: 'b', text: 'hello b' },
    ]),
    (error) => isEmbeddingProviderError(error) && error.code === 'malformed_response',
  );

  const mismatch = createEmbeddingProvider({
    enabled: true,
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-Embedding-0.6B',
    apiKey: 'sk-secret',
    dimensions: 4,
    distance: 'cosine',
  }, {
    fetch: async () => new Response(JSON.stringify({
      model: 'Qwen/Qwen3-Embedding-0.6B',
      data: [{ index: 0, embedding: [1, 2] }],
      usage: { total_tokens: 1 },
    }), { status: 200 }),
  });
  await assert.rejects(
    () => mismatch.embedQuery({ text: 'hello' }),
    (error) => isEmbeddingProviderError(error) && error.code === 'dimension_mismatch',
  );
});

test('embedding smoke test handles disabled config and hides raw vectors', async () => {
  let fetchCalled = false;
  const disabled = await runEmbeddingSmokeTest({
    config: {
      enabled: false,
      provider: 'siliconflow',
      model: 'Qwen/Qwen3-Embedding-0.6B',
      apiKey: 'sk-secret',
      dimensions: 4,
      distance: 'cosine',
    },
    fetch: async () => {
      fetchCalled = true;
      throw new Error('should not call fetch');
    },
  });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, 'disabled');
  assert.equal(fetchCalled, false);

  const success = await runEmbeddingSmokeTest({
    config: {
      enabled: true,
      provider: 'siliconflow',
      model: 'Qwen/Qwen3-Embedding-0.6B',
      apiKey: 'sk-secret',
      dimensions: 4,
      distance: 'cosine',
    },
    fetch: async () => new Response(JSON.stringify({
      model: 'Qwen/Qwen3-Embedding-0.6B',
      data: [{ index: 0, embedding: [1, 2, 3, 4] }],
      usage: { total_tokens: 2 },
    }), { status: 200 }),
  });
  assert.equal(success.ok, true);
  assert.equal(success.provider, 'siliconflow');
  assert.equal(success.model, 'Qwen/Qwen3-Embedding-0.6B');
  assert.equal(success.dimensions, 4);
  assert.equal(JSON.stringify(success).includes('[1,2,3,4]'), false);
});

test('rerank smoke maps non-json provider failures by status without leaking payloads', async () => {
  const result = await runRerankSmokeTest({
    config: {
      enabled: true,
      provider: 'siliconflow',
      model: 'BAAI/bge-reranker-v2-m3',
      apiKey: 'sk-secret',
    },
    fetch: async () => new Response('Authorization: Bearer sk-secret failed', { status: 503 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'provider_error');
  assert.equal(result.error.status, 503);
  assert.equal(result.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(result), /sk-secret/);
});

test('siliconflow rerank provider maps document ids without leaking request text', async () => {
  const requests = [];
  const provider = createRerankProvider({
    enabled: true,
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-Reranker-8B',
    apiKey: 'sk-rerank-secret',
    topN: 2,
  }, {
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        results: [
          { index: 1, relevance_score: 0.91 },
          { index: 0, relevance_score: 0.42 },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await provider.rerank({
    query: '登录失败',
    documents: [
      { id: 'doc_a', text: '普通登录说明' },
      { id: 'doc_b', text: '登录失败排查步骤' },
    ],
    topN: 2,
  });

  assert.equal(requests[0].model, 'Qwen/Qwen3-Reranker-8B');
  assert.deepEqual(requests[0].documents, ['普通登录说明', '登录失败排查步骤']);
  assert.deepEqual(result.results.map((item) => item.id), ['doc_b', 'doc_a']);
  assert.equal(result.results[0].score, 0.91);
  assert.doesNotMatch(JSON.stringify(result), /登录失败排查步骤|sk-rerank-secret/);
});

test('siliconflow adapters normalize timeout, rate limit, server, malformed, and bad-index failures', async () => {
  const abortingFetch = async (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const embeddingTimeout = createEmbeddingProvider({
    enabled: true,
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-Embedding-0.6B',
    apiKey: 'sk-timeout-secret',
    dimensions: 4,
    distance: 'cosine',
    timeoutMs: 1,
  }, { fetch: abortingFetch });
  await assert.rejects(
    () => embeddingTimeout.embedQuery({ text: 'timeout' }),
    (error) => error.code === 'timeout' && !String(error.safeMessage).includes('sk-timeout-secret'),
  );

  const rerankConfig = {
    enabled: true,
    provider: 'siliconflow',
    model: 'BAAI/bge-reranker-v2-m3',
    apiKey: 'sk-rerank-secret',
    topN: 2,
  };
  const request = {
    query: '登录失败',
    documents: [{ id: 'doc_a', text: '登录排查' }],
  };
  const missing = createRerankProvider({ ...rerankConfig, apiKey: undefined });
  await assert.rejects(() => missing.rerank(request), (error) => error.code === 'missing_credentials');

  for (const [status, code, retryable] of [[429, 'rate_limited', true], [503, 'provider_error', true]]) {
    const provider = createRerankProvider(rerankConfig, {
      fetch: async () => new Response('Authorization: Bearer sk-rerank-secret failed', { status }),
    });
    await assert.rejects(
      () => provider.rerank(request),
      (error) => error.code === code && error.retryable === retryable && !String(error.safeMessage).includes('sk-rerank-secret'),
    );
  }

  const malformed = createRerankProvider(rerankConfig, {
    fetch: async () => new Response(JSON.stringify({ results: [{}] }), { status: 200 }),
  });
  await assert.rejects(() => malformed.rerank(request), (error) => error.code === 'malformed_response');

  const badIndex = createRerankProvider(rerankConfig, {
    fetch: async () => new Response(JSON.stringify({ results: [{ index: 9, relevance_score: 0.9 }] }), { status: 200 }),
  });
  await assert.rejects(() => badIndex.rerank(request), (error) => error.code === 'malformed_response');

  const rerankTimeout = createRerankProvider({ ...rerankConfig, timeoutMs: 1 }, { fetch: abortingFetch });
  await assert.rejects(() => rerankTimeout.rerank(request), (error) => error.code === 'timeout');
});

test('minimax provider is docs-gated and does not guess network calls', async () => {
  let fetchCalled = false;
  const provider = createEmbeddingProvider({
    enabled: true,
    provider: 'minimax',
    model: 'minimax-embedding-placeholder',
    dimensions: 4,
    distance: 'cosine',
    apiKey: 'secret-token-should-not-leak',
  }, {
    fetch: async () => {
      fetchCalled = true;
      throw new Error('network should not be called');
    },
  });

  await assert.rejects(
    () => provider.embedQuery({ text: 'hello' }),
    (error) => (
      isEmbeddingProviderError(error) &&
      error.code === 'docs_required' &&
      !String(error.safeMessage).includes('secret-token-should-not-leak') &&
      !String(error.message).includes('secret-token-should-not-leak')
    ),
  );
  assert.equal(fetchCalled, false);
});

test('embedding CLI reports disabled state without calling network', () => {
  const home = mkdtempSync(join(tmpdir(), 'super-helper-embedding-cli-'));
  writeFileSync(join(home, 'config.json'), `${JSON.stringify({ ...defaultConfig(), embedding: { ...defaultConfig().embedding, enabled: false } }, null, 2)}\n`);
  const result = spawnSync(process.execPath, [
    'dist/cli.js',
    'embedding',
    'test',
    '--home',
    home,
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /embedding disabled/);
  assert.doesNotMatch(result.stdout, /embedding:/);
});

test('provider CLI materializes file SecretRefs before smoke tests', async () => {
  const home = mkdtempSync(join(tmpdir(), 'super-helper-provider-secret-cli-'));
  const config = defaultConfig();
  config.storage.rootDir = home;
  config.knowledge.rootDir = join(home, 'knowledge');
  config.embedding.apiKeyRef = { source: 'file', key: 'providers.embedding' };
  writeFileSync(join(home, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(home, 'secrets.json'), `${JSON.stringify({
    version: 1,
    values: { 'providers.embedding': 'file-secret-value' },
  }, null, 2)}\n`);
  const { loadProviderCommandConfig } = await import('../dist/cli/command-provider.js');

  const loaded = loadProviderCommandConfig(home);

  assert.equal(loaded.embedding.apiKey, 'file-secret-value');
  assert.equal(loaded.embedding.apiKeyRef.key, 'providers.embedding');
});

test('provider CLI --home is read-only and cannot follow an embedded external storage root', async () => {
  const home = mkdtempSync(join(tmpdir(), 'super-helper-provider-home-boundary-'));
  const outside = mkdtempSync(join(tmpdir(), 'super-helper-provider-outside-boundary-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = outside;
    config.embedding.enabled = false;
    writeFileSync(join(home, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(join(outside, 'config.json'), '{"sentinel":"unchanged"}\n');
    const { loadProviderCommandConfig } = await import('../dist/cli/command-provider.js');

    const loaded = loadProviderCommandConfig(home);

    assert.equal(loaded.storage.rootDir, home);
    assert.equal(readFileSync(join(outside, 'config.json'), 'utf8'), '{"sentinel":"unchanged"}\n');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('embedding error helpers redact secrets from nested values', () => {
  const error = new EmbeddingProviderError({
    provider: 'minimax',
    code: 'provider_error',
    retryable: false,
    status: 401,
    safeMessage: 'Authorization: Bearer sk-test-secret cookie=sessionid token=abc1234567890',
    cause: {
      apiKey: 'sk-test-secret',
      headers: { Authorization: 'Bearer another-secret', cookie: 'sid=private' },
    },
  });

  const redacted = redactEmbeddingErrorMessage(error);

  assert.match(redacted, /\[REDACTED\]/);
  assert.doesNotMatch(redacted, /sk-test-secret/);
  assert.doesNotMatch(redacted, /another-secret/);
  assert.doesNotMatch(redacted, /sid=private/);
});

test('embedding metadata fingerprint excludes secrets and compatibility reports mismatches', () => {
  const config = {
    enabled: true,
    provider: 'fake',
    model: 'fake-embedding-v1',
    dimensions: 6,
    distance: 'cosine',
    apiKey: 'secret-value',
    endpoint: 'https://example.test/embed',
  };

  const fingerprint = embeddingConfigFingerprint(config);
  assert.match(fingerprint, /fake/);
  assert.match(fingerprint, /fake-embedding-v1/);
  assert.doesNotMatch(fingerprint, /secret-value/);

  assert.equal(isEmbeddingManifestCompatible({
    provider: 'fake',
    model: 'fake-embedding-v1',
    dimensions: 6,
    distance: 'cosine',
  }, config).compatible, true);

  const mismatch = isEmbeddingManifestCompatible({
    provider: 'fake',
    model: 'other-model',
    dimensions: 6,
    distance: 'cosine',
  }, config);
  assert.equal(mismatch.compatible, false);
  assert.deepEqual(mismatch.mismatches, ['model']);
});
