import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { createKnowledgeManagementService } from '../dist/application/knowledge-management-service.js';
import { startServer } from '../dist/gateway/http-server.js';
import { buildKnowledgeVectorIndex, initKnowledgeWorkspace, resolveKnowledgeWorkspaceRoot, updateKnowledgeIndex } from '../dist/knowledge/index.js';
import { createEmbeddingProvider } from '../dist/providers/embedding/index.js';
import { FileMemoryStore } from '../dist/sessions/file-memory-store.js';
import { resolveSessionStorageRoot } from '../dist/sessions/storage-scope.js';

const repoRoot = new URL('..', import.meta.url).pathname;

test('knowledge production modules do not import retrieval or provider factories', () => {
  const files = sourceFiles(join(repoRoot, 'src/knowledge'));
  const violations = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return /from\s+['"][^'"]*(?:retrieval|providers)\//.test(source) ? [file] : [];
  });
  assert.deepEqual(violations, []);
});

test('Gateway routes depend on the application knowledge use case', () => {
  for (const relative of ['src/gateway/routes/session-routes.ts', 'src/gateway/routes/knowledge-routes.ts']) {
    const source = readFileSync(join(repoRoot, relative), 'utf8');
    assert.match(source, /application\/knowledge-management-service/);
    assert.doesNotMatch(source, /knowledge\/health-service|retrieval\/configured-search|providers\//);
  }
});

test('real HTTP local health stays offline and explicit query probes production retrieval once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-app-health-'));
  const projectRoot = join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const trap = await startProviderTrap();
  let server;
  try {
    const config = defaultConfig();
    config.server.host = '127.0.0.1';
    config.server.port = 0;
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge-store');
    config.workspaces = [{ id: 'current', name: 'Current', rootPath: projectRoot, mcpToolIds: [] }];
    config.onboarding.completedAt = new Date().toISOString();
    config.embedding.enabled = false;
    config.rerank = {
      enabled: true,
      provider: 'siliconflow',
      baseUrl: trap.url,
      apiKey: 'trap-secret',
      model: 'trap-rerank',
      topN: 5,
      timeoutMs: 1000,
    };

    const knowledgeRoot = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot: knowledgeRoot });
    writeActiveFaq(knowledgeRoot);
    updateKnowledgeIndex({ workspaceRoot: knowledgeRoot });

    const store = new FileMemoryStore(resolveSessionStorageRoot(config));
    const caseSession = store.createCase({ tenantId: 'local', userId: 'local-user', workspaceId: 'current', title: '密码问题' });
    store.addMessage(caseSession, { role: 'user', body: '怎么重置密码' });

    server = await startServer({ config, onboarding: completedOnboarding() });
    const loaded = await fetch(`${server.url}/api/session?caseId=${caseSession.id}`).then((response) => response.json());
    assert.equal(loaded.session.knowledgeHealth.search.query, '');
    assert.equal(loaded.session.knowledgeHealth.search.reason, 'waiting for an explicit retrieval probe');
    assert.equal(trap.requests.length, 0);

    const local = await fetch(`${server.url}/api/knowledge/health?workspaceId=current`).then((response) => response.json());
    assert.equal(local.knowledgeHealth.search.query, '');
    assert.equal(trap.requests.length, 0);

    const probed = await fetch(`${server.url}/api/knowledge/health?workspaceId=current&query=${encodeURIComponent('怎么重置密码')}`).then((response) => response.json());
    assert.equal(probed.knowledgeHealth.search.query, '怎么重置密码');
    assert.equal(probed.knowledgeHealth.search.matchedFiles, 1);
    assert.equal(trap.requests.length, 1);
    assert.equal(trap.requests[0].authorization, 'Bearer trap-secret');

    await fetch(`${server.url}/api/knowledge/bind`, jsonBody({ workspaceId: 'current', query: '不得隐式 probe' }));
    await fetch(`${server.url}/api/knowledge/reindex`, jsonBody({ workspaceId: 'current', query: '不得隐式 probe' }));
    assert.equal(trap.requests.length, 1);
  } finally {
    await server?.close();
    await trap.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit probe reuses BM25, fake embedding, and fake rerank production composition', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-app-probe-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge-store');
    config.workspaces = [{ id: 'current', name: 'Current', rootPath: join(root, 'project'), mcpToolIds: [] }];
    config.embedding = { enabled: true, provider: 'fake', model: 'fake-embedding', dimensions: 4, distance: 'cosine', batchSize: 4, timeoutMs: 1000 };
    config.rerank = { enabled: true, provider: 'fake', model: 'fake-rerank', topN: 5, timeoutMs: 1000 };
    const workspaceRoot = resolveKnowledgeWorkspaceRoot(config, 'current');
    initKnowledgeWorkspace({ workspaceRoot });
    writeActiveFaq(workspaceRoot);
    updateKnowledgeIndex({ workspaceRoot });
    await buildKnowledgeVectorIndex({
      workspaceRoot,
      provider: createEmbeddingProvider(config.embedding),
      config: config.embedding,
    });

    const result = await createKnowledgeManagementService(config).probeSearch('current', '怎么重置密码');
    assert.equal(result.trace.strategies.find((item) => item.id === 'bm25')?.status, 'ran');
    assert.equal(result.trace.strategies.find((item) => item.id === 'embedding')?.status, 'ran');
    assert.equal(result.trace.rerank.status, 'ran');
    assert.equal(result.knowledgeHealth.search.matchedFiles, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function sourceFiles(root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function writeActiveFaq(workspaceRoot) {
  const dir = join(workspaceRoot, 'knowledge', 'faq', 'account');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'password-reset.md'), `---
id: faq_password_reset
title: 重置密码
type: faq
module: account
intent: how_to
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
  - 重置密码
related_repos: []
last_verified_at: 2026-07-11
owner: support
source_document: knowledge/_sources/manual/password.md
source_document_id: src_password
source_block_ids:
  - blk_password
section_path:
  - 重置密码
quality_status: ok
---

# 重置密码

在账号设置页选择重置密码，并通过邮件验证码完成确认。
`, 'utf8');
}

function jsonBody(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function completedOnboarding() {
  return { getState: () => ({ completed: true, needsReview: false }) };
}

async function startProviderTrap() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push({ path: request.url, authorization: request.headers.authorization, body });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      results: body.documents.map((_document, index) => ({ index, relevance_score: 1 - index * 0.01 })),
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
