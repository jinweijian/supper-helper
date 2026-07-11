import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import process from 'node:process';
import test from 'node:test';
import { startServer } from '../dist/gateway/http-server.js';
import { DiagnosticRuntime } from '../dist/runtime/diagnostic-runtime.js';
import { FileMemoryStore } from '../dist/sessions/file-memory-store.js';

function safetyConfig(rootDir, host = '127.0.0.1') {
  return {
    version: 1,
    server: { host, port: 0, bindMode: host === '0.0.0.0' ? 'lan' : 'loopback' },
    storage: { rootDir, isolateByWorkspace: false },
    knowledge: {
      rootDir: join(rootDir, 'knowledge'),
      isolateByWorkspace: false,
      buildVectorIndex: false,
      projectType: 'generic',
    },
    agent: {
      name: 'super helper',
      language: 'zh-CN',
      tone: 'calm_professional',
      useModelForPreflight: false,
      useModelForRagAnswerability: false,
      useModelForEvidenceCoverage: false,
      defaultUserPersona: 'operations',
      contextWindowTokens: 200_000,
    },
    models: { providers: {} },
    embedding: { enabled: false, provider: 'fake', model: 'fake', dimensions: 8, distance: 'cosine', batchSize: 4, timeoutMs: 1000 },
    rerank: { enabled: false, provider: 'fake', model: 'fake', timeoutMs: 1000, topN: 8 },
    claude: {
      enabled: false,
      command: 'claude',
      commandWhitelist: ['claude'],
      permissionMode: 'dontAsk',
      tools: ['Read', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Glob', 'Grep'],
      disallowedTools: ['Bash', 'Edit', 'Write'],
      timeoutMs: 1000,
      sessionBusyMaxRetries: 0,
      sessionBusyRetryDelayMs: 1,
    },
    workspaces: [{ id: 'current', name: 'Current Project', rootPath: process.cwd(), mcpToolIds: [] }],
    mcpTools: [],
    onboarding: { version: 1, completedAt: new Date().toISOString() },
  };
}

function storedCase(id, workspaceId = 'current') {
  return {
    id,
    claudeSessionId: 'claude-safe-test',
    tenantId: 'local',
    userId: 'local-user',
    workspaceId,
    title: 'sentinel',
    status: 'collecting_input',
    userPersona: 'operations',
    messages: [],
    runs: [],
    logs: [],
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sendChunkedJson(url, chunks) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, (res) => {
      const responseChunks = [];
      res.on('data', (chunk) => responseChunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(responseChunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

test('gateway rejects traversal case identifiers and preserves the outside sentinel', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-case-safety-'));
  const sentinelPath = join(root, 'sentinel.json');
  const sentinelBody = `${JSON.stringify(storedCase('sentinel'), null, 2)}\n`;
  writeFileSync(sentinelPath, sentinelBody, 'utf8');
  const beforeHash = sha256(sentinelBody);
  let server;

  try {
    server = await startServer({ config: safetyConfig(root) });
    const traversal = encodeURIComponent('../sentinel');
    const requests = [
      fetch(`${server.url}/api/session?caseId=${traversal}&includeKnowledgeHealth=false`),
      fetch(`${server.url}/api/session?caseId=${traversal}`, { method: 'DELETE' }),
      fetch(`${server.url}/api/session`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: '../sentinel', action: 'archive' }),
      }),
      fetch(`${server.url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: '../sentinel', message: '只读检查', async: true }),
      }),
    ];

    const responses = await Promise.all(requests);
    assert.deepEqual(responses.map((response) => response.status), [400, 400, 400, 400]);
    assert.equal(existsSync(sentinelPath), true);
    assert.equal(sha256(readFileSync(sentinelPath)), beforeHash);
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('gateway rejects workspace identifiers not present in configuration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-workspace-safety-'));
  let server;
  try {
    server = await startServer({ config: safetyConfig(root) });
    const responses = await Promise.all([
      fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: '../unknown' }),
      }),
      fetch(`${server.url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'unknown', message: '检查配置', async: true }),
      }),
      fetch(`${server.url}/api/knowledge/health?workspaceId=${encodeURIComponent('unknown')}`),
    ]);

    assert.deepEqual(responses.map((response) => response.status), [400, 400, 400]);
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('FileMemoryStore rejects traversal even when called without the gateway', () => {
  const root = mkdtempSync(join(tmpdir(), 'repository-case-safety-'));
  const sentinelPath = join(root, 'sentinel.json');
  const sentinelBody = `${JSON.stringify(storedCase('sentinel'), null, 2)}\n`;
  writeFileSync(sentinelPath, sentinelBody, 'utf8');
  const store = new FileMemoryStore(root);

  try {
    assert.throws(() => store.casePath('../sentinel'), /invalid case id/i);
    assert.throws(() => store.casePath('%2e%2e%2fsentinel'), /invalid case id/i);
    assert.throws(() => store.loadCase('../sentinel'), /invalid case id/i);
    assert.throws(() => store.deleteCase('../sentinel'), /invalid case id/i);
    assert.throws(() => store.saveCase(storedCase('../sentinel')), /invalid case id/i);
    assert.equal(readFileSync(sentinelPath, 'utf8'), sentinelBody);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('DiagnosticRuntime rejects an unconfigured workspace when gateway is bypassed', () => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-workspace-safety-'));
  const config = safetyConfig(root);
  const store = new FileMemoryStore(root);
  const worker = { async diagnose() { throw new Error('worker must not run'); } };
  const runtime = new DiagnosticRuntime(config, store, worker);
  try {
    assert.throws(
      () => runtime.startUserTurn({ workspaceId: '../unknown', message: '检查配置' }),
      /invalid workspaceId/i,
    );
    assert.equal(store.listCases().length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gateway rejects bodies above 1 MiB and remains usable for the next request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-body-limit-'));
  let server;
  try {
    server = await startServer({ config: safetyConfig(root) });
    const oversizedBody = JSON.stringify({ padding: 'x'.repeat(1_048_576) });
    assert.ok(Buffer.byteLength(oversizedBody) > 1_048_576);

    const oversized = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: oversizedBody,
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { error: 'payload too large' });

    const normal = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ title: 'still healthy', workspaceId: 'current' }),
    });
    assert.equal(normal.status, 200);
    assert.equal((await normal.json()).session.title, 'still healthy');
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('gateway enforces the 1 MiB limit for chunked bodies without Content-Length', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-chunked-limit-'));
  let server;
  try {
    server = await startServer({ config: safetyConfig(root) });
    const chunks = Array.from({ length: 17 }, () => Buffer.alloc(65_536, 0x78));
    const response = await sendChunkedJson(`${server.url}/api/sessions`, chunks);
    assert.equal(response.status, 413);
    assert.deepEqual(JSON.parse(response.body), { error: 'payload too large' });
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('gateway rejects chat messages above 64 KiB by UTF-8 byte length', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-message-limit-'));
  let server;
  try {
    server = await startServer({ config: safetyConfig(root) });
    const message = '界'.repeat(21_846);
    assert.equal(Buffer.byteLength(message), 65_538);
    const response = await fetch(`${server.url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, workspaceId: 'current', async: true }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'message too large' });
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('gateway maps malformed JSON to a stable 400 response', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-json-error-'));
  let server;
  try {
    server = await startServer({ config: safetyConfig(root) });
    const response = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"broken":',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid JSON body' });
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown gateway failures expose a generic error and record only redacted diagnostics', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-error-redaction-'));
  const diagnostics = [];
  const secret = 'top-secret-value';
  const privatePath = '/Users/king/private/customer.json';
  const onboarding = {
    getState() {
      throw new Error(`Authorization: Bearer ${secret}; token=${secret}; path=${privatePath}`);
    },
  };
  let server;
  try {
    server = await startServer({
      config: safetyConfig(root),
      onboarding,
      onInternalError: (message) => diagnostics.push(message),
    });
    const response = await fetch(`${server.url}/`);
    const responseText = await response.text();
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(responseText), { error: 'internal server error' });
    assert.doesNotMatch(responseText, /Authorization|top-secret-value|\/Users\/king|customer\.json/i);
    assert.equal(diagnostics.length, 1);
    assert.doesNotMatch(diagnostics[0], /Authorization|top-secret-value|\/Users\/king|customer\.json/i);
    assert.match(diagnostics[0], /\[redacted\]|\[path\]/i);
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const faultPoint of ['write', 'fsync', 'rename']) {
  test(`atomic Case replacement preserves the old file when ${faultPoint} fails`, () => {
    const root = mkdtempSync(join(tmpdir(), `case-atomic-${faultPoint}-`));
    const initialStore = new FileMemoryStore(root);
    const original = initialStore.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: 'last valid title',
    });
    const casePath = initialStore.casePath(original.id);
    const before = readFileSync(casePath, 'utf8');
    const beforeHash = sha256(before);

    const fileOperations = {
      openSync,
      writeFileSync: faultPoint === 'write'
        ? () => { throw new Error('injected write interruption'); }
        : writeFileSync,
      fsyncSync: faultPoint === 'fsync'
        ? () => { throw new Error('injected fsync interruption'); }
        : fsyncSync,
      closeSync,
      renameSync: faultPoint === 'rename'
        ? () => { throw new Error('injected rename interruption'); }
        : renameSync,
      unlinkSync,
    };
    const failingStore = new FileMemoryStore(root, { fileOperations });
    const replacement = { ...original, title: 'must not replace old file' };

    try {
      assert.throws(() => failingStore.saveCase(replacement), new RegExp(`injected ${faultPoint}`));
      const persisted = readFileSync(casePath, 'utf8');
      assert.equal(sha256(persisted), beforeHash);
      assert.equal(JSON.parse(persisted).title, 'last valid title');
      assert.deepEqual(failingStore.listCases().map((item) => item.id), [original.id]);
      assert.deepEqual(readdirSync(failingStore.casesDir).filter((name) => name.includes('.tmp')), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('successful Case replacement preserves top-level shape and leaves no temporary file', () => {
  const root = mkdtempSync(join(tmpdir(), 'case-atomic-success-'));
  const store = new FileMemoryStore(root);
  try {
    const original = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId: 'current',
      title: 'before',
    });
    const beforeKeys = Object.keys(JSON.parse(readFileSync(store.casePath(original.id), 'utf8'))).sort();
    original.title = 'after';
    store.saveCase(original);
    const persisted = JSON.parse(readFileSync(store.casePath(original.id), 'utf8'));
    assert.equal(persisted.title, 'after');
    assert.deepEqual(Object.keys(persisted).sort(), beforeKeys);
    assert.deepEqual(readdirSync(store.casesDir).filter((name) => name.includes('.tmp')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy Case JSON remains readable and is rewritten without a wrapper shape', () => {
  const root = mkdtempSync(join(tmpdir(), 'case-legacy-compatibility-'));
  const store = new FileMemoryStore(root);
  const legacy = {
    id: 'case_legacy_safe',
    tenantId: 'local',
    userId: 'local-user',
    workspaceId: 'current',
    title: 'legacy',
    status: 'collecting_input',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
  writeFileSync(store.casePath(legacy.id), `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
  try {
    const loaded = store.loadCase(legacy.id);
    assert.equal(loaded?.id, legacy.id);
    assert.deepEqual(loaded?.messages, []);
    const persisted = JSON.parse(readFileSync(store.casePath(legacy.id), 'utf8'));
    assert.equal(persisted.id, legacy.id);
    assert.equal('case' in persisted, false);
    assert.equal('data' in persisted, false);
    assert.deepEqual(readdirSync(store.casesDir).filter((name) => name.includes('.tmp')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const host of ['127.0.0.1', '0.0.0.0']) {
  test(`real ${host} server keeps unauthenticated health, session, and chat flows`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-bind-smoke-'));
    let server;
    try {
      server = await startServer({ config: safetyConfig(root, host) });
      assert.equal(server.listenHost, host);
      const health = await fetch(`${server.url}/api/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true, service: 'super-helper' });

      const created = await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'bind smoke', workspaceId: 'current' }),
      });
      assert.equal(created.status, 200);
      const createdBody = await created.json();

      const chat = await fetch(`${server.url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          caseId: createdBody.session.id,
          workspaceId: 'current',
          message: '检查当前服务',
          async: true,
        }),
      });
      assert.equal(chat.status, 202);
      assert.equal((await chat.json()).accepted, true);
    } finally {
      await server?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
