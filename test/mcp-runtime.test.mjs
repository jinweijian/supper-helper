import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { defaultConfig, loadConfig } from '../dist/config.js';
import { DiagnosticRuntime } from '../dist/runtime/diagnostic-runtime.js';
import { FileMemoryStore } from '../dist/sessions/file-memory-store.js';
import { startServer } from '../dist/gateway/http-server.js';
import { McpEvidenceService } from '../dist/mcp/evidence-service.js';
import { executeMcpTool, materializeMcpTransportConfig } from '../dist/mcp/policy.js';
import { createSdkMcpClient } from '../dist/mcp/sdk-client.js';
import { normalizeMcpResult } from '../dist/mcp/normalizer.js';

const fixtureRoot = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mcp');

async function startHttpFixture(mode) {
  const child = spawn(process.execPath, [join(fixtureRoot, 'http-server.mjs'), mode], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const line = await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`fixture timeout: ${stderr}`)), 5_000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline >= 0) {
        clearTimeout(timeout);
        resolve(stdout.slice(0, newline));
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!stdout.includes('\n')) reject(new Error(`fixture exited ${code}: ${stderr}`));
    });
  });
  const { port } = JSON.parse(line);
  return {
    url: `http://127.0.0.1:${port}`,
    async close() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    },
  };
}

function stdioServer(overrides = {}) {
  return {
    id: 'local-docs',
    name: 'Local Docs',
    protocol: 'stdio',
    permission: 'read_only',
    enabled: true,
    allowedToolNames: ['lookup'],
    timeoutMs: 15_000,
    config: { command: 'node', args: ['fixture.js'], env: {} },
    ...overrides,
  };
}

function policyInput(server, overrides = {}) {
  return {
    server,
    workspace: { id: 'current', mcpToolIds: ['local-docs'] },
    toolName: 'lookup',
    arguments: { query: 'safe' },
    stdioCommandWhitelist: ['node'],
    createClient: () => {
      throw new Error('transport factory must not be called');
    },
    ...overrides,
  };
}

test('legacy MCP config remains readable but cannot execute without allowedToolNames', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-config-migration-'));
  const path = join(root, 'config.json');
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge');
    config.mcpTools = [{
      id: 'local-docs',
      name: 'Local Docs',
      protocol: 'stdio',
      permission: 'read_only',
      enabled: true,
      config: { command: 'node', args: ['fixture.js'] },
    }];
    config.workspaces[0].mcpToolIds = ['local-docs'];
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    const loaded = loadConfig(path);
    assert.equal(loaded.mcpTools[0].id, 'local-docs');
    let clientFactoryCalls = 0;
    const result = await executeMcpTool(policyInput(loaded.mcpTools[0], {
      createClient: () => { clientFactoryCalls += 1; throw new Error('must not connect'); },
    }));
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, 'tool_allowlist_missing');
    assert.equal(clientFactoryCalls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, server, expectedReason] of [
  ['disabled server', stdioServer({ enabled: false }), 'server_disabled'],
  ['read-write server', stdioServer({ permission: 'read_write' }), 'server_not_read_only'],
  ['unlisted tool', stdioServer(), 'tool_not_allowed'],
  ['unknown stdio command', stdioServer({ config: { command: 'python', args: [] } }), 'stdio_command_not_allowed'],
]) {
  test(`${name} is rejected before transport creation`, async () => {
    let clientFactoryCalls = 0;
    const input = policyInput(server, {
      createClient: () => { clientFactoryCalls += 1; throw new Error('must not connect'); },
    });
    if (name === 'unlisted tool') input.toolName = 'delete_everything';
    const result = await executeMcpTool(input);
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, expectedReason);
    assert.equal(clientFactoryCalls, 0);
  });
}

test('workspace membership is checked before transport creation', async () => {
  let clientFactoryCalls = 0;
  const result = await executeMcpTool(policyInput(stdioServer(), {
    workspace: { id: 'other', mcpToolIds: [] },
    createClient: () => { clientFactoryCalls += 1; throw new Error('must not connect'); },
  }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'server_not_allowed_for_workspace');
  assert.equal(clientFactoryCalls, 0);
});

test('MCP header and env SecretRefs materialize only through the provided resolver', () => {
  const seen = [];
  const server = {
    id: 'remote',
    name: 'Remote',
    protocol: 'http',
    permission: 'read_only',
    enabled: true,
    allowedToolNames: ['lookup'],
    config: {
      url: 'http://127.0.0.1:43199/mcp',
      headers: {
        Authorization: { source: 'file', key: 'mcp.remote.authorization' },
        'X-Workspace': { source: 'env', name: 'MCP_WORKSPACE_HEADER' },
      },
    },
  };
  const materialized = materializeMcpTransportConfig(server, (ref) => {
    seen.push(ref);
    return ref.source === 'file' ? 'Bearer secret-value' : 'workspace-secret';
  });
  assert.deepEqual(seen, [
    { source: 'file', key: 'mcp.remote.authorization' },
    { source: 'env', name: 'MCP_WORKSPACE_HEADER' },
  ]);
  assert.equal(materialized.headers.Authorization, 'Bearer secret-value');
  assert.equal(materialized.headers['X-Workspace'], 'workspace-secret');
  assert.equal(JSON.stringify(server).includes('secret-value'), false);
});

test('production SDK adapter lists, calls, and closes a real stdio MCP process', async () => {
  const result = await executeMcpTool(policyInput(stdioServer({
    config: {
      command: process.execPath,
      args: [join(fixtureRoot, 'stdio-server.mjs')],
      env: {},
    },
  }), {
    stdioCommandWhitelist: [process.execPath],
    createClient: createSdkMcpClient,
  }));

  assert.equal(result.status, 'completed');
  assert.equal(result.toolName, 'lookup');
  assert.match(JSON.stringify(result.result), /stdio:safe/);
});

for (const protocol of ['http', 'sse']) {
  test(`production SDK adapter lists, calls, and closes a real ${protocol} MCP server`, async () => {
    const fixture = await startHttpFixture(protocol);
    try {
      const server = {
        id: `local-${protocol}`,
        name: `Local ${protocol}`,
        protocol,
        permission: 'read_only',
        enabled: true,
        allowedToolNames: ['lookup'],
        timeoutMs: 15_000,
        config: { url: `${fixture.url}/${protocol === 'http' ? 'mcp' : 'sse'}`, headers: {} },
      };
      const result = await executeMcpTool({
        ...policyInput(server),
        workspace: { id: 'current', mcpToolIds: [server.id] },
        createClient: createSdkMcpClient,
      });
      assert.equal(result.status, 'completed');
      assert.match(JSON.stringify(result.result), new RegExp(`${protocol}:safe`));
    } finally {
      await fixture.close();
    }
  });
}

test('MCP normalizer bounds text and structured content to 20,000 characters', () => {
  const normalized = normalizeMcpResult({
    content: [{ type: 'text', text: `Authorization: Bearer secret-token /Users/king/private.json\n${'x'.repeat(25_000)}` }],
    structuredContent: { status: 'ok', token: 'secret-token', detail: 'y'.repeat(5_000) },
  });
  assert.ok(JSON.stringify(normalized).length <= 20_500);
  assert.equal(normalized.truncated, true);
  assert.doesNotMatch(JSON.stringify(normalized), /secret-token|\/Users\/king|private\.json/);
  assert.match(normalized.text, /\[redacted\]|\[path\]/);
});

test('MCP normalizer replaces image and blob payloads with safe locators', () => {
  const imageData = Buffer.alloc(1_024, 7).toString('base64');
  const blobData = Buffer.alloc(2_048, 9).toString('base64');
  const normalized = normalizeMcpResult({
    content: [
      { type: 'image', mimeType: 'image/png', data: imageData },
      { type: 'resource', resource: { uri: 'memory://report', mimeType: 'application/pdf', blob: blobData } },
    ],
  });
  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(serialized, new RegExp(imageData.slice(0, 40)));
  assert.doesNotMatch(serialized, new RegExp(blobData.slice(0, 40)));
  assert.deepEqual(normalized.locators.map(({ kind, mimeType }) => ({ kind, mimeType })), [
    { kind: 'image', mimeType: 'image/png' },
    { kind: 'blob', mimeType: 'application/pdf' },
  ]);
  assert.deepEqual(normalized.locators.map((item) => item.sizeBytes), [1_024, 2_048]);
});

test('secret-bearing client creation errors degrade without exposing raw payload', async () => {
  const result = await executeMcpTool(policyInput(stdioServer(), {
    createClient: async () => {
      throw new Error('429 Authorization: Bearer remote-secret /Users/king/mcp.json');
    },
  }));
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'transport_failure');
  assert.doesNotMatch(JSON.stringify(result), /remote-secret|Authorization|\/Users\/king|mcp\.json/);
});

test('MCP policy enforces configured timeout and closes a hanging client', async () => {
  let closeCalls = 0;
  const never = new Promise(() => {});
  const execution = executeMcpTool(policyInput(stdioServer({ timeoutMs: 20 }), {
    createClient: async () => ({
      async listTools() { return [{ name: 'lookup' }]; },
      async callTool() { return never; },
      async close() { closeCalls += 1; },
    }),
  }));
  const result = await Promise.race([
    execution,
    new Promise((resolve) => setTimeout(() => resolve({ status: 'test_timeout' }), 250)),
  ]);
  assert.deepEqual(result, { status: 'failed', reason: 'timeout' });
  assert.equal(closeCalls, 1);
});

test('real Runtime performs two serial MCP calls and passes only normalized results to Worker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-runtime-chain-'));
  const config = defaultConfig();
  config.storage.rootDir = root;
  config.storage.isolateByWorkspace = false;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.knowledge.isolateByWorkspace = false;
  config.agent.modelProvider = undefined;
  config.agent.useModelForPreflight = false;
  config.agent.useModelForRagAnswerability = false;
  config.claude.enabled = false;
  config.claude.commandWhitelist = [process.execPath];
  config.workspaces = [{ id: 'current', name: 'Current', rootPath: root, mcpToolIds: ['local-docs'] }];
  config.mcpTools = [stdioServer({
    allowedToolNames: ['lookup', 'lookup_more', 'lookup_third'],
    config: { command: process.execPath, args: [join(fixtureRoot, 'stdio-server.mjs')], env: {} },
  })];

  const workerRequests = [];
  const worker = {
    async diagnose(request) {
      workerRequests.push(request);
      return {
        result: {
          status: 'concluded',
          summary: 'Worker completed after MCP evidence.',
          missingInfo: [],
          evidence: [{ id: 'worker_ev', kind: 'workspace', source: 'package.json', summary: 'worker evidence', confidence: 'high' }],
          claims: [{
            id: 'worker_claim',
            type: 'fact',
            role: 'primary_answer',
            text: 'Worker completed after reviewing MCP evidence.',
            evidenceIds: ['worker_ev'],
            answers: request.answerGoal.mustAnswerItems,
          }],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'fixture-worker', cwd: root, stdout: '{}', stderr: '', exitCode: 0,
          startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        },
      };
    },
  };

  try {
    const runtime = new DiagnosticRuntime(config, new FileMemoryStore(root), worker);
    await runtime.handleUserMessage({ workspaceId: 'current', message: '请检查 MCP 证据链的配置入口。' });
    assert.equal(workerRequests.length, 1);
    const mcp = workerRequests[0].context?.mcp;
    assert.equal(mcp.calls.length, 2);
    assert.deepEqual(mcp.calls.map((call) => call.toolName), ['lookup', 'lookup_more']);
    assert.match(mcp.calls[1].result.text, /previous=stdio:safe|previous=stdio:/);
    assert.doesNotMatch(JSON.stringify(mcp), /forbidden-third/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real Runtime reviews a fully covered MCP envelope and skips Worker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-runtime-full-'));
  const config = defaultConfig();
  config.storage.rootDir = root;
  config.storage.isolateByWorkspace = false;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.knowledge.isolateByWorkspace = false;
  config.agent.modelProvider = undefined;
  config.agent.useModelForPreflight = false;
  config.agent.useModelForRagAnswerability = false;
  config.claude.enabled = false;
  config.claude.commandWhitelist = [process.execPath];
  config.workspaces = [{ id: 'current', name: 'Current', rootPath: root, mcpToolIds: ['local-docs'] }];
  config.mcpTools = [stdioServer({
    allowedToolNames: ['answer'],
    config: { command: process.execPath, args: [join(fixtureRoot, 'stdio-server.mjs')], env: {} },
  })];
  let workerCalls = 0;
  const worker = { async diagnose() { workerCalls += 1; throw new Error('Worker must be skipped'); } };

  try {
    const runtime = new DiagnosticRuntime(config, new FileMemoryStore(root), worker);
    const response = await runtime.handleUserMessage({ workspaceId: 'current', message: '请确认配置证据路径。' });
    assert.equal(workerCalls, 0);
    assert.match(response.assistantMessage, /MCP 已确认配置证据路径/);
    assert.equal(response.caseSession.runs.at(-1).result.evidence[0].kind, 'mcp');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('agents API exposes non-visible MCP planner and extractor stages', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-agents-api-'));
  const config = defaultConfig();
  config.server.port = 0;
  config.storage.rootDir = root;
  config.storage.isolateByWorkspace = false;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.onboarding.completedAt = new Date().toISOString();
  let server;
  try {
    server = await startServer({ config });
    const body = await fetch(`${server.url}/api/agents`).then((response) => response.json());
    for (const stage of ['mcp_planner', 'mcp_evidence_extractor']) {
      const agent = body.agents.find((item) => item.stage === stage);
      assert.ok(agent, `${stage} must be registered`);
      assert.equal(agent.mayProduceUserFacingText, false);
      assert.match(agent.executionMode, /deterministic|model_assisted/);
    }
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('DiagnosticRuntime passes file SecretRef resolution into MCP transport materialization', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-runtime-secretref-'));
  const config = defaultConfig();
  config.storage.rootDir = root;
  config.storage.isolateByWorkspace = false;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.knowledge.isolateByWorkspace = false;
  config.agent.modelProvider = undefined;
  config.agent.useModelForPreflight = false;
  config.claude.enabled = false;
  config.workspaces = [{ id: 'current', name: 'Current', rootPath: root, mcpToolIds: ['remote'] }];
  config.mcpTools = [{
    id: 'remote', name: 'Remote', protocol: 'http', permission: 'read_only', enabled: true,
    allowedToolNames: ['lookup'],
    config: { url: 'http://127.0.0.1:1/mcp', headers: { Authorization: { source: 'file', key: 'mcp.remote' } } },
  }];
  let materializedAuthorization;
  const worker = { async diagnose(request) {
    return {
      result: { status: 'partial', summary: 'fallback', missingInfo: ['more'], evidence: [], claims: [], recommendedNextAction: 'ask_user' },
      trace: { command: 'fixture', cwd: root, stdout: '{}', stderr: '', exitCode: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
    };
  } };
  try {
    const runtime = new DiagnosticRuntime(config, new FileMemoryStore(root), worker, {
      mcp: {
        resolveSecret: () => 'Bearer resolved-secret',
        createClient: async ({ transport }) => {
          materializedAuthorization = transport.headers.Authorization;
          return {
            async listTools() { return [{ name: 'lookup' }]; },
            async callTool() { return { content: [{ type: 'text', text: 'safe evidence' }] }; },
            async close() {},
          };
        },
      },
    });
    await runtime.handleUserMessage({ workspaceId: 'current', message: '请检查 MCP 证据链的配置入口。' });
    assert.equal(materializedAuthorization, 'Bearer resolved-secret');
    assert.equal(JSON.stringify(config).includes('resolved-secret'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('extractor refuses schema-invalid envelopes instead of promoting assumptions to facts', async () => {
  const config = defaultConfig();
  config.claude.commandWhitelist = ['node'];
  config.workspaces[0].mcpToolIds = ['local-docs'];
  config.mcpTools = [stdioServer({ allowedToolNames: ['lookup'] })];
  const service = new McpEvidenceService(config, {
    createClient: async () => ({
      async listTools() { return [{ name: 'lookup' }]; },
      async callTool() {
        return {
          content: [{ type: 'text', text: 'untrusted hypothesis' }],
          structuredContent: {
            superHelperEvidence: {
              confidence: 'high',
              claims: [{ text: 'UNSAFE PROMOTION', type: 'assumption', role: 'primary_answer', answers: ['cause'] }],
            },
          },
        };
      },
      async close() {},
    }),
  });
  const request = {
    caseId: 'case_safe', runId: 'run_01', workspaceId: 'current', claudeSessionId: 'claude',
    answerGoal: { rawUserQuestion: 'q', resolvedQuestion: 'q', answerObject: 'x', mustAnswerItems: ['cause'], diagnosticObjective: 'd', sourceMessageIds: ['msg'] },
    userGoal: 'q', knownFacts: [], unknowns: [], constraints: [], allowedMcpToolIds: ['local-docs'],
  };
  const result = await service.run(request);
  assert.equal(result, undefined);
  assert.equal(request.context.mcp.evidence.length, 1);
});
