import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createEmbeddingProvider } from '../dist/providers/embedding/index.js';
import {
  buildKnowledgeVectorIndex,
  checkKnowledgeVectorCompatibility,
  chunksPath,
  isChunkEligibleForRemoteEmbedding,
  readKnowledgeVectorManifest,
  readKnowledgeVectorRecords,
  vectorBuildReportPath,
  vectorManifestPath,
  vectorsPath,
} from '../dist/knowledge/index.js';
import {
  publishKnowledgeGeneration,
  readActiveKnowledgeGeneration,
} from '../dist/knowledge/generation-store.js';

function tempWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'super-helper-kv-'));
  const indexes = join(workspace, 'knowledge', 'indexes');
  return { workspace, indexes };
}

let generationSequence = 0;

function serializedChunks(chunks) {
  return chunks.map((chunk, index) => JSON.stringify({
    artifact_version: 4,
    chunking_strategy: 'parent-child-v4',
    legacy: false,
    child_order: index + 1,
    source_block_ids: [`blk_${index + 1}`],
    section_path: ['测试'],
    quality_status: 'ok',
    ...chunk,
  })).join('\n') + '\n';
}

function writeFlatChunks(indexes, chunks) {
  mkdirSync(indexes, { recursive: true });
  writeFileSync(join(indexes, 'chunks.jsonl'), serializedChunks(chunks), 'utf8');
}

function publishChunks(workspace, chunks) {
  const active = readActiveKnowledgeGeneration(workspace);
  generationSequence += 1;
  publishKnowledgeGeneration({
    workspaceRoot: workspace,
    files: {
      'chunks.jsonl': serializedChunks(chunks),
      'manifest.json': `${JSON.stringify({ version: 1, chunk_count: chunks.length })}\n`,
      'keyword-index.json': '{}\n',
    },
    mode: 'bm25_only',
    expectedActiveGenerationId: active?.generation_id,
    generationId: `gen_fixture_${generationSequence}`,
  });
}

test('vector builder reports completed eligible batches', async () => {
  const { workspace, indexes } = tempWorkspace();
  try {
    publishChunks(workspace, Array.from({ length: 5 }, (_, index) => ({
      chunk_id: `chk_${index}`,
      parent_id: `doc_${index}`,
      source: `knowledge/faq/${index}.md`,
      module: 'general',
      intent: 'how_to',
      source_type: 'faq',
      status: 'active',
      confidence: 'high',
      visibility: 'internal',
      headings: [],
      keywords: ['test'],
      text: `answer-bearing chunk ${index}`,
    })));
    const progress = [];
    const config = {
      enabled: true,
      provider: 'fake',
      model: 'fake-vector',
      dimensions: 4,
      distance: 'cosine',
      batchSize: 2,
    };
    await buildKnowledgeVectorIndex({
      workspaceRoot: workspace,
      provider: createEmbeddingProvider(config),
      config,
      onProgress: (item) => progress.push(item),
    });
    assert.deepEqual(progress.at(-1), { processed: 5, total: 5 });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('knowledge vector build writes artifacts and skips restricted chunks before provider call', async () => {
  const { workspace, indexes } = tempWorkspace();
  const chunks = [
    {
      chunk_id: 'chk_public',
      parent_id: 'doc_public',
      source: 'knowledge/faq/public.md',
      module: 'ai-companion',
      intent: 'policy',
      source_type: 'faq',
      status: 'active',
      confidence: 'high',
      visibility: 'internal',
      headings: [],
      keywords: ['学习日'],
      text: '学习日晚上8点未完成任务会提醒',
    },
    {
      chunk_id: 'chk_restricted',
      parent_id: 'doc_restricted',
      source: 'knowledge/runbooks/restricted.md',
      module: 'security',
      intent: 'secret',
      source_type: 'runbook',
      status: 'active',
      confidence: 'high',
      visibility: 'restricted',
      headings: [],
      keywords: ['secret'],
      text: 'RESTRICTED_SECRET_TEXT_SHOULD_NOT_LEAVE',
    },
  ];
  publishChunks(workspace, chunks);

  const submitted = [];
  const provider = createEmbeddingProvider({
    enabled: true,
    provider: 'fake',
    model: 'fake-vector',
    dimensions: 5,
    distance: 'cosine',
  });
  const original = provider.embedDocuments.bind(provider);
  provider.embedDocuments = async (input, options) => {
    submitted.push(...input.map((item) => item.text));
    return original(input, options);
  };

  const result = await buildKnowledgeVectorIndex({
    workspaceRoot: workspace,
    provider,
    config: {
      enabled: true,
      provider: 'fake',
      model: 'fake-vector',
      dimensions: 5,
      distance: 'cosine',
    },
  });

  assert.deepEqual(submitted, ['学习日晚上8点未完成任务会提醒']);
  assert.equal(result.vectorCount, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].chunkId, 'chk_restricted');
  assert.equal(existsSync(vectorsPath(workspace)), true);
  assert.equal(existsSync(vectorManifestPath(workspace)), true);
  assert.equal(existsSync(vectorBuildReportPath(workspace)), true);

  const records = readKnowledgeVectorRecords(workspace);
  assert.equal(records.records.length, 1);
  assert.equal(records.records[0].chunk_id, 'chk_public');
  assert.equal(records.records[0].provider, 'fake');
  assert.equal(records.records[0].vector.length, 5);

  const manifest = readKnowledgeVectorManifest(workspace);
  assert.equal(manifest.provider, 'fake');
  assert.equal(manifest.model, 'fake-vector');
  assert.equal(manifest.vector_count, 1);
  assert.equal(manifest.skipped_count, 1);

  const report = JSON.parse(readFileSync(vectorBuildReportPath(workspace), 'utf8'));
  assert.equal(report.vectorCount, 1);
  assert.equal(report.skipped.length, 1);
  assert.doesNotMatch(JSON.stringify(report), /RESTRICTED_SECRET_TEXT_SHOULD_NOT_LEAVE/);
});

test('knowledge vector compatibility detects missing, matching, mismatch, and stale chunk artifacts', async () => {
  const { workspace, indexes } = tempWorkspace();
  const config = {
    enabled: true,
    provider: 'fake',
    model: 'fake-vector',
    dimensions: 3,
    distance: 'cosine',
  };

  assert.equal(checkKnowledgeVectorCompatibility({ workspaceRoot: workspace, embeddingConfig: config }).status, 'missing-index');

  publishChunks(workspace, [{
    chunk_id: 'chk_one',
    parent_id: 'doc_one',
    source: 'knowledge/faq/one.md',
    module: 'ai-companion',
    intent: 'policy',
    source_type: 'faq',
    status: 'active',
    confidence: 'high',
    visibility: 'internal',
    headings: [],
    keywords: ['提醒'],
    text: '提醒规则',
  }]);
  const provider = createEmbeddingProvider(config);
  await buildKnowledgeVectorIndex({ workspaceRoot: workspace, provider, config });

  assert.equal(checkKnowledgeVectorCompatibility({ workspaceRoot: workspace, embeddingConfig: config }).status, 'compatible');
  assert.deepEqual(
    checkKnowledgeVectorCompatibility({
      workspaceRoot: workspace,
      embeddingConfig: { ...config, model: 'other-model' },
    }).mismatches,
    ['model'],
  );

  writeFileSync(chunksPath(workspace), serializedChunks([{
    chunk_id: 'chk_one',
    parent_id: 'doc_one',
    source: 'knowledge/faq/one.md',
    module: 'ai-companion',
    intent: 'policy',
    source_type: 'faq',
    status: 'active',
    confidence: 'high',
    visibility: 'internal',
    headings: [],
    keywords: ['提醒'],
    text: '提醒规则已经变化',
  }]), 'utf8');
  const stale = checkKnowledgeVectorCompatibility({ workspaceRoot: workspace, embeddingConfig: config });
  assert.equal(stale.status, 'rebuild-required');
  assert.deepEqual(stale.mismatches, ['source_chunks']);
});

test('knowledge vector compatibility accepts v4 chunks and rebuilds stale v2 vectors', async () => {
  const { workspace, indexes } = tempWorkspace();
  const config = {
    enabled: true,
    provider: 'fake',
    model: 'fake-vector',
    dimensions: 3,
    distance: 'cosine',
  };

  try {
    writeFlatChunks(indexes, [{
      chunk_id: 'chk_one',
      parent_id: 'doc_one',
      source: 'knowledge/faq/one.md',
      module: 'ai-companion',
      intent: 'policy',
      source_type: 'faq',
      status: 'active',
      confidence: 'high',
      visibility: 'internal',
      headings: [],
      keywords: ['提醒'],
      text: '提醒规则',
      artifact_version: 2,
      chunking_strategy: 'parent-child-v2',
    }]);
    const provider = createEmbeddingProvider(config);
    await buildKnowledgeVectorIndex({ workspaceRoot: workspace, provider, config });

    publishChunks(workspace, [{
      chunk_id: 'chk_one',
      parent_id: 'doc_one',
      source: 'knowledge/faq/one.md',
      module: 'ai-companion',
      intent: 'policy',
      source_type: 'faq',
      status: 'active',
      confidence: 'high',
      visibility: 'internal',
      headings: [],
      keywords: ['提醒'],
      text: '提醒规则',
      artifact_version: 4,
      chunking_strategy: 'parent-child-v4',
      legacy: false,
    }]);

    const loaded = JSON.parse(readFileSync(chunksPath(workspace), 'utf8').trim());
    assert.deepEqual(isChunkEligibleForRemoteEmbedding(loaded), { eligible: true });

    const stale = checkKnowledgeVectorCompatibility({ workspaceRoot: workspace, embeddingConfig: config });
    assert.equal(stale.status, 'missing-index');
    await buildKnowledgeVectorIndex({ workspaceRoot: workspace, provider, config });
    assert.equal(
      checkKnowledgeVectorCompatibility({ workspaceRoot: workspace, embeddingConfig: config }).status,
      'compatible',
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
