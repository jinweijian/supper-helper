import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { buildKnowledgeVectorIndex } from '../dist/knowledge/index.js';
import {
  publishKnowledgeGeneration,
  readActiveKnowledgeGeneration,
} from '../dist/knowledge/generation-store.js';
import {
  createBm25RecallStrategy,
  createEmbeddingRecallStrategy,
  createProviderReranker,
  createRetrievalService,
} from '../dist/retrieval/index.js';
import { defaultConfig } from '../dist/config.js';
import { createEmbeddingProvider } from '../dist/providers/embedding/index.js';

function tempWorkspace() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-retrieval-'));
  const indexesRoot = join(workspaceRoot, 'knowledge', 'indexes');
  mkdirSync(indexesRoot, { recursive: true });
  return { workspaceRoot, indexesRoot };
}

let generationSequence = 0;

function writeChunks(indexesRoot, chunks) {
  const workspaceRoot = dirname(dirname(indexesRoot));
  const activeGeneration = readActiveKnowledgeGeneration(workspaceRoot);
  generationSequence += 1;
  publishKnowledgeGeneration({
    workspaceRoot,
    files: {
      'chunks.jsonl': chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + '\n',
      'manifest.json': `${JSON.stringify({ version: 1, chunk_count: chunks.length })}\n`,
      'keyword-index.json': '{}\n',
    },
    mode: 'bm25_only',
    expectedActiveGenerationId: activeGeneration?.generation_id,
    generationId: `gen_fixture_${generationSequence}`,
  });
}

function baseChunk(overrides) {
  return {
    chunk_id: overrides.chunk_id,
    parent_id: overrides.parent_id ?? overrides.chunk_id.replace(/^chk_/, 'doc_'),
    source: overrides.source ?? `knowledge/faq/${overrides.chunk_id}.md`,
    module: overrides.module ?? 'general',
    intent: overrides.intent ?? 'how_to',
    source_type: overrides.source_type ?? 'faq',
    status: overrides.status ?? 'active',
    confidence: overrides.confidence ?? 'high',
    visibility: overrides.visibility ?? 'internal',
    headings: overrides.headings ?? [],
    keywords: overrides.keywords ?? [],
    text: overrides.text,
    artifact_version: 4,
    chunking_strategy: 'parent-child-v4',
    legacy: false,
    child_order: overrides.child_order ?? 1,
    source_block_ids: overrides.source_block_ids ?? ['blk_test'],
    section_path: overrides.section_path ?? ['测试'],
    quality_status: overrides.quality_status ?? 'ok',
  };
}

function snapshotFiles(root, prefix = '') {
  return Object.fromEntries(readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    const key = prefix ? `${prefix}/${name}` : name;
    const stat = statSync(path);
    return stat.isDirectory()
      ? Object.entries(snapshotFiles(path, key))
      : [[key, { size: stat.size, mtimeMs: stat.mtimeMs }]];
  }));
}

test('BM25-only retrieval recalls local chunks without embedding provider', async () => {
  const { workspaceRoot, indexesRoot } = tempWorkspace();
  try {
    writeChunks(indexesRoot, [
      baseChunk({
        chunk_id: 'chk_reminder',
        keywords: ['reminder', 'deadline'],
        text: 'Learning day deadline reminders are sent at 8pm when tasks are incomplete.',
      }),
      baseChunk({
        chunk_id: 'chk_invoice',
        keywords: ['invoice'],
        text: 'Invoices are exported from the billing workspace after reconciliation.',
      }),
    ]);

    const service = createRetrievalService({
      strategies: [createBm25RecallStrategy()],
    });
    const result = await service.retrieve({
      workspaceRoot,
      query: 'when does the 8pm task reminder happen',
      limit: 2,
    });

    assert.equal(result.candidates[0].chunkId, 'chk_reminder');
    assert.equal(result.trace.strategies.find((item) => item.id === 'bm25')?.status, 'ran');
    assert.equal(result.trace.rerank.status, 'skipped');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('normal retrieval performs zero writes in the knowledge workspace', async () => {
  const { workspaceRoot, indexesRoot } = tempWorkspace();
  try {
    writeChunks(indexesRoot, [
      baseChunk({
        chunk_id: 'chk_read_only',
        text: 'Read only retrieval returns this canonical body.',
      }),
    ]);
    const before = snapshotFiles(join(workspaceRoot, 'knowledge'));
    const service = createRetrievalService({ strategies: [createBm25RecallStrategy()] });
    await service.retrieve({
      workspaceRoot,
      query: 'read only retrieval canonical body',
      limit: 1,
    });
    assert.deepEqual(snapshotFiles(join(workspaceRoot, 'knowledge')), before);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('embedding-only retrieval uses vector artifacts and query embedding provider', async () => {
  const { workspaceRoot, indexesRoot } = tempWorkspace();
  try {
    writeChunks(indexesRoot, [
      baseChunk({
        chunk_id: 'chk_vector_target',
        text: 'Surface wording alpha should still be selected by semantic vector.',
      }),
      baseChunk({
        chunk_id: 'chk_vector_other',
        text: 'Surface wording beta should rank lower for this semantic query.',
      }),
    ]);
    const provider = directionalEmbeddingProvider('chk_vector_target');
    const embeddingConfig = {
      enabled: true,
      provider: 'fake',
      model: provider.model,
      dimensions: provider.dimensions,
      distance: provider.distance,
    };
    await buildKnowledgeVectorIndex({ workspaceRoot, provider, config: embeddingConfig });

    const service = createRetrievalService({
      strategies: [createEmbeddingRecallStrategy({ provider, embeddingConfig })],
    });
    const result = await service.retrieve({
      workspaceRoot,
      query: 'semantic target query',
      limit: 2,
    });

    assert.equal(result.candidates[0].chunkId, 'chk_vector_target');
    assert.equal(result.trace.strategies.find((item) => item.id === 'embedding')?.status, 'ran');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('retrieval service fuses enabled strategies, skips disabled strategies, and falls back from failures', async () => {
  const service = createRetrievalService({
    strategies: [
      stubStrategy({
        id: 'bm25',
        kind: 'lexical',
        candidates: [
          stubCandidate('chk_a', 0.9),
          stubCandidate('chk_b', 0.7),
        ],
      }),
      stubStrategy({
        id: 'embedding',
        kind: 'semantic',
        candidates: [
          stubCandidate('chk_a', 0.95),
          stubCandidate('chk_c', 0.8),
        ],
      }),
      stubStrategy({ id: 'business', kind: 'business', enabled: false, reason: 'not configured' }),
      stubStrategy({ id: 'unstable', kind: 'business', fail: true }),
    ],
  });

  const result = await service.retrieve({
    workspaceRoot: '/tmp/not-used',
    query: 'fusion query',
    limit: 3,
  });

  assert.deepEqual(result.candidates.map((item) => item.chunkId), ['chk_a', 'chk_b', 'chk_c']);
  assert.deepEqual(
    result.candidates[0].strategyScores.map((item) => item.strategyId).sort(),
    ['bm25', 'embedding'],
  );
  assert.equal(result.trace.strategies.find((item) => item.id === 'business')?.status, 'skipped');
  assert.equal(result.trace.strategies.find((item) => item.id === 'unstable')?.status, 'failed');
  assert.equal(result.trace.fusion.method, 'rrf');
  assert.equal(result.trace.fusion.dedupedCount, 1);
});

test('retrieval service pins one active knowledge generation for every recall strategy in a request', async () => {
  const { workspaceRoot } = tempWorkspace();
  const files = {
    'chunks.jsonl': '',
    'manifest.json': '{"version":1,"chunk_count":0}\n',
    'keyword-index.json': '{}\n',
  };
  const seenGenerationIds = [];
  try {
    publishKnowledgeGeneration({
      workspaceRoot,
      files,
      mode: 'bm25_only',
      generationId: 'gen_one',
    });
    const service = createRetrievalService({
      strategies: [
        {
          id: 'activate-next',
          kind: 'lexical',
          enabled: () => true,
          async recall(input) {
            seenGenerationIds.push(input.knowledgeGenerationId);
            publishKnowledgeGeneration({
              workspaceRoot,
              files,
              mode: 'bm25_only',
              expectedActiveGenerationId: 'gen_one',
              generationId: 'gen_two',
            });
            return { candidates: [] };
          },
        },
        {
          id: 'observe-pinned',
          kind: 'semantic',
          enabled: () => true,
          async recall(input) {
            seenGenerationIds.push(input.knowledgeGenerationId);
            return { candidates: [] };
          },
        },
      ],
    });

    await service.retrieve({ workspaceRoot, query: 'generation pin' });

    assert.deepEqual(seenGenerationIds, ['gen_one', 'gen_one']);
    assert.equal(readActiveKnowledgeGeneration(workspaceRoot)?.generation_id, 'gen_two');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('retrieval service applies optional rerank only after fusion', async () => {
  const seenByReranker = [];
  const service = createRetrievalService({
    strategies: [
      stubStrategy({
        id: 'bm25',
        kind: 'lexical',
        candidates: [
          stubCandidate('chk_first', 0.9),
          stubCandidate('chk_second', 0.8),
        ],
      }),
    ],
    reranker: {
      async rerank(input) {
        seenByReranker.push(input.candidates.map((item) => item.chunkId));
        return {
          candidates: input.candidates.slice().reverse().map((candidate, index) => ({
            ...candidate,
            rerankScore: 1 - index * 0.1,
          })),
        };
      },
    },
  });

  const result = await service.retrieve({
    workspaceRoot: '/tmp/not-used',
    query: 'rerank after fusion',
    limit: 2,
  });

  assert.deepEqual(seenByReranker, [['chk_first', 'chk_second']]);
  assert.deepEqual(result.candidates.map((item) => item.chunkId), ['chk_second', 'chk_first']);
  assert.equal(result.trace.rerank.status, 'ran');
});

test('configured retrieval always runs BM25 while remote providers are disabled', async () => {
  const { workspaceRoot, indexesRoot } = tempWorkspace();
  try {
    writeChunks(indexesRoot, [
      baseChunk({
        chunk_id: 'chk_configured_bm25',
        text: 'Configured retrieval must find the local deadline reminder through BM25.',
      }),
    ]);
    const configured = await import('../dist/retrieval/configured-search.js');
    assert.equal(typeof configured.createConfiguredRetrievalService, 'function');

    const config = defaultConfig();
    config.embedding.enabled = false;
    config.rerank.enabled = false;
    const service = configured.createConfiguredRetrievalService(config);
    const result = await service.retrieve({
      workspaceRoot,
      query: 'local deadline reminder',
      limit: 3,
    });

    assert.equal(result.candidates[0]?.chunkId, 'chk_configured_bm25');
    assert.equal(result.trace.strategies.find((item) => item.id === 'bm25')?.status, 'ran');
    assert.equal(result.trace.strategies.find((item) => item.id === 'embedding')?.status, 'skipped');
    assert.equal(result.trace.rerank.status, 'skipped');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('configured retrieval fuses BM25 with configured fake embedding', async () => {
  const { workspaceRoot, indexesRoot } = tempWorkspace();
  try {
    writeChunks(indexesRoot, [
      baseChunk({
        chunk_id: 'chk_configured_hybrid',
        text: 'Hybrid configured retrieval exact semantic target',
      }),
      baseChunk({
        chunk_id: 'chk_configured_other',
        text: 'Unrelated invoice export details.',
      }),
    ]);
    const config = defaultConfig();
    config.embedding = {
      enabled: true,
      provider: 'fake',
      model: 'configured-fake-vector',
      dimensions: 8,
      distance: 'cosine',
    };
    config.rerank.enabled = false;
    const provider = createEmbeddingProvider(config.embedding);
    await buildKnowledgeVectorIndex({ workspaceRoot, provider, config: config.embedding });

    const configured = await import('../dist/retrieval/configured-search.js');
    assert.equal(typeof configured.createConfiguredRetrievalService, 'function');
    const result = await configured.createConfiguredRetrievalService(config).retrieve({
      workspaceRoot,
      query: 'Hybrid configured retrieval exact semantic target',
      limit: 3,
    });

    assert.equal(result.trace.strategies.find((item) => item.id === 'bm25')?.status, 'ran');
    assert.equal(result.trace.strategies.find((item) => item.id === 'embedding')?.status, 'ran');
    assert.deepEqual(
      result.candidates[0]?.strategyScores?.map((item) => item.strategyId).sort(),
      ['bm25', 'embedding'],
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('configured retrieval records invalid embedding safely and preserves BM25', async () => {
  const { workspaceRoot, indexesRoot } = tempWorkspace();
  try {
    writeChunks(indexesRoot, [
      baseChunk({
        chunk_id: 'chk_configured_fallback',
        text: 'Local fallback evidence survives invalid remote configuration.',
      }),
    ]);
    const config = defaultConfig();
    config.embedding = {
      ...config.embedding,
      enabled: true,
      provider: 'unknown-provider-sk-secret',
    };
    const configured = await import('../dist/retrieval/configured-search.js');
    assert.equal(typeof configured.createConfiguredRetrievalService, 'function');
    const result = await configured.createConfiguredRetrievalService(config).retrieve({
      workspaceRoot,
      query: 'fallback evidence invalid remote configuration',
      limit: 3,
    });

    assert.equal(result.candidates[0]?.chunkId, 'chk_configured_fallback');
    const embeddingTrace = result.trace.strategies.find((item) => item.id === 'embedding');
    assert.equal(embeddingTrace?.status, 'skipped');
    assert.match(embeddingTrace?.reason ?? '', /unavailable|invalid|unsupported/i);
    assert.doesNotMatch(JSON.stringify(result.trace), /sk-secret/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('configured retrieval never reuses prior-generation vectors and preserves BM25', async () => {
  const { workspaceRoot, indexesRoot } = tempWorkspace();
  try {
    writeChunks(indexesRoot, [
      baseChunk({
        chunk_id: 'chk_configured_stale',
        text: 'Original vector source text.',
      }),
    ]);
    const config = defaultConfig();
    config.embedding = {
      enabled: true,
      provider: 'fake',
      model: 'configured-stale-vector',
      dimensions: 8,
      distance: 'cosine',
    };
    config.rerank.enabled = false;
    const provider = createEmbeddingProvider(config.embedding);
    await buildKnowledgeVectorIndex({ workspaceRoot, provider, config: config.embedding });
    writeChunks(indexesRoot, [
      baseChunk({
        chunk_id: 'chk_configured_stale',
        text: 'Updated local fallback text after vector build.',
      }),
    ]);

    const configured = await import('../dist/retrieval/configured-search.js');
    const result = await configured.createConfiguredRetrievalService(config).retrieve({
      workspaceRoot,
      query: 'updated local fallback text',
      limit: 3,
    });

    assert.equal(result.candidates[0]?.chunkId, 'chk_configured_stale');
    const embeddingTrace = result.trace.strategies.find((item) => item.id === 'embedding');
    assert.equal(embeddingTrace?.status, 'failed');
    assert.match(embeddingTrace?.reason ?? '', /absent|unavailable/i);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('retrieval keeps fused candidates and redacts rerank failure trace', async () => {
  const service = createRetrievalService({
    strategies: [
      stubStrategy({
        id: 'bm25',
        kind: 'lexical',
        candidates: [stubCandidate('chk_safe_fallback', 0.9)],
      }),
    ],
    reranker: {
      async rerank() {
        throw new Error('Authorization: Bearer sk-rerank-secret');
      },
    },
  });

  const result = await service.retrieve({
    workspaceRoot: '/tmp/not-used',
    query: 'safe rerank fallback',
    limit: 1,
  });

  assert.deepEqual(result.candidates.map((item) => item.chunkId), ['chk_safe_fallback']);
  assert.equal(result.trace.rerank.status, 'failed');
  assert.doesNotMatch(result.trace.rerank.reason ?? '', /sk-rerank-secret/);
});

function directionalEmbeddingProvider(targetChunkId) {
  return {
    id: 'fake',
    model: 'directional-test-vector',
    dimensions: 2,
    distance: 'cosine',
    async embedDocuments(input) {
      return {
        provider: this.id,
        model: this.model,
        dimensions: this.dimensions,
        distance: this.distance,
        results: input.map((item) => ({
          id: item.id,
          provider: this.id,
          model: this.model,
          dimensions: this.dimensions,
          distance: this.distance,
          vector: item.id === targetChunkId ? [1, 0] : [0, 1],
          contentHash: item.contentHash,
          metadata: item.metadata,
        })),
      };
    },
    async embedQuery(input) {
      return {
        id: input.id ?? 'query',
        provider: this.id,
        model: this.model,
        dimensions: this.dimensions,
        distance: this.distance,
        vector: [1, 0],
        metadata: input.metadata,
      };
    },
  };
}

function stubStrategy(input) {
  return {
    id: input.id,
    kind: input.kind,
    enabled: () => (
      input.enabled === false
        ? { enabled: false, reason: input.reason ?? 'disabled by test' }
        : { enabled: true }
    ),
    async recall() {
      if (input.fail) {
        throw new Error(`${input.id} failed`);
      }
      return { candidates: input.candidates ?? [] };
    },
  };
}

function stubCandidate(chunkId, score) {
  return {
    id: chunkId,
    chunkId,
    documentId: chunkId.replace(/^chk_/, 'doc_'),
    source: `knowledge/faq/${chunkId}.md`,
    text: `${chunkId} text`,
    score,
  };
}

test('rerank finalScore min-max normalizes rerank and rrf into [0,1] with rerank weight 0.7', async () => {
  const seenTopN = [];
  const reranker = createProviderReranker({
    provider: {
      async rerank(input) {
        seenTopN.push(input.topN);
        return {
          results: [
            { id: 'chk_high', score: 0.95 },
            { id: 'chk_mid', score: 0.5 },
            { id: 'chk_low', score: 0.05 },
          ],
        };
      },
    },
    topN: 8,
  });
  const result = await reranker.rerank({
    query: 'normalized rerank',
    candidates: [
      { ...stubCandidate('chk_high', 0.5), finalScore: 0.01 },
      { ...stubCandidate('chk_mid', 0.4), finalScore: 0.02 },
      { ...stubCandidate('chk_low', 0.3), finalScore: 0.03 },
    ],
    limit: 8,
  });

  assert.deepEqual(seenTopN, [8]);
  const byId = new Map(result.candidates.map((item) => [item.chunkId, item]));
  // rerank 高分归一化为 1，低分归一化为 0；rrf 反向（chk_low rrf 最高）。
  assert.equal(byId.get('chk_high').finalScore, 0.7);
  assert.equal(byId.get('chk_low').finalScore, 0.3);
  // mid: rerank (0.5-0.05)/(0.95-0.05)=0.5, rrf (0.02-0.01)/(0.03-0.01)=0.5 → 0.7*0.5+0.3*0.5=0.5
  assert.equal(byId.get('chk_mid').finalScore, 0.5);
  assert.equal(result.candidates.every((item) => item.finalScore >= 0 && item.finalScore <= 1), true);
});

test('rerank finalScore degenerates to pure rrf ordering when all rerank scores are equal', async () => {
  const reranker = createProviderReranker({
    provider: {
      async rerank() {
        return {
          results: [
            { id: 'chk_a', score: 0.5 },
            { id: 'chk_b', score: 0.5 },
          ],
        };
      },
    },
  });
  const result = await reranker.rerank({
    query: 'degenerate rerank',
    candidates: [
      { ...stubCandidate('chk_a', 0.4), finalScore: 0.02 },
      { ...stubCandidate('chk_b', 0.3), finalScore: 0.01 },
    ],
    limit: 2,
  });

  const byId = new Map(result.candidates.map((item) => [item.chunkId, item]));
  // max===min → normalizedRerank=0, finalScore = 0.3 * normalizedRrf。
  // chk_a rrf 更高 → 归一化为 1，chk_b 归一化为 0。
  assert.equal(byId.get('chk_a').finalScore, 0.3);
  assert.equal(byId.get('chk_b').finalScore, 0);
  assert.deepEqual(result.candidates.map((item) => item.chunkId), ['chk_a', 'chk_b']);
});

test('rerank passes configured topN to provider and falls back to limit when unset', async () => {
  const seenTopN = [];
  const reranker = createProviderReranker({
    provider: {
      async rerank(input) {
        seenTopN.push(input.topN);
        return { results: [] };
      },
    },
    topN: 8,
  });
  await reranker.rerank({
    query: 'topN passthrough',
    candidates: [stubCandidate('chk_one', 0.5)],
    limit: 5,
  });

  const fallbackReranker = createProviderReranker({
    provider: {
      async rerank(input) {
        seenTopN.push(input.topN);
        return { results: [] };
      },
    },
  });
  await fallbackReranker.rerank({
    query: 'topN fallback',
    candidates: [stubCandidate('chk_two', 0.5)],
    limit: 3,
  });

  assert.deepEqual(seenTopN, [8, 3]);
});
