import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { resolveKnowledgeWorkspaceRoot } from '../dist/knowledge/index.js';
import { runOnboardingKnowledgePipeline } from '../dist/onboarding/knowledge-pipeline.js';
import { retrieveKnowledgeWithConfiguredRetrieval } from '../dist/retrieval/configured-search.js';
import { draftInputFixture } from './helpers/onboarding-fixtures.mjs';

test('production service and CLI complete a local grounded knowledge pipeline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-knowledge-acceptance-'));
  const projectRoot = join(root, 'project');
  const sourceDir = join(root, 'sources');
  const knowledgeBase = join(root, 'knowledge-store');
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'login.md'), [
    '# 登录失败处理规则', '',
    '当学员连续输入错误密码导致账号锁定时，支持人员必须先核对账号状态和认证日志，然后引导学员重置密码并再次验证登录结果。',
    '处理完成后需要记录核对时间、账号状态和最终验证结果，避免只凭现象判断原因。',
  ].join('\n'), 'utf8');
  const config = defaultConfig();
  config.knowledge.rootDir = knowledgeBase;
  config.workspaces = [{ id: 'current', name: 'Acceptance', rootPath: projectRoot, mcpToolIds: [] }];
  config.embedding.enabled = false;
  config.rerank.enabled = false;
  const workspaceRoot = resolveKnowledgeWorkspaceRoot(config, 'current');
  const draft = {
    ...draftInputFixture({
      workspace: { id: 'current', name: 'Acceptance', rootPath: projectRoot },
      knowledge: { rootDir: knowledgeBase, sourceDir, buildVectorIndex: false },
      embedding: { enabled: false },
      rerank: { enabled: false },
    }).draft,
    revision: 1,
    updatedAt: new Date().toISOString(),
  };
  try {
    const stages = [];
    const result = await runOnboardingKnowledgePipeline({ draft, workspaceRoot, report: (event) => stages.push(event.stage) });
    assert.equal(result.sources, 1);
    assert.ok(result.draftSlices >= 1);
    assert.ok(result.publishedSlices >= 1);
    assert.ok(result.indexedDocuments >= 1);
    assert.ok(result.indexedChunks >= 1);

    const retrieval = await retrieveKnowledgeWithConfiguredRetrieval({
      config,
      query: { workspaceRoot, query: '账号锁定后怎么处理登录失败', limit: 8 },
    });
    const evidence = retrieval.evidencePack.results[0];
    assert.ok(evidence, 'published parent must be retrievable');
    assert.equal(evidence.status, 'active');
    assert.ok(evidence.source_document_id);
    assert.ok(evidence.source_block_ids?.length);
    assert.ok(evidence.section_path?.length);
    assert.ok(stages.includes('extract_sources') && stages.includes('publish_approved'));

    const cli = spawnSync(process.execPath, [
      'dist/cli.js', 'knowledge', 'audit', '--workspace', projectRoot,
      '--knowledge-root', knowledgeBase, '--quality-gate', 'warn',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /quality report:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
