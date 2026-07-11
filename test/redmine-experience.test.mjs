import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initKnowledgeWorkspace, readKnowledgeChunks, updateKnowledgeIndex } from '../dist/knowledge/index.js';
import { importRedmineIssueFixture } from '../dist/knowledge/redmine-card.js';

test('Redmine issue fixture becomes a review-required solved case card with source provenance', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-redmine-'));
  try {
    const emptySourceDir = join(workspaceRoot, 'empty-source');
    mkdirSync(emptySourceDir, { recursive: true });
    initKnowledgeWorkspace({ workspaceRoot, sourceDir: emptySourceDir, qualityGate: 'off' });
    const result = importRedmineIssueFixture({
      workspaceRoot,
      issuePath: join(process.cwd(), 'test', 'fixtures', 'redmine', 'issue-12345.json'),
    });

    assert.equal(result.issueId, 12345);
    assert.equal(result.documentId, 'kb_redmine_12345');
    assert.match(result.cardPath, /knowledge\/tickets\/solved-cases\/edusoho-training\/kb_redmine_12345\.md$/);
    assert.match(result.sourcePath, /knowledge\/_sources\/redmine\/issues\/12345\.json$/);
    assert.equal(existsSync(result.sourcePath), true);
    assert.equal(existsSync(result.cardPath), true);

    const card = readFileSync(result.cardPath, 'utf8');
    assert.match(card, /type: solved_case/);
    assert.match(card, /source_type: solved_case/);
    assert.match(card, /status: review_required/);
    assert.match(card, /quality_status: unchecked/);
    assert.match(card, /external_source: redmine/);
    assert.match(card, /redmine_issue_id: 12345/);
    assert.match(card, /verification_status: partially_verified/);
    assert.match(card, /coverage_level: partial/);
    assert.match(card, /source_document: knowledge\/_sources\/redmine\/issues\/12345\.json/);
    assert.match(card, /source_document_id: redmine_issue_12345/);
    assert.match(card, /redmine_12345_description/);
    assert.match(card, /redmine_12345_journal_8/);
    assert.match(card, /redmine_12345_journal_12/);
    assert.match(card, /## 用户原始问题/);
    assert.match(card, /## 已验证事实/);
    assert.match(card, /## 仍需验证/);

    updateKnowledgeIndex({ workspaceRoot });
    const chunks = readKnowledgeChunks(workspaceRoot).chunks;
    const cardChunks = chunks.filter((chunk) => chunk.parent_id === 'kb_redmine_12345');
    assert.equal(cardChunks.length > 0, true);
    assert.equal(cardChunks.every((chunk) => chunk.status === 'review_required'), true);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
