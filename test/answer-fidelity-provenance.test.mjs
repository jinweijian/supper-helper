import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

async function api() {
  return import('../dist/runtime/coverage-evidence-provenance.js');
}

function evidence(id, kind = 'workspace') {
  return {
    id,
    kind,
    source: `RAW_SOURCE_${id}`,
    summary: `RAW_SUMMARY_${id}`,
    confidence: 'high',
  };
}

test('coverage provenance: evidence kind cannot self-certify current-run freshness', async () => {
  const { resolveCoverageEvidenceProvenance } = await api();
  const provenance = resolveCoverageEvidenceProvenance({
    evidence: [evidence('ev_workspace')],
    envelopes: [],
    currentRunId: 'run_current',
    currentSourceMessageIds: [],
  });

  assert.equal(provenance.ev_workspace, undefined);
});

test('coverage provenance: stale or mismatched worker envelopes are rejected', async () => {
  const { resolveCoverageEvidenceProvenance } = await api();
  const provenance = resolveCoverageEvidenceProvenance({
    evidence: [evidence('ev_workspace')],
    envelopes: [{
      evidenceId: 'ev_workspace',
      kind: 'workspace',
      safeText: '经适配器校验的安全片段',
      freshness: 'current_worker_run',
      runId: 'run_old',
      validated: true,
    }],
    currentRunId: 'run_current',
    currentSourceMessageIds: [],
  });

  assert.equal(provenance.ev_workspace, undefined);
});

test('coverage provenance: current validated worker envelope supplies adapter text, not claim or raw evidence text', async () => {
  const { resolveCoverageEvidenceProvenance } = await api();
  const provenance = resolveCoverageEvidenceProvenance({
    evidence: [evidence('ev_workspace')],
    envelopes: [{
      evidenceId: 'ev_workspace',
      kind: 'workspace',
      safeText: '经适配器校验的安全片段',
      freshness: 'current_worker_run',
      runId: 'run_current',
      validated: true,
    }],
    currentRunId: 'run_current',
    currentSourceMessageIds: [],
  });

  assert.deepEqual(provenance.ev_workspace, {
    freshness: 'current_worker_run',
    safeText: '经适配器校验的安全片段',
  });
  assert.doesNotMatch(JSON.stringify(provenance), /RAW_SOURCE|RAW_SUMMARY|claim/i);
});

test('coverage provenance: MCP requires a completed allowlisted read-only current call', async () => {
  const { resolveCoverageEvidenceProvenance } = await api();
  const base = {
    evidenceId: 'ev_mcp',
    kind: 'mcp',
    safeText: '规范化后的 MCP 安全片段',
    freshness: 'current_mcp_call',
    runId: 'run_current',
    validated: true,
  };
  for (const envelope of [
    { ...base, readOnly: false, allowlisted: true },
    { ...base, readOnly: true, allowlisted: false },
    { ...base, readOnly: true, allowlisted: true, completed: false },
  ]) {
    const rejected = resolveCoverageEvidenceProvenance({
      evidence: [evidence('ev_mcp', 'mcp')],
      envelopes: [envelope],
      currentRunId: 'run_current',
      currentSourceMessageIds: [],
    });
    assert.equal(rejected.ev_mcp, undefined);
  }

  const accepted = resolveCoverageEvidenceProvenance({
    evidence: [evidence('ev_mcp', 'mcp')],
    envelopes: [{ ...base, readOnly: true, allowlisted: true, completed: true }],
    currentRunId: 'run_current',
    currentSourceMessageIds: [],
  });
  assert.equal(accepted.ev_mcp?.freshness, 'current_mcp_call');
});

test('coverage provenance: manual evidence must bind to a current source message; history and unknown never qualify', async () => {
  const { resolveCoverageEvidenceProvenance } = await api();
  const items = [
    evidence('ev_manual', 'manual'),
    evidence('ev_history', 'history'),
    evidence('ev_unknown', 'unknown'),
  ];
  const provenance = resolveCoverageEvidenceProvenance({
    evidence: items,
    envelopes: [
      {
        evidenceId: 'ev_manual',
        kind: 'manual',
        safeText: '当前用户原文安全片段',
        freshness: 'current_user_message',
        sourceMessageId: 'msg_old',
        validated: true,
      },
      {
        evidenceId: 'ev_history',
        kind: 'history',
        safeText: '历史内容',
        freshness: 'revalidated_current_source',
        validated: true,
      },
      {
        evidenceId: 'ev_unknown',
        kind: 'unknown',
        safeText: '未知内容',
        freshness: 'revalidated_current_source',
        validated: true,
      },
    ],
    currentRunId: 'run_current',
    currentSourceMessageIds: ['msg_current'],
  });

  assert.equal(provenance.ev_manual, undefined);
  assert.equal(provenance.ev_history, undefined);
  assert.equal(provenance.ev_unknown, undefined);
});

test('coverage materializer: production entry resolves every source envelope before building source-neutral review input', async () => {
  const { materializeCurrentCoverageReviewInput } = await import(
    '../dist/runtime/answer-coverage.js'
  );
  const answerGoal = {
    rawUserQuestion: '如何开启 X，多久生效？',
    resolvedQuestion: '如何开启 X，多久生效？',
    answerObject: 'X',
    mustAnswerItems: ['如何开启 X', '多久生效'],
    diagnosticObjective: '确认配置方式和生效条件',
    sourceMessageIds: ['msg_current'],
  };
  const items = [
    evidence('ev_workspace', 'workspace'),
    evidence('ev_mcp', 'mcp'),
    evidence('ev_manual', 'manual'),
    evidence('ev_log', 'log'),
    evidence('ev_history', 'history'),
  ];
  const claims = items.map((item, index) => ({
    id: `claim_${index}`,
    type: 'fact',
    role: 'primary_answer',
    text: `安全回答 ${index}`,
    evidenceIds: [item.id],
    answers: [index === 0 ? '如何开启 X' : '多久生效'],
  }));
  const reviewInput = materializeCurrentCoverageReviewInput({
    answerGoal,
    claims: claims.slice(0, 4),
    evidence: items,
    envelopes: [
      {
        evidenceId: 'ev_workspace',
        kind: 'workspace',
        safeText: '当前 worker 读取到的配置',
        freshness: 'current_worker_run',
        runId: 'run_current',
        validated: true,
      },
      {
        evidenceId: 'ev_mcp',
        kind: 'mcp',
        safeText: '当前 MCP 调用返回五分钟生效',
        freshness: 'current_mcp_call',
        runId: 'run_current',
        validated: true,
        readOnly: true,
        allowlisted: true,
        completed: true,
      },
      {
        evidenceId: 'ev_manual',
        kind: 'manual',
        safeText: '当前用户消息中的配置对象',
        freshness: 'current_user_message',
        sourceMessageId: 'msg_current',
        validated: true,
      },
      {
        evidenceId: 'ev_log',
        kind: 'log',
        safeText: '当前 run 的安全日志摘录',
        freshness: 'current_log_excerpt',
        runId: 'run_current',
        validated: true,
      },
      {
        evidenceId: 'ev_history',
        kind: 'history',
        safeText: '历史回复不得进入 coverage',
        freshness: 'revalidated_current_source',
        validated: true,
      },
    ],
    currentRunId: 'run_current',
  });

  assert.deepEqual(
    reviewInput.evidenceSegments.map((item) => [item.id, item.freshness]),
    [
      ['ev_workspace', 'current_worker_run'],
      ['ev_mcp', 'current_mcp_call'],
      ['ev_manual', 'current_user_message'],
      ['ev_log', 'current_log_excerpt'],
    ],
  );
  assert.doesNotMatch(JSON.stringify(reviewInput), /RAW_SOURCE|RAW_SUMMARY|历史回复不得进入/);
});

test('worker adapter emits only bounded redacted excerpts tied to the current run', async () => {
  const { currentWorkerCoverageEvidence } = await import(
    '../dist/workers/claude/coverage-evidence.js'
  );
  const excerpts = currentWorkerCoverageEvidence(
    { runId: 'run_current' },
    {
      evidence: [
        evidence('ev_safe', 'workspace'),
        evidence('ev_low', 'workspace'),
        evidence('ev_history', 'history'),
      ].map((item) => (
        item.id === 'ev_safe'
          ? { ...item, summary: '配置位于 /Users/alice/private.ts，token=sk-secret-value' }
          : item.id === 'ev_low'
            ? { ...item, confidence: 'low' }
            : item
      )),
    },
  );

  assert.deepEqual(excerpts.map((item) => item.evidenceId), ['ev_safe']);
  assert.equal(excerpts[0].runId, 'run_current');
  assert.doesNotMatch(excerpts[0].safeText, /Users\/alice|sk-secret-value/);
});

test('presenter boundary: public presenter cannot accept raw result or keep business-keyword reply classification', () => {
  const source = readFileSync(
    new URL('../src/runtime/presenter.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\bDiagnosticResult\b|\bWorkerTrace\b|result\.summary|result\.evidence/);
  assert.doesNotMatch(source, /系统 bug|设计使然|配置或使用问题|bug\|缺陷\|异常/);
  assert.match(source, /renderSafeFrozenAnswer/);
});
