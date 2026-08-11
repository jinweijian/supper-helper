import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  auditKnowledgeQuality,
  discoverKnowledgeDocuments,
  evaluateQualityGate,
  initKnowledgeWorkspace,
  loadChunkQualityMap,
  publishKnowledgeGeneration,
  readActiveKnowledgeGeneration,
  updateKnowledgeIndex,
  writeKnowledgeQualityReport,
} from '../dist/knowledge/index.js';

function tempWorkspace() {
  return mkdtempSync(join(tmpdir(), 'super-helper-quality-fixtures-'));
}

function cleanup(workspace) {
  rmSync(workspace, { recursive: true, force: true });
}

function copyFixture(workspace, fixtureName) {
  const src = join(import.meta.dirname, 'fixtures', 'knowledge', 'quality', fixtureName);
  const destDir = join(workspace, 'knowledge', 'faq', 'general');
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, fixtureName);
  writeFileSync(dest, readFileSync(src, 'utf8'), 'utf8');
  return dest;
}

test('7.1 fixture: empty body slice is detected', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'empty-body.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const codes = report.issues.map((i) => i.code);
    assert.equal(codes.includes('empty_body'), true, `expected empty_body in ${codes.join(',')}`);
  } finally {
    cleanup(workspace);
  }
});

test('7.2 fixture: heading-only slice is detected', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'heading-only.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const codes = report.issues.map((i) => i.code);
    assert.equal(codes.includes('heading_only'), true, `expected heading_only in ${codes.join(',')}`);
  } finally {
    cleanup(workspace);
  }
});

test('7.3 fixture: table-of-contents slice is detected', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'toc-like.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const codes = report.issues.map((i) => i.code);
    assert.equal(codes.includes('toc_like'), true, `expected toc_like in ${codes.join(',')}`);
  } finally {
    cleanup(workspace);
  }
});

test('7.4 fixture: duplicate content pair is detected', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'duplicate-a.md');
    copyFixture(workspace, 'duplicate-b.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const duplicateIssues = report.issues.filter((i) => i.code === 'duplicate_content');
    assert.equal(duplicateIssues.length >= 1, true, `expected >=1 duplicate_content, got ${duplicateIssues.length}`);
  } finally {
    cleanup(workspace);
  }
});

test('7.4b published slice is not downgraded by its own draft mirror', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const publishedDir = join(workspace, 'knowledge', 'faq', 'general');
    const draftDir = join(workspace, 'knowledge', '_pipeline', 'drafts', 'src_mirror');
    mkdirSync(publishedDir, { recursive: true });
    mkdirSync(draftDir, { recursive: true });
    const body = `---
id: kb_mirror_feature
title: AI伴学助手功能清单
type: faq
module: ai-companion
intent: feature_overview
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
  - AI伴学助手
  - 功能清单
  - 学习问答
related_repos: []
last_verified_at: 2026-06-27
owner: knowledge-admin
source_document: knowledge/_sources/whitepapers/ai-companion.docx
source_document_id: src_mirror
source_block_ids:
  - blk_mirror_feature
section_path:
  - AI伴学助手
quality_status: ok
---

# AI伴学助手功能清单

AI伴学助手支持学习计划制定、督学提醒、学习问答、题目答疑和知识点诊断。AI伴学助手还支持按学习计划持续提醒，并根据课程内容提供有来源的学习辅助说明。
`;
    writeFileSync(join(publishedDir, 'mirror.md'), body, 'utf8');
    writeFileSync(join(draftDir, '001-mirror.md'), body.replace('status: active', 'status: draft'), 'utf8');
    updateKnowledgeIndex({ workspaceRoot: workspace });

    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const missingParentIssues = report.issues.filter((issue) => (
      issue.code === 'missing_parent' && issue.documentId === 'kb_mirror_feature'
    ));
    assert.deepEqual(
      missingParentIssues,
      [],
      'quality audit must read chunks from the active generation instead of stale flat artifacts',
    );
    const duplicateIssues = report.issues.filter((issue) => (
      issue.code === 'duplicate_content' && issue.documentId === 'kb_mirror_feature'
    ));
    assert.deepEqual(duplicateIssues, []);
    writeKnowledgeQualityReport({
      workspaceRoot: workspace,
      report: {
        ...report,
        issues: [{
          code: 'missing_parent',
          severity: 'warn',
          message: 'draft mirror has no published parent',
          documentId: 'kb_mirror_feature',
          source: 'knowledge/_pipeline/drafts/src_mirror/001-mirror.md',
        }],
      },
    });
    assert.equal(loadChunkQualityMap(workspace).get('kb_mirror_feature'), undefined);
  } finally {
    cleanup(workspace);
  }
});

test('7.5 fixture: missing source_document is flagged error', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'missing-source-document.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const issue = report.issues.find((i) => i.code === 'missing_source_document');
    assert.ok(issue, 'expected missing_source_document issue');
    assert.equal(issue.severity, 'error');
  } finally {
    cleanup(workspace);
  }
});

test('7.6 fixture: missing source_document_id is flagged error', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'missing-source-document-id.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const issue = report.issues.find((i) => i.code === 'missing_source_document_id');
    assert.ok(issue, 'expected missing_source_document_id issue');
    assert.equal(issue.severity, 'error');
  } finally {
    cleanup(workspace);
  }
});

test('7.7 fixture: orphan chunk is flagged error when parent is missing', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const update = updateKnowledgeIndex({ workspaceRoot: workspace });
    // Publish a complete generation containing a chunk whose parent_id does not exist.
    const badChunk = {
      chunk_id: 'chk_orphan_001',
      parent_id: 'kb_does_not_exist',
      artifact_version: 4,
      chunking_strategy: 'parent-child-v4',
      source: 'knowledge/faq/general/orphan.md',
      source_document: 'knowledge/_sources/whitepapers/test.docx',
      source_document_id: 'src_orphan',
      module: 'general',
      intent: 'how_to',
      source_type: 'faq',
      status: 'active',
      confidence: 'medium',
      headings: ['Orphan'],
      keywords: ['orphan'],
      text: 'orphan chunk text',
    };
    const manifest = JSON.parse(readFileSync(update.manifestPath, 'utf8'));
    manifest.chunk_count += 1;
    publishKnowledgeGeneration({
      workspaceRoot: workspace,
      expectedActiveGenerationId: readActiveKnowledgeGeneration(workspace)?.generation_id,
      mode: 'bm25_only',
      files: {
        'chunks.jsonl': `${readFileSync(update.chunksPath, 'utf8')}${JSON.stringify(badChunk)}\n`,
        'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
        'keyword-index.json': readFileSync(join(dirname(update.chunksPath), 'keyword-index.json'), 'utf8'),
      },
    });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const issue = report.issues.find((i) => i.code === 'orphan_chunk');
    assert.ok(issue, 'expected orphan_chunk issue');
  } finally {
    cleanup(workspace);
  }
});

test('7.8 fixture: draft slice without source_block_ids is flagged', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'missing-source-block-ids.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const issue = report.issues.find((i) => i.code === 'missing_source_block_ids');
    assert.ok(issue, 'expected missing_source_block_ids issue');
  } finally {
    cleanup(workspace);
  }
});

test('7.9 fixture: slice referencing missing source block is flagged', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    // Set up source meta and a real block so knownSourceBlockIds has something to compare against
    const sourcesDir = join(workspace, 'knowledge', '_sources', 'whitepapers');
    mkdirSync(sourcesDir, { recursive: true });
    writeFileSync(
      join(sourcesDir, 'test.docx.meta.json'),
      JSON.stringify({
        id: 'src_test_missing',
        source_type: 'whitepaper_docx',
        path: 'knowledge/_sources/whitepapers/test.docx',
        sha256: 'missing-hash',
        title: 'Test Missing',
        downloaded_at: new Date().toISOString(),
        product_versions: [],
        owner: 'knowledge-admin',
        ingest_tool_version: 'pipeline-v1',
      }) + '\n',
      'utf8',
    );
    const extractsDir = join(workspace, 'knowledge', '_pipeline', 'extracts');
    mkdirSync(extractsDir, { recursive: true });
    writeFileSync(
      join(extractsDir, 'src_test_missing.blocks.jsonl'),
      JSON.stringify({ block_id: 'blk_real_001', source_document_id: 'src_test_missing', order: 1, type: 'paragraph', text: 'real block', section_path: [] }) + '\n',
      'utf8',
    );
    copyFixture(workspace, 'missing-source-blocks.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const issue = report.issues.find((i) => i.code === 'missing_source_blocks');
    assert.ok(issue, `expected missing_source_blocks, got ${report.issues.map((i) => i.code).join(',')}`);
  } finally {
    cleanup(workspace);
  }
});

test('7.10 fixture: multi-topic slice is detected', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'multi-topic.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const issue = report.issues.find((i) => i.code === 'multi_topic_slice');
    assert.ok(issue, 'expected multi_topic_slice issue');
  } finally {
    cleanup(workspace);
  }
});

test('7.11 fixture: broken coreference is detected', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'broken-coreference.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const issue = report.issues.find((i) => i.code === 'broken_coreference');
    assert.ok(issue, 'expected broken_coreference issue');
  } finally {
    cleanup(workspace);
  }
});

test('7.12 fixture: not answer bearing slice is detected', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'not-answer-bearing.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const issue = report.issues.find((i) => i.code === 'not_answer_bearing');
    assert.ok(issue, 'expected not_answer_bearing issue');
  } finally {
    cleanup(workspace);
  }
});

test('7.13 fixture: too many unknown blocks raises warning', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    // Simulate an extract report with too many unknown blocks
    const extractReportPath = join(workspace, 'knowledge', '_pipeline', 'extracts', 'src_test_unknown.blocks.jsonl');
    writeFileSync(extractReportPath, '', 'utf8');
    const reportPath = join(workspace, 'knowledge', '_pipeline', 'extracts', 'src_test_unknown.extract-report.json');
    writeFileSync(
      reportPath,
      JSON.stringify({
        version: 1,
        sourceDocumentId: 'src_test_unknown',
        generatedAt: new Date().toISOString(),
        parserStrategy: 'local-docx-v1',
        blockCounts: { paragraph: 2, unknown: 8 },
        unknownBlockCount: 8,
        skippedTocCount: 0,
        warnings: ['Unknown block ratio (8/10) exceeds 0.3.'],
        errors: [],
        fatal: false,
      }) + '\n',
      'utf8',
    );
    // Also write a corresponding source meta so the loader finds it
    const sourcesDir = join(workspace, 'knowledge', '_sources', 'whitepapers');
    writeFileSync(
      join(sourcesDir, 'test.docx.meta.json'),
      JSON.stringify({
        id: 'src_test_unknown',
        source_type: 'whitepaper_docx',
        path: 'knowledge/_sources/whitepapers/test.docx',
        sha256: 'unknown-hash',
        title: 'Test Unknown',
        downloaded_at: new Date().toISOString(),
        product_versions: [],
        owner: 'knowledge-admin',
        ingest_tool_version: 'pipeline-v1',
      }) + '\n',
      'utf8',
    );
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const tooManyUnknown = report.issues.find((i) => i.code === 'too_many_unknown_blocks');
    assert.ok(tooManyUnknown, 'expected too_many_unknown_blocks issue');
  } finally {
    cleanup(workspace);
  }
});

test('7.14 fixture: source report with table loss is detected', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const sourcesDir = join(workspace, 'knowledge', '_sources', 'whitepapers');
    writeFileSync(
      join(sourcesDir, 'tabletest.docx.meta.json'),
      JSON.stringify({
        id: 'src_test_table',
        source_type: 'whitepaper_docx',
        path: 'knowledge/_sources/whitepapers/tabletest.docx',
        sha256: 'table-hash',
        title: 'Table Test',
        downloaded_at: new Date().toISOString(),
        product_versions: [],
        owner: 'knowledge-admin',
        ingest_tool_version: 'pipeline-v1',
      }) + '\n',
      'utf8',
    );
    const extractPath = join(workspace, 'knowledge', '_pipeline', 'extracts', 'src_test_table.extract-report.json');
    writeFileSync(
      extractPath,
      JSON.stringify({
        version: 1,
        sourceDocumentId: 'src_test_table',
        generatedAt: new Date().toISOString(),
        parserStrategy: 'local-docx-v1',
        blockCounts: { paragraph: 5 },
        unknownBlockCount: 0,
        skippedTocCount: 0,
        warnings: ['table_lost: DOCX table structure not preserved.'],
        errors: [],
        fatal: false,
      }) + '\n',
      'utf8',
    );
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const tableLost = report.issues.find((i) => i.code === 'table_lost');
    assert.ok(tableLost, 'expected table_lost issue');
  } finally {
    cleanup(workspace);
  }
});

test('7.15 CLI: warn gate exits 0 and writes report', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'empty-body.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const result = spawnSync(
      'node',
      ['dist/cli.js', 'knowledge', 'audit', '--workspace', workspace, '--knowledge-root', workspace, '--quality-gate', 'warn'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /quality report/);
  } finally {
    cleanup(workspace);
  }
});

test('7.16 CLI: strict gate exits non-zero when error issue exists', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'missing-source-document.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const result = spawnSync(
      'node',
      ['dist/cli.js', 'knowledge', 'audit', '--workspace', workspace, '--knowledge-root', workspace, '--quality-gate', 'strict'],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0, `expected non-zero exit, got ${result.status}`);
  } finally {
    cleanup(workspace);
  }
});

test('7.17 regression: discoverable documents count is stable across runs', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    copyFixture(workspace, 'empty-body.md');
    copyFixture(workspace, 'heading-only.md');
    copyFixture(workspace, 'multi-topic.md');
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const first = discoverKnowledgeDocuments(workspace);
    const second = discoverKnowledgeDocuments(workspace);
    assert.equal(first.length, second.length);
    assert.equal(first.length >= 3, true, `expected >=3 docs, got ${first.length}`);
  } finally {
    cleanup(workspace);
  }
});

test('7.18 regression: _pipeline/drafts/*.md is excluded from discovery', () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const draftsDir = join(workspace, 'knowledge', '_pipeline', 'drafts', 'src_test_pipeline_drafts');
    mkdirSync(draftsDir, { recursive: true });
    writeFileSync(
      join(draftsDir, '001-draft.md'),
      `---
id: drf_test_draft_001
title: 草稿
type: whitepaper_slice
module: general
intent: product_rule
source_type: whitepaper
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
source_document_id: src_test_draft
source_block_ids:
  - blk_test_draft_00001
section_path: []
chunking_strategy: semantic-section-v2
pipeline_stage: slice
pipeline_status: draft
quality_status: unchecked
---

# 草稿

## 核心内容

草稿内容不应被 search 索引。
`,
      'utf8',
    );
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const docs = discoverKnowledgeDocuments(workspace);
    const draftDoc = docs.find((d) => d.frontmatter.id === 'drf_test_draft_001');
    assert.equal(draftDoc, undefined, 'draft slices must not be discoverable');
  } finally {
    cleanup(workspace);
  }
});

test('gate evaluator: warn returns passed:true with no errors, strict returns passed:false with errors', () => {
  const report = {
    version: 1,
    workspaceRoot: '/tmp',
    knowledgeRoot: '/tmp/knowledge',
    generatedAt: new Date().toISOString(),
    thresholds: { minBodyChars: 80, maxParentChars: 2800, maxUnknownBlockRatio: 0.3, minRelatedTerms: 3, maxDuplicateNormalizedHashes: 1, multiTopicHeadingThreshold: 3 },
    inspected: { sourceDocuments: 0, draftSlices: 0, publishedSlices: 0, chunks: 0 },
    stageSummaries: {},
    severityCounts: { info: 0, warn: 0, error: 0 },
    issueCounts: {},
    issues: [],
    recommendedActions: [],
    gate: 'warn',
  };
  assert.equal(evaluateQualityGate(report, 'off').passed, true);
  assert.equal(evaluateQualityGate(report, 'warn').passed, true);
  report.severityCounts.error = 1;
  assert.equal(evaluateQualityGate(report, 'warn').passed, true, 'warn gate still passes with errors');
  assert.equal(evaluateQualityGate(report, 'strict').passed, false);
  assert.equal(evaluateQualityGate(report, 'strict').exitCode, 2);
});
