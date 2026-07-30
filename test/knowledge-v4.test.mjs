import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildKnowledgeChunks, markLegacyChunk } from '../dist/knowledge/documents/chunks.js';
import {
  chunkToEmbeddingDocumentInput,
  buildKnowledgeVectorIndex,
  isChunkEligibleForRemoteEmbedding,
  loadKnowledgeChunksForEmbedding,
} from '../dist/knowledge/vector-index.js';
import { readKnowledgeChunks, writeKnowledgeChunks } from '../dist/knowledge/indexes/chunks.js';
import {
  KnowledgeGenerationConflictError,
  publishKnowledgeGeneration,
  readActiveKnowledgeGeneration,
  recoverStaleKnowledgeGenerationLock,
  resolveKnowledgeGenerationFile,
  rollbackKnowledgeGeneration,
} from '../dist/knowledge/generation-store.js';
import { selectAnswerSpan } from '../dist/retrieval/answer-span.js';
import { rebuildKnowledgeArtifacts } from '../dist/application/knowledge-rebuild-service.js';
import { initKnowledgeWorkspace, updateKnowledgeIndex } from '../dist/knowledge/index.js';
import { chunksPath, vectorsPath } from '../dist/knowledge/paths.js';

function document(body, headings = ['配置说明']) {
  return {
    relativePath: 'knowledge/faq/x.md',
    body,
    headings,
    frontmatter: {
      id: 'kb_x',
      title: 'X 配置',
      type: 'faq',
      module: 'x',
      intent: 'configuration',
      source_type: 'faq',
      status: 'active',
      confidence: 'high',
      visibility: 'internal',
      related_terms: [],
      source_block_ids: ['block_1'],
      quality_status: 'ok',
    },
  };
}

function generationChunk(id, body = `Body ${id}.`) {
  return {
    ...buildKnowledgeChunks([document(body)])[0],
    chunk_id: id,
  };
}

test('Gate C v4 separates canonical body from retrieval text and hashes both semantics', () => {
  const [chunk] = buildKnowledgeChunks([document('## 开启方式\n在设置页开启 X。')]);
  assert.equal(chunk.artifact_version, 4);
  assert.equal(chunk.chunking_strategy, 'parent-child-v4');
  assert.equal(chunk.text, '在设置页开启 X。');
  assert.match(chunk.retrieval_text, /开启方式\n在设置页开启 X。/);
  assert.equal(chunk.text_hash.length, 64);
  assert.equal(chunk.retrieval_text_hash, createHash('sha256').update(chunk.retrieval_text).digest('hex'));

  const embedding = chunkToEmbeddingDocumentInput(chunk);
  assert.equal(embedding.text, chunk.retrieval_text);
  assert.equal(embedding.contentHash, chunk.retrieval_text_hash);
});

test('Gate C reader marks every non-v4 child legacy even if persisted legacy=false', () => {
  const v3 = markLegacyChunk({
    ...buildKnowledgeChunks([document('正文。')])[0],
    artifact_version: 3,
    chunking_strategy: 'parent-child-v3',
    legacy: false,
  });
  assert.equal(v3.legacy, true);
  assert.deepEqual(isChunkEligibleForRemoteEmbedding(v3), { eligible: false, reason: 'legacy_chunk' });
});

test('Gate C legacy chunk writer cannot mutate an active immutable generation', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-generation-writer-'));
  try {
    const originalChunk = generationChunk('chk_original');
    publishKnowledgeGeneration({
      workspaceRoot,
      files: {
        'chunks.jsonl': `${JSON.stringify(originalChunk)}\n`,
        'manifest.json': `${JSON.stringify({ version: 1, chunk_count: 1 })}\n`,
        'keyword-index.json': '{}\n',
      },
      mode: 'bm25_only',
      generationId: 'gen_original',
    });

    assert.throws(() => writeKnowledgeChunks({
      workspaceRoot,
      chunks: [generationChunk('chk_replacement')],
    }), /active_generation_immutable/);
    assert.deepEqual(
      readKnowledgeChunks(workspaceRoot).chunks.map((chunk) => chunk.chunk_id),
      ['chk_original'],
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C flat v4 artifacts remain readable but are always direct-ineligible', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-flat-v4-legacy-'));
  const indexes = join(workspaceRoot, 'knowledge', 'indexes');
  try {
    mkdirSync(indexes, { recursive: true });
    const flatV4 = {
      ...buildKnowledgeChunks([document('平面 v4 内容仍需显式重建。')])[0],
      legacy: false,
    };
    writeFileSync(join(indexes, 'chunks.jsonl'), `${JSON.stringify(flatV4)}\n`);

    const searchChunk = readKnowledgeChunks(workspaceRoot).chunks[0];
    const embeddingChunk = loadKnowledgeChunksForEmbedding(workspaceRoot).chunks[0];
    assert.equal(searchChunk.legacy, true);
    assert.equal(embeddingChunk.legacy, true);
    assert.deepEqual(
      isChunkEligibleForRemoteEmbedding(embeddingChunk),
      { eligible: false, reason: 'legacy_chunk' },
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C undersized trailing child merges safely or is explicitly direct-ineligible', () => {
  const chunks = buildKnowledgeChunks(
    [document('第一段内容足够长，用于形成稳定的主块。\\n\\n尾段。')],
    { maxChars: 40, minChars: 20, overlapChars: 0 },
  );
  assert.equal(chunks.length, 1);

  const impossible = buildKnowledgeChunks(
    [document(`甲。\\n\\n${'乙'.repeat(45)}`)],
    { maxChars: 20, minChars: 10, overlapChars: 0 },
  );
  assert.equal(impossible.some((chunk) => chunk.undersized_unmergeable || chunk.manual_split_required), true);
  assert.equal(impossible.every((chunk) => (
    chunk.undersized_unmergeable ? !isChunkEligibleForRemoteEmbedding(chunk).eligible : true
  )), true);
  const explicitlyUndersized = {
    ...buildKnowledgeChunks([document('用于资格校验的完整正文。')])[0],
    undersized_unmergeable: true,
  };
  assert.deepEqual(
    isChunkEligibleForRemoteEmbedding(explicitlyUndersized),
    { eligible: false, reason: 'undersized_unmergeable' },
  );
});

test('Gate C rebalances an undersized trailing child at a safe same-section sentence boundary', () => {
  const chunks = buildKnowledgeChunks(
    [document('Alpha segment has content. Beta segment has content.\n\nTail bit.')],
    { maxChars: 55, minChars: 25, overlapChars: 0 },
  );
  assert.equal(chunks.length, 2);
  assert.equal(chunks.every((chunk) => chunk.text.length >= 25 && chunk.text.length <= 55), true);
  assert.equal(chunks.some((chunk) => chunk.undersized_unmergeable), false);
  assert.equal(
    chunks.map((chunk) => chunk.text).join('').replace(/\s+/g, ''),
    'Alpha segment has content. Beta segment has content.\n\nTail bit.'.replace(/\s+/g, ''),
  );
});

test('Gate C generation activation is atomic and stale publishers fail CAS', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-generation-'));
  const files = {
    'chunks.jsonl': `${JSON.stringify(generationChunk('one'))}\n`,
    'manifest.json': '{"version":1,"chunk_count":1}\n',
    'keyword-index.json': '{}\n',
  };
  try {
    const first = publishKnowledgeGeneration({
      workspaceRoot,
      files,
      mode: 'bm25_only',
      generationId: 'gen_one',
    });
    assert.equal(readActiveKnowledgeGeneration(workspaceRoot)?.generation_id, 'gen_one');
    assert.equal(
      readFileSync(resolveKnowledgeGenerationFile(workspaceRoot, 'chunks.jsonl'), 'utf8'),
      files['chunks.jsonl'],
    );

    const second = publishKnowledgeGeneration({
      workspaceRoot,
      files: { ...files, 'chunks.jsonl': `${JSON.stringify(generationChunk('two'))}\n` },
      mode: 'bm25_only',
      expectedActiveGenerationId: first.generation_id,
      generationId: 'gen_two',
    });
    assert.equal(second.generation_id, 'gen_two');
    assert.throws(
      () => publishKnowledgeGeneration({
        workspaceRoot,
        files,
        mode: 'bm25_only',
        expectedActiveGenerationId: first.generation_id,
        generationId: 'gen_stale',
      }),
      (error) => error instanceof KnowledgeGenerationConflictError && error.code === 'generation_conflict',
    );
    assert.equal(readActiveKnowledgeGeneration(workspaceRoot)?.generation_id, 'gen_two');
    const rolledBack = rollbackKnowledgeGeneration({
      workspaceRoot,
      expectedActiveGenerationId: 'gen_two',
      previousGenerationId: 'gen_one',
    });
    assert.equal(rolledBack.generation_id, 'gen_one');
    assert.throws(() => rollbackKnowledgeGeneration({
      workspaceRoot,
      expectedActiveGenerationId: 'gen_two',
      previousGenerationId: 'gen_one',
    }), /generation_conflict/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C legacy vector builder pins source generation before provider work', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-vector-generation-pin-'));
  const generationFiles = (body) => ({
    'chunks.jsonl': `${JSON.stringify(generationChunk('chunk_shared', body))}\n`,
    'manifest.json': '{"version":1,"chunk_count":1}\n',
    'keyword-index.json': '{}\n',
  });
  try {
    publishKnowledgeGeneration({
      workspaceRoot,
      files: generationFiles(`第一代 canonical 内容。${'稳定正文。'.repeat(30)}`),
      mode: 'bm25_only',
      generationId: 'gen_one',
    });
    const provider = {
      id: 'fake',
      model: 'fake-vector',
      dimensions: 1,
      distance: 'cosine',
      async embedDocuments(items) {
        publishKnowledgeGeneration({
          workspaceRoot,
          files: generationFiles(`第二代 canonical 内容。${'更新正文。'.repeat(30)}`),
          mode: 'bm25_only',
          expectedActiveGenerationId: 'gen_one',
          generationId: 'gen_two',
        });
        return {
          results: items.map((item) => ({
            id: item.id,
            provider: 'fake',
            model: 'fake-vector',
            dimensions: 1,
            distance: 'cosine',
            vector: [1],
            contentHash: item.contentHash,
          })),
        };
      },
    };

    await assert.rejects(
      buildKnowledgeVectorIndex({
        workspaceRoot,
        provider,
        config: {
          provider: 'fake',
          model: 'fake-vector',
          dimensions: 1,
          distance: 'cosine',
        },
      }),
      /generation_conflict/,
    );
    assert.equal(readActiveKnowledgeGeneration(workspaceRoot)?.generation_id, 'gen_two');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C ignores incomplete generations and requires explicit stale-lock recovery', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-generation-recovery-'));
  const indexes = join(workspaceRoot, 'knowledge', 'indexes');
  const lock = join(indexes, '.generation-publish.lock');
  try {
    mkdirSync(join(indexes, 'generations', 'gen_incomplete'), { recursive: true });
    writeFileSync(join(indexes, 'active.json'), JSON.stringify({
      version: 1,
      generation_id: 'gen_incomplete',
      activated_at: new Date().toISOString(),
    }));
    assert.equal(readActiveKnowledgeGeneration(workspaceRoot), undefined);
    assert.equal(chunksPath(workspaceRoot), join(indexes, 'chunks.jsonl'));

    const outside = join(indexes, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'complete.json'), '{}');
    writeFileSync(join(indexes, 'active.json'), JSON.stringify({
      version: 1,
      generation_id: '../../outside',
      activated_at: new Date().toISOString(),
    }));
    assert.equal(chunksPath(workspaceRoot), join(indexes, 'chunks.jsonl'));

    mkdirSync(lock);
    const stale = new Date(Date.now() - 10 * 60_000);
    utimesSync(lock, stale, stale);
    assert.throws(() => publishKnowledgeGeneration({
      workspaceRoot,
      files: {
        'chunks.jsonl': '',
        'manifest.json': '{"chunk_count":0}',
        'keyword-index.json': '{}',
      },
      mode: 'bm25_only',
    }), /generation_lock_stale/);
    assert.equal(recoverStaleKnowledgeGenerationLock(workspaceRoot), true);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C readers can stay pinned to an earlier complete generation after activation changes', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-generation-reader-'));
  const chunk = (id) => `${JSON.stringify({
    ...buildKnowledgeChunks([document(`Body ${id}.`)])[0],
    chunk_id: id,
  })}\n`;
  try {
    publishKnowledgeGeneration({
      workspaceRoot,
      files: {
        'chunks.jsonl': chunk('chunk_one'),
        'manifest.json': '{"version":1,"chunk_count":1}\n',
        'keyword-index.json': '{}\n',
      },
      mode: 'bm25_only',
      generationId: 'gen_one',
    });
    publishKnowledgeGeneration({
      workspaceRoot,
      files: {
        'chunks.jsonl': chunk('chunk_two'),
        'manifest.json': '{"version":1,"chunk_count":1}\n',
        'keyword-index.json': '{}\n',
      },
      mode: 'bm25_only',
      expectedActiveGenerationId: 'gen_one',
      generationId: 'gen_two',
    });

    assert.equal(readKnowledgeChunks(workspaceRoot).chunks[0]?.chunk_id, 'chunk_two');
    assert.equal(readKnowledgeChunks(workspaceRoot, 'gen_one').chunks[0]?.chunk_id, 'chunk_one');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C bm25-only active generation never falls back to stale flat vector files', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-generation-no-vector-fallback-'));
  const indexes = join(workspaceRoot, 'knowledge', 'indexes');
  try {
    mkdirSync(indexes, { recursive: true });
    writeFileSync(join(indexes, 'vectors.jsonl'), '{"vector_id":"stale_flat"}\n');
    publishKnowledgeGeneration({
      workspaceRoot,
      files: {
        'chunks.jsonl': `${JSON.stringify(generationChunk('chunk_one'))}\n`,
        'manifest.json': '{"version":1,"chunk_count":1}\n',
        'keyword-index.json': '{}\n',
      },
      mode: 'bm25_only',
      generationId: 'gen_bm25',
    });

    assert.equal(
      vectorsPath(workspaceRoot),
      join(indexes, 'generations', 'gen_bm25', 'vectors.jsonl'),
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C readers reject a coherently rehashed generation with invalid v4 metadata', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-generation-metadata-'));
  try {
    publishKnowledgeGeneration({
      workspaceRoot,
      files: {
        'chunks.jsonl': `${JSON.stringify(generationChunk('chunk_one'))}\n`,
        'manifest.json': '{"version":1,"chunk_count":1}\n',
        'keyword-index.json': '{}\n',
      },
      mode: 'bm25_only',
      generationId: 'gen_one',
    });
    const generationRoot = join(
      workspaceRoot,
      'knowledge',
      'indexes',
      'generations',
      'gen_one',
    );
    const manifestPath = join(generationRoot, 'generation-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.chunk_artifact_version = 3;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(generationRoot, 'complete.json'), `${JSON.stringify({
      version: 1,
      generation_id: 'gen_one',
      manifest_hash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    })}\n`);

    assert.equal(readActiveKnowledgeGeneration(workspaceRoot), undefined);
    assert.equal(
      chunksPath(workspaceRoot),
      join(workspaceRoot, 'knowledge', 'indexes', 'chunks.jsonl'),
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C rollback participates in the same publish lock', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-generation-rollback-lock-'));
  const files = {
    'chunks.jsonl': '',
    'manifest.json': '{"version":1,"chunk_count":0}\n',
    'keyword-index.json': '{}\n',
  };
  const lock = join(workspaceRoot, 'knowledge', 'indexes', '.generation-publish.lock');
  try {
    publishKnowledgeGeneration({ workspaceRoot, files, mode: 'bm25_only', generationId: 'gen_one' });
    publishKnowledgeGeneration({
      workspaceRoot,
      files,
      mode: 'bm25_only',
      expectedActiveGenerationId: 'gen_one',
      generationId: 'gen_two',
    });
    mkdirSync(lock);
    assert.throws(() => rollbackKnowledgeGeneration({
      workspaceRoot,
      expectedActiveGenerationId: 'gen_two',
      previousGenerationId: 'gen_one',
    }), /generation_lock_busy/);
    assert.equal(readActiveKnowledgeGeneration(workspaceRoot)?.generation_id, 'gen_two');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C hybrid generation cannot activate without both vector artifacts', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-generation-hybrid-'));
  try {
    assert.throws(() => publishKnowledgeGeneration({
      workspaceRoot,
      files: {
        'chunks.jsonl': '',
        'manifest.json': '{}',
        'keyword-index.json': '{}',
      },
      mode: 'hybrid',
    }), /incomplete_hybrid_generation/);
    assert.equal(readActiveKnowledgeGeneration(workspaceRoot), undefined);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C validates chunk identity, manifest counts, and hybrid vector dimensions before activation', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-generation-validation-'));
  const validChunk = {
    ...buildKnowledgeChunks([document('Alpha body is long enough for a stable child record.')])[0],
    chunk_id: 'chunk_alpha',
  };
  try {
    assert.throws(() => publishKnowledgeGeneration({
      workspaceRoot,
      files: {
        'chunks.jsonl': `${JSON.stringify(validChunk)}\n${JSON.stringify(validChunk)}\n`,
        'manifest.json': '{"version":1,"chunk_count":2}\n',
        'keyword-index.json': '{}\n',
      },
      mode: 'bm25_only',
      generationId: 'gen_duplicate',
    }), /duplicate_chunk_id/);
    assert.equal(readActiveKnowledgeGeneration(workspaceRoot), undefined);

    assert.throws(() => publishKnowledgeGeneration({
      workspaceRoot,
      files: {
        'chunks.jsonl': `${JSON.stringify(validChunk)}\n`,
        'manifest.json': '{"version":1,"chunk_count":2}\n',
        'keyword-index.json': '{}\n',
      },
      mode: 'bm25_only',
      generationId: 'gen_count_mismatch',
    }), /chunk_count_mismatch/);

    assert.throws(() => publishKnowledgeGeneration({
      workspaceRoot,
      files: {
        'chunks.jsonl': `${JSON.stringify(validChunk)}\n`,
        'manifest.json': '{"version":1,"chunk_count":1}\n',
        'keyword-index.json': '{}\n',
        'vectors.jsonl': `${JSON.stringify({
          chunk_id: validChunk.chunk_id,
          dimensions: 2,
          vector: [1],
        })}\n`,
        'vector-manifest.json': '{"version":1,"vector_count":1,"dimensions":2}\n',
      },
      mode: 'hybrid',
      generationId: 'gen_dimension_mismatch',
    }), /vector_dimension_mismatch/);
    assert.equal(readActiveKnowledgeGeneration(workspaceRoot), undefined);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C application rebuild keeps the old active generation when requested embedding fails', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-application-rebuild-'));
  const faqRoot = join(workspaceRoot, 'knowledge', 'faq');
  const sourcePath = join(faqRoot, 'atomic.md');
  const markdown = (body) => `---
id: kb_atomic
title: Atomic rebuild
type: faq
module: general
intent: how_to
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-07-29
owner: test
source_document: knowledge/_sources/manual/atomic.md
source_document_id: source_atomic
source_block_ids:
  - block_atomic
quality_status: ok
---

# Atomic rebuild

${body}
`;
  try {
    initKnowledgeWorkspace({ workspaceRoot });
    mkdirSync(faqRoot, { recursive: true });
    writeFileSync(sourcePath, markdown(`Initial canonical body ${'A'.repeat(120)}.`));
    updateKnowledgeIndex({ workspaceRoot });
    const activeBefore = readActiveKnowledgeGeneration(workspaceRoot)?.generation_id;
    writeFileSync(sourcePath, markdown(`Replacement canonical body ${'B'.repeat(120)}.`));

    await assert.rejects(() => rebuildKnowledgeArtifacts({
      workspaceRoot,
      embedding: {
        enabled: true,
        config: {
          enabled: true,
          provider: 'fake',
          model: 'fake-model',
          dimensions: 2,
          distance: 'cosine',
        },
        provider: {
          id: 'fake',
          model: 'fake-model',
          dimensions: 2,
          distance: 'cosine',
          async embedDocuments() {
            throw new Error('provider unavailable');
          },
        },
      },
    }), /embedding_generation_incomplete/);

    assert.equal(readActiveKnowledgeGeneration(workspaceRoot)?.generation_id, activeBefore);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Gate C span and judge boundaries contain no business-question keyword classifiers', () => {
  const spanSource = readFileSync(
    new URL('../src/retrieval/answer-span.ts', import.meta.url),
    'utf8',
  );
  const judgeSource = readFileSync(
    new URL('../src/runtime/evidence-judge.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(spanSource, /ANSWER_BEARING_PATTERNS|学员|课程|订单|配置|开启/);
  assert.doesNotMatch(judgeSource, /GENERIC_KEYWORDS|statistics_backfill_procedure|命令行或命令名称/);
});

test('Gate C answer span selects one to three consecutive canonical segments that cover the query', () => {
  assert.equal(selectAnswerSpan({
    text: 'Alpha is enabled here. Beta becomes active later. Unrelated.',
    matchedTerms: ['Alpha'],
  }), 'Alpha is enabled here.');
  assert.equal(selectAnswerSpan({
    text: 'Alpha is enabled here. Beta becomes active later. Unrelated.',
    matchedTerms: ['Alpha', 'Beta'],
  }), 'Alpha is enabled here. Beta becomes active later.');
  assert.equal(selectAnswerSpan({
    text: '1. Alpha\n2. Beta\n3. Gamma',
    matchedTerms: ['Alpha', 'Beta', 'Gamma'],
  }), '1. Alpha\n2. Beta\n3. Gamma');
});

test('Gate C answer span abstains for four required segments, overflow, heading-only match, or no match', () => {
  assert.equal(selectAnswerSpan({
    text: 'Alpha. Beta. Gamma. Delta.',
    matchedTerms: ['Alpha', 'Beta', 'Gamma', 'Delta'],
  }), undefined);
  assert.equal(selectAnswerSpan({
    text: `Alpha ${'x'.repeat(495)}.`,
    matchedTerms: ['Alpha'],
  }), undefined);
  assert.equal(selectAnswerSpan({
    text: '# Alpha\nBody without the term.',
    matchedTerms: ['Alpha'],
  }), undefined);
  assert.equal(selectAnswerSpan({
    text: 'Completely different body.',
    matchedTerms: ['Alpha'],
  }), undefined);
});
