import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { initKnowledgeWorkspace, updateKnowledgeIndex } from '../dist/knowledge/index.js';
import { loadRuntimeRetrievalEvaluationQuestions, runRuntimeRetrievalEvaluation } from '../dist/runtime/retrieval-evaluation.js';

function writeFixture(workspaceRoot) {
  const directory = join(workspaceRoot, 'knowledge', 'faq', 'course');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'visibility.md'), `---
id: kb_course_visibility
title: 课程发布可见性规则
type: faq
module: course
intent: how_to
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
  - 课程发布
  - 学员可见
related_repos: []
last_verified_at: 2026-06-20
owner: support
source_document: knowledge/_sources/manual/course.md
source_document_id: src_course
source_block_ids:
  - blk_visibility
section_path:
  - 课程管理
  - 发布与可见性
quality_status: ok
---

# 课程发布可见性规则

课程发布后，学员需要满足可加入范围与有效期条件才能看到加入入口。
`, 'utf8');
}

test('production retrieval evaluation reuses runtime composition and enforces safety metrics offline', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-runtime-eval-'));
  try {
    initKnowledgeWorkspace({ workspaceRoot });
    writeFixture(workspaceRoot);
    updateKnowledgeIndex({ workspaceRoot });
    const config = defaultConfig();
    config.embedding.enabled = false;
    config.rerank.enabled = false;

    const report = await runRuntimeRetrievalEvaluation({
      config,
      workspaceRoot,
      questions: [
        {
          id: 'direct',
          question: '课程发布可见性规则是什么？',
          expectedParentId: 'kb_course_visibility',
          expectedBehavior: 'direct',
          category: 'exact',
          split: 'holdout',
        },
        {
          id: 'abstain',
          question: '课程怎么使用？',
          expectedBehavior: 'abstain',
          category: 'generic',
          split: 'holdout',
        },
        {
          id: 'escalate',
          question: '当前 /api/course 返回 500 的 controller 实现哪里有问题？',
          expectedBehavior: 'escalate',
          category: 'implementation_risk',
          split: 'holdout',
        },
        {
          id: 'partial-hit',
          question: '课程发布可见性规则有没有命令行处理？',
          expectedParentId: 'kb_course_visibility',
          expectedBehavior: 'escalate',
          category: 'paraphrase',
          split: 'holdout',
        },
      ],
      coverageReviewer: {
        async review(input) {
          assert.equal(input.evidenceSegments.every((item) => Array.from(item.text).length <= 500), true);
          if (input.questionId === 'partial-hit') {
            return {
              fullQuestion: 'partial',
              missingElements: ['未被当前证据覆盖的用户可见子问题'],
            };
          }
          return { fullQuestion: 'full', missingElements: [] };
        },
      },
      reportPath: join(workspaceRoot, 'reports', 'runtime-retrieval-eval.json'),
    });

    assert.equal(report.passed, true, JSON.stringify(report.failures));
    assert.equal(report.metrics.recallAt5, 1);
    assert.equal(report.metrics.mrr, 1);
    assert.equal(report.metrics.directAnswerPrecision, 1);
    assert.equal(report.metrics.abstentionAccuracy, 1);
    assert.equal(report.metrics.mustEscalateAccuracy, 1);
    assert.equal(report.splitMetrics.holdout.directAnswerPrecision, 1);
    assert.equal(report.questions[0].trace.strategies.find((item) => item.id === 'embedding')?.status, 'skipped');
    assert.equal(report.questions[1].answerable, false);
    assert.equal(report.questions[2].blockers.includes('implementation_detail'), true);
    const partialHit = report.questions.find((question) => question.id === 'partial-hit');
    assert.equal(partialHit.retrievalHit, true);
    assert.equal(partialHit.answerability, 'partial');
    assert.equal(partialHit.coveredClaimCount > 0, true);
    assert.deepEqual(partialHit.missingElements, ['未被当前证据覆盖的用户可见子问题']);
    assert.equal(partialHit.passed, true);
    assert.equal(JSON.stringify(report).includes('课程发布后，学员需要满足'), false);

    const questionsPath = join(workspaceRoot, 'runtime-eval-questions.json');
    writeFileSync(questionsPath, `${JSON.stringify({ questions: [{
      id: 'cli-direct',
      question: '课程发布可见性规则是什么？',
      expected_parent_id: 'kb_course_visibility',
      expected_behavior: 'direct',
    }] })}\n`, 'utf8');
    const cli = spawnSync(process.execPath, [
      'dist/cli.js',
      'retrieval',
      'eval',
      '--workspace', workspaceRoot,
      '--knowledge-root', workspaceRoot,
      '--questions', questionsPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const cliReport = JSON.parse(cli.stdout);
    assert.equal(cliReport.passed, true);
    assert.equal(cliReport.offline, true);

    const productionSet = loadRuntimeRetrievalEvaluationQuestions(join(
      process.cwd(),
      'test',
      'fixtures',
      'retrieval',
      'production-eval-50.json',
    ));
    assert.equal(productionSet.length, 50);
    assert.equal(productionSet.filter((question) => question.split === 'calibration').length, 35);
    assert.equal(productionSet.filter((question) => question.split === 'holdout').length, 15);
    assert.deepEqual(Object.fromEntries(['exact', 'paraphrase', 'generic', 'no_hit', 'implementation_risk', 'visibility_stale_conflict'].map((category) => [
      category,
      productionSet.filter((question) => question.category === category).length,
    ])), {
      exact: 12,
      paraphrase: 10,
      generic: 8,
      no_hit: 8,
      implementation_risk: 6,
      visibility_stale_conflict: 6,
    });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
