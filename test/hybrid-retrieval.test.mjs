import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildKnowledgeChunks, markLegacyChunk } from '../dist/knowledge/documents/chunks.js';
import { createBm25RecallStrategy } from '../dist/retrieval/recall/bm25/strategy.js';
import { tokenizeForBm25 } from '../dist/retrieval/recall/bm25/tokenizer.js';
import { createRetrievalService } from '../dist/retrieval/service.js';
import { searchVectorArtifactsWithFilters } from '../dist/retrieval/recall/embedding/vector-search.js';
import { generateKnowledgeMigrationReport, initKnowledgeWorkspace, loadKnowledgeTaxonomy, updateKnowledgeIndex } from '../dist/knowledge/index.js';

function parentDocument(overrides = {}) {
  const sectionA = `当课程发布后，学员需要满足可加入范围才能看到入口。${'甲乙丙丁课程规则'.repeat(45)}`;
  const sectionB = `如果课程设置了有效期，过期学员不会看到入口。${'戊己庚辛有效期规则'.repeat(45)}`;
  return {
    frontmatter: {
      id: 'kb_parent_child',
      title: '课程发布可见性规则',
      type: 'faq',
      module: 'course',
      intent: 'how_to',
      source_type: 'faq',
      confidence: 'high',
      status: 'active',
      visibility: 'internal',
      product_versions: [],
      related_terms: ['课程发布', '学员可见'],
      related_repos: [],
      last_verified_at: '2026-06-20',
      owner: 'support',
      source_document: 'knowledge/_sources/manual/course.md',
      source_document_id: 'src_course',
      source_block_ids: ['blk_a', 'blk_b'],
      section_path: ['课程管理'],
      quality_status: 'ok',
      ...overrides.frontmatter,
    },
    body: overrides.body ?? `# 课程发布可见性规则\n\n## 发布范围\n\n${sectionA}\n\n## 有效期\n\n${sectionB}`,
    headings: overrides.headings ?? ['课程发布可见性规则', '发布范围', '有效期'],
    path: '/tmp/visibility.md',
    relativePath: overrides.relativePath ?? 'knowledge/faq/course/visibility.md',
  };
}

test('Chinese tokenizer preserves TF, bigrams, registered terms, and excludes generic single characters', () => {
  const tokens = tokenizeForBm25('课程发布课程发布 AI-Agent v2 X', {
    businessTerms: ['课程发布'],
    registeredSingleCharacterTerms: ['X'],
  });
  assert.equal(tokens.filter((token) => token === '课程发布').length, 2);
  assert.equal(tokens.filter((token) => token === '课程').length, 2);
  assert.equal(tokens.includes('ai-agent'), true);
  assert.equal(tokens.includes('v2'), true);
  assert.equal(tokens.includes('X'.toLowerCase()), true);
  assert.equal(tokens.includes('课'), false);
});

test('parent-child builder keeps section boundaries and deterministic v2 metadata', () => {
  const chunks = buildKnowledgeChunks([parentDocument()]);
  assert.equal(chunks.length >= 2, true);
  assert.deepEqual(chunks.map((chunk) => chunk.child_order), chunks.map((_, index) => index + 1));
  assert.equal(chunks.every((chunk) => chunk.text.length <= 800 || chunk.manual_split_required), true);
  assert.equal(chunks.every((chunk) => chunk.text_hash?.length === 64), true);
  assert.equal(chunks.every((chunk) => chunk.source_block_ids?.length > 0), true);
  assert.equal(chunks.every((chunk) => chunk.section_path?.length > 0), true);
  assert.equal(chunks.every((chunk) => chunk.legacy === false), true);
  assert.deepEqual(buildKnowledgeChunks([parentDocument()]), chunks);
});

test('oversized indivisible block is preserved and marked for manual split', () => {
  const body = `# 超长规则\n\n## 单块\n\n当条件满足时必须执行。${'不可拆分规则'.repeat(180)}`;
  const chunks = buildKnowledgeChunks([parentDocument({ body, headings: ['超长规则', '单块'] })]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text.length > 800, true);
  assert.equal(chunks[0].manual_split_required, true);
});

test('same-section children overlap by at most one bounded sentence', () => {
  const first = `当发布范围匹配时，学员可以看到课程入口。${'发布范围说明'.repeat(70)}`;
  const second = `如果有效期已结束，系统不会展示入口。${'有效期说明'.repeat(70)}`;
  const chunks = buildKnowledgeChunks([parentDocument({
    body: `# 规则\n\n## 同一章节\n\n${first}\n\n${second}`,
    headings: ['规则', '同一章节'],
  })]);
  assert.equal(chunks.length, 2);
  assert.equal((chunks[1].overlap_chars ?? 0) > 0, true);
  assert.equal((chunks[1].overlap_chars ?? 0) <= 120, true);
  assert.deepEqual(chunks[0].section_path, chunks[1].section_path);
});

test('parent-child builder accepts chunking options and emits v4 sentence-window chunks', () => {
  const sentence = '课程发布后，学员端会根据发布范围、有效期和可加入条件决定是否展示入口。';
  const body = `# 规则\n\n## 长段落\n\n${Array.from({ length: 10 }, () => sentence).join('')}`;
  const chunks = buildKnowledgeChunks([
    parentDocument({ body, headings: ['规则', '长段落'] }),
  ], {
    maxChars: 180,
    overlapStrategy: 'sentence',
    overlapChars: 60,
    minChars: 80,
  });

  assert.equal(chunks.length > 1, true);
  assert.equal(chunks.every((chunk) => chunk.text.length <= 180), true);
  assert.equal(chunks.every((chunk) => !chunk.manual_split_required), true);
  assert.equal(chunks.every((chunk) => chunk.chunking_strategy === 'parent-child-v4'), true);
  assert.equal(chunks.every((chunk) => chunk.artifact_version === 4), true);
  assert.equal(chunks.every((chunk) => chunk.legacy === false), true);
  assert.equal((chunks[1].overlap_chars ?? 0) > 0, true);
  assert.equal((chunks[1].overlap_chars ?? 0) <= 60, true);
});

test('chunk legacy marker treats v4 as current and older records as legacy', () => {
  assert.equal(markLegacyChunk({
    chunk_id: 'chk_v4',
    parent_id: 'doc',
    source: 'doc.md',
    module: 'course',
    intent: 'how_to',
    source_type: 'faq',
    status: 'active',
    confidence: 'high',
    headings: [],
    keywords: [],
    text: 'v4',
    chunking_strategy: 'parent-child-v4',
    artifact_version: 4,
  }).legacy, false);
  assert.equal(markLegacyChunk({
    chunk_id: 'chk_v2',
    parent_id: 'doc',
    source: 'doc.md',
    module: 'course',
    intent: 'how_to',
    source_type: 'faq',
    status: 'active',
    confidence: 'high',
    headings: [],
    keywords: [],
    text: 'v2',
    chunking_strategy: 'parent-child-v2',
    artifact_version: 2,
  }).legacy, true);
});

test('multiple child hits collapse to one parent while preserving strongest answer span and scores', async () => {
  const candidates = [
    {
      id: 'child_1', chunkId: 'child_1', documentId: 'parent', parentId: 'parent', source: 'parent.md',
      text: '背景', excerpt: '背景', matchedTerms: ['课程发布'], score: 0.8,
    },
    {
      id: 'child_2', chunkId: 'child_2', documentId: 'parent', parentId: 'parent', source: 'parent.md',
      text: '答案', excerpt: '当课程发布后，学员可以看到入口。', answerSpan: '当课程发布后，学员可以看到入口。',
      matchedTerms: ['课程发布', '学员可见'], score: 0.7,
    },
  ];
  const service = createRetrievalService({
    strategies: [{ id: 'bm25', kind: 'lexical', enabled: () => true, async recall() { return { candidates }; } }],
  });
  const result = await service.retrieve({ workspaceRoot: '/tmp', query: '课程发布学员可见', limit: 8 });
  assert.equal(result.candidates.length, 1);
  assert.match(result.candidates[0].answerSpan, /学员可以看到入口/);
  assert.deepEqual(result.candidates[0].metadata.childHits, ['child_1', 'child_2']);
  assert.equal(result.candidates[0].strategyScores.length, 1);
});

test('field-weighted BM25 ranks exact title over repeated noisy body and explains contributions', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-bm25f-'));
  try {
    mkdirSync(join(workspaceRoot, 'knowledge', 'indexes'), { recursive: true });
    mkdirSync(join(workspaceRoot, 'knowledge', 'faq', 'course'), { recursive: true });
    const exact = parentDocument();
    const noisy = parentDocument({
      frontmatter: { id: 'kb_noisy', title: '课程常见问题', related_terms: ['常见问题'] },
      body: `# 课程常见问题\n\n${'课程 发布 可见性 规则 '.repeat(80)}这是普通背景描述。`,
      headings: ['课程常见问题'],
      relativePath: 'knowledge/faq/course/noisy.md',
    });
    for (const document of [exact, noisy]) {
      writeFileSync(join(workspaceRoot, document.relativePath), `---\n${Object.entries(document.frontmatter)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => `${key}: ${value}`).join('\n')}\nproduct_versions: []\nrelated_terms: []\nrelated_repos: []\nsource_block_ids:\n  - blk\nsection_path:\n  - 课程\n---\n\n${document.body}\n`, 'utf8');
    }
    const chunks = buildKnowledgeChunks([exact, noisy]);
    writeFileSync(join(workspaceRoot, 'knowledge', 'indexes', 'chunks.jsonl'), `${chunks.map((chunk) => JSON.stringify(chunk)).join('\n')}\n`, 'utf8');
    const result = await createBm25RecallStrategy().recall({
      workspaceRoot,
      query: '课程发布可见性规则',
      limit: 10,
    });
    assert.equal(result.candidates[0].documentId, 'kb_parent_child', JSON.stringify(result.candidates.map((candidate) => ({
      documentId: candidate.documentId,
      score: candidate.score,
      terms: candidate.matchedTerms,
      fields: candidate.metadata?.bm25FieldContributions,
    }))));
    assert.equal(result.candidates[0].metadata.bm25FieldContributions.title > 0, true);
    assert.equal(result.candidates[0].matchedTerms.every((term) => term.length >= 2), true);

    const noHit = await createBm25RecallStrategy().recall({
      workspaceRoot,
      query: '火星税务量子许可证',
      limit: 10,
    });
    assert.deepEqual(noHit.candidates, []);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('hybrid service enforces 40/40 recall, Top 20 rerank input, and Top 8 final budget', async () => {
  const calls = [];
  const strategy = (id) => ({
    id,
    kind: id === 'bm25' ? 'lexical' : 'semantic',
    enabled: () => true,
    async recall(input) {
      calls.push({ id, limit: input.limit });
      return {
        candidates: Array.from({ length: 40 }, (_, index) => ({
          id: `${id}_${index}`,
          chunkId: `${id}_${index}`,
          documentId: `${id}_parent_${index}`,
          parentId: `${id}_parent_${index}`,
          source: `${id}/${index}.md`,
          text: `${id} candidate ${index}`,
          score: 40 - index,
        })),
      };
    },
  });
  const service = createRetrievalService({
    strategies: [strategy('bm25'), strategy('embedding')],
    recallLimit: 40,
    fusionLimit: 20,
    reranker: {
      async rerank(input) {
        assert.equal(input.candidates.length, 20);
        return { candidates: input.candidates.map((candidate, index) => ({ ...candidate, rerankScore: 1 - index / 100 })) };
      },
    },
  });
  const result = await service.retrieve({ workspaceRoot: '/tmp', query: '课程发布', limit: 8 });
  assert.deepEqual(calls, [{ id: 'bm25', limit: 40 }, { id: 'embedding', limit: 40 }]);
  assert.equal(result.candidates.length, 8);
  assert.equal(result.candidates.every((candidate) => candidate.strategyScores?.length > 0), true);
  assert.equal(result.trace.rerank.inputCount, 20);
});

test('embedding artifacts apply metadata, visibility, quality, and legacy filters before ranking', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-vector-filter-'));
  try {
    const indexes = join(workspaceRoot, 'knowledge', 'indexes');
    const generationId = 'gen_filter_fixture';
    const generationRoot = join(indexes, 'generations', generationId);
    mkdirSync(generationRoot, { recursive: true });
    const base = {
      module: 'course',
      intent: 'how_to',
      source_type: 'faq',
      status: 'active',
      confidence: 'high',
      headings: [],
      keywords: [],
      artifact_version: 4,
      chunking_strategy: 'parent-child-v4',
      legacy: false,
      child_order: 1,
      source_block_ids: ['blk'],
      section_path: ['课程'],
      quality_status: 'ok',
    };
    const chunks = [
      { ...base, chunk_id: 'public', parent_id: 'p_public', source: 'public.md', visibility: 'customer_safe', text: '公开课程规则' },
      { ...base, chunk_id: 'internal', parent_id: 'p_internal', source: 'internal.md', visibility: 'internal', text: '内部课程规则' },
      { ...base, chunk_id: 'restricted', parent_id: 'p_restricted', source: 'restricted.md', visibility: 'restricted', text: '受限秘密' },
      { ...base, chunk_id: 'quality', parent_id: 'p_quality', source: 'quality.md', visibility: 'customer_safe', quality_status: 'error', text: '错误质量' },
      { ...base, chunk_id: 'legacy', parent_id: 'p_legacy', source: 'legacy.md', visibility: 'customer_safe', legacy: true, artifact_version: undefined, text: '旧块' },
      { ...base, chunk_id: 'other_module', parent_id: 'p_other', source: 'other.md', visibility: 'customer_safe', module: 'billing', text: '账单规则' },
    ];
    writeFileSync(join(generationRoot, 'chunks.jsonl'), `${chunks.map((chunk) => JSON.stringify(chunk)).join('\n')}\n`, 'utf8');
    writeFileSync(join(generationRoot, 'vectors.jsonl'), `${chunks.map((chunk, index) => JSON.stringify({
      vector_id: `vec_${chunk.chunk_id}`,
      source: chunk.source,
      document_id: chunk.parent_id,
      chunk_id: chunk.chunk_id,
      text_hash: `hash_${index}`,
      provider: 'fake',
      model: 'fake',
      dimensions: 3,
      distance: 'cosine',
      vector: [1, 0, 0],
      created_at: '2026-06-20T00:00:00.000Z',
    })).join('\n')}\n`, 'utf8');

    const result = searchVectorArtifactsWithFilters({
      workspaceRoot,
      queryVector: [1, 0, 0],
      limit: 40,
      moduleCandidates: ['course'],
      visibility: ['customer_safe'],
      generationId,
    });
    assert.deepEqual(result.candidates.map((candidate) => candidate.chunkId), ['public']);
    assert.equal(result.filteredOut.some((item) => item.reason === 'visibility_filter'), true);
    assert.equal(result.filteredOut.some((item) => item.reason === 'restricted_visibility'), true);
    assert.equal(result.filteredOut.some((item) => item.reason === 'quality_error'), true);
    assert.equal(result.filteredOut.some((item) => item.reason === 'legacy_chunk'), true);
    assert.equal(result.filteredOut.some((item) => item.reason === 'module_filter'), true);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('taxonomy templates cover product modules and index reports unknown modules', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-taxonomy-'));
  try {
    initKnowledgeWorkspace({ workspaceRoot });
    const taxonomy = loadKnowledgeTaxonomy(workspaceRoot);
    assert.equal(taxonomy.modules.some((module) => module.id === 'ai-companion'), true);
    assert.equal(taxonomy.modules.some((module) => module.id === 'edusoho-training'), true);
    const unknown = parentDocument({
      frontmatter: { id: 'kb_unknown_module', module: 'unregistered-product' },
      relativePath: 'knowledge/faq/unregistered/unknown.md',
    });
    const directory = join(workspaceRoot, 'knowledge', 'faq', 'unregistered');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'unknown.md'), `---
id: kb_unknown_module
title: 未登记模块规则
type: faq
module: unregistered-product
intent: how_to
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-20
owner: support
source_document: knowledge/_sources/manual/unknown.md
source_document_id: src_unknown
source_block_ids:
  - blk_unknown
section_path:
  - 未登记模块
quality_status: ok
---

${unknown.body}
`, 'utf8');
    const result = updateKnowledgeIndex({ workspaceRoot });
    assert.deepEqual(result.taxonomyWarnings, ['unknown_module:unregistered-product']);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('migration report inventories legacy artifacts without mutating them and preserves batch order', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-migration-'));
  try {
    initKnowledgeWorkspace({ workspaceRoot });
    const directory = join(workspaceRoot, 'knowledge', 'whitepapers', 'ai-companion');
    mkdirSync(directory, { recursive: true });
    const legacyPath = join(directory, 'legacy.md');
    const legacy = `---
id: kb_ai_legacy
title: 旧伴学规则
type: whitepaper_slice
module: ai-companion
intent: product_rule
source_type: whitepaper
confidence: medium
status: active
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-20
owner: product
chunking_strategy: semantic-section-v1
quality_status: warn
---

# 旧伴学规则

旧规则只可用于调查。
`;
    writeFileSync(legacyPath, legacy, 'utf8');
    updateKnowledgeIndex({ workspaceRoot });
    const report = generateKnowledgeMigrationReport({ workspaceRoot });
    assert.equal(report.parents.find((parent) => parent.id === 'kb_ai_legacy')?.directEligible, false);
    assert.equal(report.reviewQueue.some((item) => item.parentId === 'kb_ai_legacy'), true);
    assert.deepEqual(report.batches.map((batch) => batch.module), ['ai-companion', 'edusoho-training']);
    assert.equal(report.batches[0].status, 'blocked_missing_sources');
    assert.equal(report.batches[1].status, 'blocked_missing_sources');
    assert.equal(readFileSync(legacyPath, 'utf8'), legacy);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
