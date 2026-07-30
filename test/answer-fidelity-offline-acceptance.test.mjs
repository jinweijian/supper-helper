import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { DiagnosticRuntime } from '../dist/runtime/diagnostic-runtime.js';
import { FileMemoryStore } from '../dist/storage.js';
import { initKnowledgeWorkspace } from '../dist/knowledge/index.js';
import { rebuildKnowledgeArtifacts } from '../dist/application/knowledge-rebuild-service.js';
import { createEmbeddingProvider } from '../dist/providers/embedding/index.js';
import { retrieveKnowledgeWithConfiguredRetrieval } from '../dist/retrieval/configured-search.js';

const QUESTION = '如何开启 search.provider，以及多久生效？';
const HOW = '如何开启 search.provider';
const WHEN = '多久生效';

test('cross-gate offline production composition preserves complete reviewed answers without network or secret reads', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('offline acceptance forbids network');
  };
  const totalCounts = {
    preflight: 0,
    completeness: 0,
    coverage: 0,
    promptSafety: 0,
    presentation: 0,
    secretResolver: 0,
  };
  try {
    const providerCounts = await exerciseOfflineRetrievalProviders();
    assert.deepEqual(providerCounts, {
      embeddingBuildBatches: 1,
      embeddingRecallStrategies: 1,
      rerankRuns: 1,
    });
    for (const presentationMode of ['model', 'fallback']) {
      const root = mkdtempSync(join(tmpdir(), `answer-fidelity-${presentationMode}-`));
      try {
        const config = offlineConfig(root);
        const store = new FileMemoryStore(join(root, 'sessions'));
        const model = fakeStageModel(totalCounts, presentationMode);
        const worker = fakeWorker();
        const runtime = new DiagnosticRuntime(config, store, worker, {
          model,
          mcp: {
            resolveSecret() {
              totalCounts.secretResolver += 1;
              throw new Error('poisoned secret resolver must not be read');
            },
          },
        });

        const response = await runtime.handleUserMessage({
          message: QUESTION,
          workspaceId: 'current',
          persona: 'developer',
        });

        assert.equal(response.decision, 'final');
        assert.match(response.assistantMessage, /如何开启 search\.provider，以及多久生效/);
        assert.match(response.assistantMessage, /search\.provider 应设置为 embedding/);
        assert.match(response.assistantMessage, /目标 workspace 的受控配置层/);
        assert.match(response.assistantMessage, /保存并重新加载配置后生效/);
        assert.match(response.assistantMessage, /先只读确认当前 search\.provider 配置值/);
        assert.match(response.assistantMessage, /待人工授权.*改为 embedding/);
        assert.doesNotMatch(response.assistantMessage, /poisoned-secret|raw-provider-payload|\/private\/|knowledge\/_sources/);
        assert.equal(JSON.stringify(response.caseSession).includes('poisoned-secret'), false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    assert.deepEqual(totalCounts, {
      preflight: 2,
      completeness: 2,
      coverage: 2,
      promptSafety: 0,
      presentation: 2,
      secretResolver: 0,
    });
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function offlineConfig(root) {
  const config = defaultConfig();
  config.storage.rootDir = join(root, 'storage');
  config.knowledge.rootDir = join(root, 'knowledge-data');
  config.workspaces[0].rootPath = root;
  config.agent.useModelForPreflight = true;
  config.agent.modelProvider = 'offline-poison';
  config.models.providers['offline-poison'] = {
    type: 'openai-compatible',
    baseUrl: 'https://network-must-not-run.invalid/v1',
    apiKey: 'poisoned-secret',
    model: 'offline-poison',
    temperature: 0,
  };
  config.embedding.enabled = false;
  config.rerank.enabled = false;
  return config;
}

async function exerciseOfflineRetrievalProviders() {
  const root = mkdtempSync(join(tmpdir(), 'answer-fidelity-provider-harness-'));
  try {
    initKnowledgeWorkspace({ workspaceRoot: root });
    const faqRoot = join(root, 'knowledge', 'faq');
    mkdirSync(faqRoot, { recursive: true });
    writeFileSync(join(faqRoot, 'provider.md'), `---
id: kb_provider_harness
title: Provider harness
type: faq
module: general
intent: how_to
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
  - provider harness
related_repos: []
last_verified_at: 2026-07-29
owner: test
source_document: knowledge/_sources/manual/provider.md
source_document_id: source_provider
source_block_ids:
  - block_provider
quality_status: ok
---

# Provider harness

Provider harness canonical answer ${'safe '.repeat(30)}.
`);
    const config = defaultConfig();
    config.embedding = {
      ...config.embedding,
      enabled: true,
      provider: 'fake',
      model: 'fake-embedding',
      dimensions: 8,
      distance: 'cosine',
    };
    config.rerank = {
      ...config.rerank,
      enabled: true,
      provider: 'fake',
      model: 'fake-rerank',
      topN: 8,
    };
    const delegate = createEmbeddingProvider(config.embedding);
    let embeddingBuildBatches = 0;
    await rebuildKnowledgeArtifacts({
      workspaceRoot: root,
      embedding: {
        enabled: true,
        config: config.embedding,
        provider: {
          id: delegate.id,
          model: delegate.model,
          dimensions: delegate.dimensions,
          distance: delegate.distance,
          async embedDocuments(items, options) {
            embeddingBuildBatches += 1;
            return delegate.embedDocuments(items, options);
          },
        },
      },
    });
    const retrieval = await retrieveKnowledgeWithConfiguredRetrieval({
      config,
      query: {
        workspaceRoot: root,
        query: 'provider harness canonical answer',
        limit: 3,
      },
    });
    return {
      embeddingBuildBatches,
      embeddingRecallStrategies: retrieval.trace.strategies
        .filter((item) => item.id === 'embedding' && item.status === 'ran').length,
      rerankRuns: retrieval.trace.rerank.status === 'ran' ? 1 : 0,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function fakeStageModel(counts, presentationMode) {
  return {
    async complete(messages) {
      const system = messages.find((message) => message.role === 'system')?.content ?? '';
      const user = messages.find((message) => message.role === 'user')?.content ?? '{}';
      if (system.includes('# Answer Goal Completeness Agent')) {
        counts.completeness += 1;
        return JSON.stringify({
          status: 'complete',
          missingElements: [],
          reason: 'all_obligations_represented',
        });
      }
      if (system.includes('# Evidence Coverage Agent')) {
        counts.coverage += 1;
        const input = JSON.parse(user);
        assert.equal(JSON.stringify(input).includes('raw-provider-payload'), false);
        assert.equal(JSON.stringify(input).includes('poisoned-secret'), false);
        assert.deepEqual(input.mustAnswerItems, [HOW, WHEN]);
        return JSON.stringify({
          status: 'accepted',
          bindings: [
            { claimId: 'primary_config', answerItemIds: [HOW], evidenceIds: ['ev_config'] },
            { claimId: 'primary_scope', answerItemIds: [HOW], evidenceIds: ['ev_scope'] },
            { claimId: 'primary_effect', answerItemIds: [WHEN], evidenceIds: ['ev_effect'] },
          ],
          fullQuestion: 'full',
          fullQuestionClaimIds: ['primary_config', 'primary_scope', 'primary_effect'],
          missingElements: [],
          reason: 'all_reviewed_claims_required',
        });
      }
      if (system.includes('# Visible Prompt Safety Agent')) {
        counts.promptSafety += 1;
        return JSON.stringify({ status: 'accepted', acceptedIds: [] });
      }
      if (system.includes('你只负责选择已通过确定性审核的 claim/evidence ID')) {
        counts.presentation += 1;
        if (presentationMode === 'fallback') return '{"claimIds":[]}';
        const { projection } = JSON.parse(user);
        return JSON.stringify({
          claimIds: [
            ...projection.primary.map((item) => item.id),
            ...projection.supporting.map((item) => item.id),
            ...projection.actions.map((item) => item.id),
          ],
          directAnswerClaimIds: projection.primary.map((item) => item.id),
          actionClaimIds: projection.actions.map((item) => item.id),
          evidenceIds: projection.evidence.map((item) => item.id),
        });
      }
      if (system.includes('Workspace-aware Preflight Rules')) {
        counts.preflight += 1;
        return JSON.stringify({
          action: 'dispatch',
          reason: 'bounded_read_only_diagnosis',
          missingInfo: [],
          mustAnswerItems: [HOW, WHEN],
          resolvedTurn: {
            confirmedFacts: [],
            userClaims: [],
            hypotheses: [],
            unknowns: [],
          },
        });
      }
      throw new Error(`unexpected model stage: ${system.slice(0, 120)}`);
    },
  };
}

function fakeWorker() {
  return {
    async diagnose(request) {
      assert.deepEqual(request.answerGoal.mustAnswerItems, [HOW, WHEN]);
      const evidence = [
        currentEvidence('ev_config', '当前配置合同允许 search.provider 使用 embedding。'),
        currentEvidence('ev_scope', '该设置属于目标 workspace 的受控配置层。'),
        currentEvidence('ev_effect', '配置保存并重新加载后生效。'),
      ];
      return {
        result: {
          status: 'concluded',
          summary: 'raw-provider-payload must never become visible',
          missingInfo: [],
          evidence,
          claims: [
            claim('primary_config', 'primary_answer', 'search.provider 应设置为 embedding。', [HOW], ['ev_config']),
            claim('primary_scope', 'primary_answer', '该配置必须在目标 workspace 的受控配置层生效。', [HOW], ['ev_scope']),
            claim('primary_effect', 'primary_answer', '保存并重新加载配置后生效。', [WHEN], ['ev_effect']),
            claim('action_inspect', 'next_action', '先只读确认当前 search.provider 配置值。', [HOW], ['ev_config']),
            {
              ...claim('action_change', 'next_action', '待人工授权：由有权限的人将其改为 embedding，并重新加载配置。', [HOW, WHEN], ['ev_config', 'ev_effect']),
              actionSafety: 'requires_authorization',
              executionStatus: 'proposed',
            },
          ],
          recommendedNextAction: 'final_answer',
        },
        trace: {
          command: 'readonly-worker',
          cwd: '/private/internal-path-must-not-leak',
          stdout: 'raw-provider-payload',
          stderr: '',
          exitCode: 0,
          startedAt: '2026-07-29T00:00:00.000Z',
          finishedAt: '2026-07-29T00:00:01.000Z',
        },
        coverageEvidence: evidence.map((item) => ({
          evidenceId: item.id,
          kind: 'workspace',
          safeText: item.summary,
          runId: request.runId,
          validated: true,
        })),
      };
    },
  };
}

function currentEvidence(id, summary) {
  return {
    id,
    kind: 'workspace',
    source: 'safe-config-contract',
    summary,
    confidence: 'high',
    validation: {
      status: 'active',
      visibility: 'internal',
      lastVerifiedAt: '2026-07-29T00:00:00.000Z',
      quality: 'ok',
    },
  };
}

function claim(id, role, text, answers, evidenceIds) {
  return { id, type: 'fact', role, text, answers, evidenceIds };
}
