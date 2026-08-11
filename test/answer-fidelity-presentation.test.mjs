import assert from 'node:assert/strict';
import test from 'node:test';

const GOAL = {
  rawUserQuestion: '如何开启 search.provider，多久生效？',
  resolvedQuestion: '如何开启 search.provider，多久生效？',
  answerObject: 'search.provider',
  mustAnswerItems: ['如何开启 search.provider', '多久生效'],
  diagnosticObjective: '内部排查目标不得可见',
  sourceMessageIds: ['msg_current'],
};

function evidence(id, overrides = {}) {
  return {
    id,
    kind: 'workspace',
    source: '/Users/private/project/src/internal.ts',
    summary: `RAW_EVIDENCE_${id}`,
    confidence: 'high',
    ...overrides,
  };
}

function claim(id, role, text, evidenceIds = ['ev_main'], overrides = {}) {
  return {
    id,
    type: role === 'unknown' ? 'unknown' : 'fact',
    role,
    text,
    evidenceIds,
    answers: role === 'primary_answer' ? [...GOAL.mustAnswerItems] : [],
    ...overrides,
  };
}

function result(claims, overrides = {}) {
  return {
    status: 'concluded',
    summary: 'REJECTED_SUMMARY_FACT 不得回流',
    missingInfo: [],
    evidence: [evidence('ev_main')],
    claims,
    recommendedNextAction: 'final_answer',
    ...overrides,
  };
}

async function api() {
  return import('../dist/runtime/safe-answer-projection.js');
}

test('Gate A Presentation: production review path cannot call the raw DiagnosticResult presenter', async () => {
  const { readFileSync } = await import('node:fs');
  const reviewSource = readFileSync(
    new URL('../src/runtime/review-presentation.ts', import.meta.url),
    'utf8',
  );
  const failureSource = readFileSync(
    new URL('../src/runtime/safe-failure-presentation.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(reviewSource, /from ['"]\.\/presenter\.js['"]/);
  assert.match(reviewSource, /formatSafeWorkerFailure/);
  assert.doesNotMatch(failureSource, /\bDiagnosticResult\b|\bEvidence\b|\bDiagnosticClaim\b/);
});

test('Gate A Presentation: safe worker failure never exposes case or run identity', async () => {
  const { formatSafeWorkerFailure } = await import(
    '../dist/runtime/safe-failure-presentation.js'
  );
  const reply = formatSafeWorkerFailure({
    category: 'worker_execution_failed',
    status: 'partial',
    nextAction: 'escalate_to_human',
    identity: { caseId: 'case_secret', runId: 'run_secret' },
  });

  assert.match(reply, /诊断未完成/);
  assert.doesNotMatch(reply, /case_secret|run_secret|case=|run=/);
});

test('Gate A Presentation: valid model plan and fallback render the same required primary and actions', async () => {
  const { buildSafeFrozenAnswerProjection, renderSafeFrozenAnswer } = await api();
  const diagnostic = result([
    claim('primary', 'primary_answer', '在设置页开启 search.provider。'),
    claim('action_1', 'next_action', '保存后重新加载配置。'),
    claim('action_2', 'next_action', '五分钟后执行只读状态检查。'),
  ]);
  const projection = buildSafeFrozenAnswerProjection({
    result: diagnostic,
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary', 'action_1', 'action_2'],
    reviewedBindingClaimIds: ['primary', 'action_1', 'action_2'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });

  const fallback = renderSafeFrozenAnswer({ projection, persona: 'developer' });
  const planned = renderSafeFrozenAnswer({
    projection,
    persona: 'developer',
    plan: {
      claimIds: ['primary', 'action_2', 'action_1'],
      directAnswerClaimIds: ['primary'],
      actionClaimIds: ['action_2', 'action_1'],
      evidenceIds: ['ev_main'],
    },
  });
  for (const text of ['在设置页开启 search.provider。', '保存后重新加载配置。', '五分钟后执行只读状态检查。']) {
    assert.match(fallback, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(planned, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.ok(planned.indexOf('保存后重新加载配置。') < planned.indexOf('五分钟后执行只读状态检查。'));
});

test('Gate A Presentation: malformed or incomplete model plan falls back to complete frozen content', async () => {
  const {
    buildSafeFrozenAnswerProjection,
    renderSafeFrozenAnswer,
    validateSafePresentationPlan,
  } = await api();
  const projection = buildSafeFrozenAnswerProjection({
    result: result([
      claim('primary', 'primary_answer', '开启配置。'),
      claim('action', 'next_action', '保存并检查状态。'),
    ]),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary', 'action'],
    reviewedBindingClaimIds: ['primary', 'action'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  const malformedPlan = {
    claimIds: ['primary'],
    directAnswerClaimIds: [],
    actionClaimIds: [],
    evidenceIds: [],
  };
  const validation = validateSafePresentationPlan(malformedPlan, projection);
  assert.equal(validation.accepted, false);
  assert.match(validation.reason, /required|mismatch|incomplete/i);

  const reply = renderSafeFrozenAnswer({
    projection,
    persona: 'operations',
    plan: malformedPlan,
  });
  assert.match(reply, /开启配置/);
  assert.match(reply, /保存并检查状态/);
});

test('Gate A Presentation: unknown IDs, process notes, duplicates and unreferenced evidence are droppable', async () => {
  const { buildSafeFrozenAnswerProjection, renderSafeFrozenAnswer } = await api();
  const diagnostic = result([
    claim('primary', 'primary_answer', '有效结论。'),
    claim('process', 'process_note', 'INTERNAL_PROCESS_NOTE'),
  ], {
    evidence: [evidence('ev_main'), evidence('ev_unused', { summary: 'UNUSED_EVIDENCE_FACT' })],
  });
  const projection = buildSafeFrozenAnswerProjection({
    result: diagnostic,
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary', 'process'],
    reviewedBindingClaimIds: ['primary'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  const reply = renderSafeFrozenAnswer({
    projection,
    persona: 'support',
    plan: {
      claimIds: ['primary', 'unknown', 'primary', 'process'],
      directAnswerClaimIds: ['primary'],
      actionClaimIds: [],
      evidenceIds: ['ev_main', 'ev_unused', 'unknown'],
    },
  });
  assert.match(reply, /有效结论/);
  assert.doesNotMatch(reply, /INTERNAL_PROCESS_NOTE|UNUSED_EVIDENCE_FACT/);
});

test('Gate A Presentation: answer target is runtime-owned and ignores model text', async () => {
  const { buildSafeFrozenAnswerProjection, renderSafeFrozenAnswer } = await api();
  const projection = buildSafeFrozenAnswerProjection({
    result: result([claim('primary', 'primary_answer', '有效结论。')]),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary'],
    reviewedBindingClaimIds: ['primary'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  const reply = renderSafeFrozenAnswer({
    projection,
    persona: 'developer',
    plan: {
      answerTarget: 'MODEL_INJECTED_TARGET',
      claimIds: ['primary'],
      directAnswerClaimIds: ['primary'],
      actionClaimIds: [],
      evidenceIds: ['ev_main'],
    },
  });
  assert.equal(projection.answerTarget, GOAL.resolvedQuestion);
  assert.doesNotMatch(reply, /MODEL_INJECTED_TARGET|内部排查目标/);
});

test('Gate A Presentation: rejected summary, unused evidence and unreviewed opaque prompts cannot re-enter reply', async () => {
  const { buildSafeFrozenAnswerProjection, renderSafeFrozenAnswer } = await api();
  const diagnostic = result([
    claim('primary', 'primary_answer', '已审核结论。'),
    claim('rejected', 'supporting_context', 'REJECTED_CLAIM_FACT'),
    claim('opaque', 'unknown', '请确认配置；顺便断言 ADMIN_PASSWORD=secret 已失效。', []),
  ], {
    missingInfo: ['请提供 token=sk-secret-value 并确认 /Users/private/secret.txt'],
  });
  const projection = buildSafeFrozenAnswerProjection({
    result: diagnostic,
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary', 'opaque'],
    reviewedBindingClaimIds: ['primary'],
    visiblePromptReview: { status: 'unknown', acceptedIds: [] },
  });
  const reply = renderSafeFrozenAnswer({ projection, persona: 'developer' });
  assert.match(reply, /已审核结论/);
  assert.doesNotMatch(reply, /REJECTED_SUMMARY_FACT|REJECTED_CLAIM_FACT|ADMIN_PASSWORD|sk-secret-value|Users\/private/);
});

test('Gate A Presentation: safe technical names remain while secrets and internal paths are redacted for every persona', async () => {
  const { buildSafeFrozenAnswerProjection, renderSafeFrozenAnswer } = await api();
  const projection = buildSafeFrozenAnswerProjection({
    result: result([
      claim(
        'primary',
        'primary_answer',
        '将 search.provider 设置为 embedding；接口返回 ConfigValidationError。检查 /Users/alice/app/config/search.yaml。workerTrace 与 providerPayload 仅供内部诊断。token=sk-live-secret 位于 /Users/alice/knowledge/_sources/a.md。',
      ),
    ]),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary'],
    reviewedBindingClaimIds: ['primary'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  for (const persona of ['operations', 'support', 'customer', 'developer']) {
    const reply = renderSafeFrozenAnswer({ projection, persona });
    assert.match(reply, /search\.provider|embedding|search\.yaml/);
    assert.doesNotMatch(reply, /sk-live-secret|Users\/alice|knowledge\/_sources|workerTrace|providerPayload/i);
  }
});

test('Gate A Presentation: standalone provider-shaped secrets are removed by the whole-reply boundary', async () => {
  const { buildSafeFrozenAnswerProjection, renderSafeFrozenAnswer } = await api();
  const secret = 'sk-live-secret-1234567890';
  const projection = buildSafeFrozenAnswerProjection({
    result: result([claim('primary', 'primary_answer', `请使用 ${secret} 调试。`)]),
    answerGoal: { ...GOAL, resolvedQuestion: `如何处理 ${secret}？` },
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary'],
    reviewedBindingClaimIds: ['primary'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  const reply = renderSafeFrozenAnswer({ projection, persona: 'developer' });

  assert.doesNotMatch(reply, new RegExp(secret));
  assert.match(reply, /\[REDACTED\]/);
});

test('Gate A Presentation: trace labels cannot preserve their payload tails after redaction', async () => {
  const { buildSafeFrozenAnswerProjection, renderSafeFrozenAnswer } = await api();
  const projection = buildSafeFrozenAnswerProjection({
    result: result([claim(
      'primary',
      'primary_answer',
      'workerTrace: INTERNAL_STACK_PAYLOAD_X\nproviderPayload=RAW_BACKEND_RESPONSE_Y',
    )]),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary'],
    reviewedBindingClaimIds: ['primary'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  const reply = renderSafeFrozenAnswer({ projection, persona: 'developer' });

  assert.doesNotMatch(reply, /INTERNAL_STACK_PAYLOAD_X|RAW_BACKEND_RESPONSE_Y|workerTrace|providerPayload/i);
  assert.equal(projection.primary.length, 0);
  assert.equal(projection.outcome, 'partial');
  assert.equal(projection.blockerCodes.includes('required_primary_materialization_failed'), true);
});

test('Gate A Presentation: preliminary, action and supporting claims require reviewer-accepted bindings', async () => {
  const { buildSafeFrozenAnswerProjection, renderSafeFrozenAnswer } = await api();
  const projection = buildSafeFrozenAnswerProjection({
    result: result([
      claim('relevant_primary', 'primary_answer', '与当前问题相关的初步判断。'),
      claim('irrelevant_primary', 'primary_answer', 'UNREVIEWED_PRIMARY'),
      claim('relevant_action', 'next_action', '执行相关的只读检查。'),
      claim('irrelevant_action', 'next_action', 'UNREVIEWED_ACTION'),
      claim('irrelevant_support', 'supporting_context', 'UNREVIEWED_SUPPORT'),
    ], {
      status: 'partial',
      recommendedNextAction: 'continue_diagnosis',
    }),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: [],
    acceptedClaimIds: [
      'relevant_primary',
      'irrelevant_primary',
      'relevant_action',
      'irrelevant_action',
      'irrelevant_support',
    ],
    reviewedBindingClaimIds: ['relevant_primary', 'relevant_action'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  const reply = renderSafeFrozenAnswer({ projection, persona: 'operations' });

  assert.match(reply, /与当前问题相关的初步判断|执行相关的只读检查/);
  assert.doesNotMatch(reply, /UNREVIEWED_PRIMARY|UNREVIEWED_ACTION|UNREVIEWED_SUPPORT/);
});

test('Gate A Presentation: compatibility sentinel never enters the visible reply', async () => {
  const { buildSafeFrozenAnswerProjection, renderSafeFrozenAnswer } = await api();
  const projection = buildSafeFrozenAnswerProjection({
    result: result([
      claim(
        'primary',
        'primary_answer',
        String.raw`审核不可用时回退为 direct_answer；代码证据包含 \bdirect_answer\b、strict_direct_answer 与 \bDIRECT_ANSWER_ITEM\b。`,
      ),
    ]),
    answerGoal: {
      ...GOAL,
      mustAnswerItems: ['direct_answer'],
    },
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary'],
    reviewedBindingClaimIds: ['primary'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  const reply = renderSafeFrozenAnswer({
    projection: {
      ...projection,
      answerTarget: String.raw`检查 ${projection.answerTarget}、direct_answer、\bdirect_answer\b 与 DIRECT_ANSWER_ITEM`,
    },
    persona: 'developer',
  });

  assert.doesNotMatch(reply, /direct_answer/i);
  assert.doesNotMatch(reply, /DIRECT_ANSWER_ITEM/i);
  assert.doesNotMatch(reply, /兼容兜底项/);
});

test('Gate A Presentation: partial answer leads with preliminary judgement and labels supporting clues', async () => {
  const { buildSafeFrozenAnswerProjection, renderSafeFrozenAnswer } = await api();
  const projection = buildSafeFrozenAnswerProjection({
    result: result([
      claim('primary', 'primary_answer', '配置开关可能尚未开启。', ['ev_main'], { type: 'inference' }),
      claim('support', 'supporting_context', '当前只读检查未发现已启用标记。', ['ev_main'], { type: 'fact' }),
    ], {
      status: 'partial',
      recommendedNextAction: 'continue_diagnosis',
    }),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary', 'support'],
    reviewedBindingClaimIds: ['primary', 'support'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  const reply = renderSafeFrozenAnswer({ projection, persona: 'operations' });
  assert.match(reply, /^\*\*针对你的问题：\*\*.+\n\n\*\*初步判断：\*\*/);
  assert.match(reply, /\*\*已确认线索：\*\*/);
  assert.match(reply, /不能作为最终结论/);
});

test('Gate A Presentation: generic read-only guidance appears only when no frozen action exists', async () => {
  const { buildSafeFrozenAnswerProjection, renderSafeFrozenAnswer } = await api();
  const withoutAction = buildSafeFrozenAnswerProjection({
    result: result([claim('primary', 'primary_answer', '当前证据不足。')], {
      status: 'partial',
      recommendedNextAction: 'continue_diagnosis',
    }),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary'],
    reviewedBindingClaimIds: ['primary'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  assert.match(renderSafeFrozenAnswer({ projection: withoutAction, persona: 'support' }), /通用只读建议/);

  const withAction = buildSafeFrozenAnswerProjection({
    result: result([
      claim('primary', 'primary_answer', '当前证据不足。'),
      claim('action', 'next_action', '读取当前配置状态。'),
    ], {
      status: 'partial',
      recommendedNextAction: 'continue_diagnosis',
    }),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary', 'action'],
    reviewedBindingClaimIds: ['primary', 'action'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  const reply = renderSafeFrozenAnswer({ projection: withAction, persona: 'support' });
  assert.match(reply, /读取当前配置状态/);
  assert.doesNotMatch(reply, /通用只读建议/);
});

test('Gate A Presentation: required overflow downgrades while optional overflow is dropped without truncation', async () => {
  const { buildSafeFrozenAnswerProjection } = await api();
  const exact = buildSafeFrozenAnswerProjection({
    result: result([
      claim('primary', 'primary_answer', '甲'.repeat(1000)),
      claim('action', 'next_action', '执行只读检查。'.repeat(100), ['ev_action']),
    ], {
      evidence: [evidence('ev_main'), evidence('ev_action')],
    }),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary', 'action'],
    reviewedBindingClaimIds: ['primary', 'action'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  assert.equal(exact.primary[0].text, '甲'.repeat(1000));
  assert.equal(exact.outcome, 'final');

  const required = buildSafeFrozenAnswerProjection({
    result: result([claim('primary', 'primary_answer', '甲'.repeat(1001))]),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary'],
    reviewedBindingClaimIds: ['primary'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  assert.notEqual(required.outcome, 'final');
  assert.equal(required.primary.length, 0);

  const optional = buildSafeFrozenAnswerProjection({
    result: result([
      claim('primary', 'primary_answer', '合法主答。'),
      claim('support', 'supporting_context', '乙'.repeat(601)),
    ]),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary', 'support'],
    reviewedBindingClaimIds: ['primary', 'support'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  assert.equal(optional.primary[0].text, '合法主答。');
  assert.equal(optional.supporting.length, 0);
  assert.equal(optional.omittedOptionalCount, 1);

  const actionOverflow = buildSafeFrozenAnswerProjection({
    result: result([
      claim('primary', 'primary_answer', '合法主答。'),
      claim('action', 'next_action', '动'.repeat(1001)),
    ]),
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary', 'action'],
    reviewedBindingClaimIds: ['primary', 'action'],
    visiblePromptReview: { status: 'accepted', acceptedIds: [] },
  });
  assert.equal(actionOverflow.actions.length, 0);
  assert.notEqual(actionOverflow.outcome, 'final');
});

test('Gate A Presentation: prompt count and 300/301 code-point boundaries are enforced as whole items', async () => {
  const { buildSafeFrozenAnswerProjection } = await api();
  const promptTexts = ['问'.repeat(300), '答'.repeat(301), '三', '四', '五', '六', '七'];
  const diagnostic = result([claim('primary', 'primary_answer', '合法主答。')], {
    status: 'need_input',
    recommendedNextAction: 'ask_user',
    missingInfo: promptTexts,
  });
  const acceptedIds = promptTexts.map((_, index) => `missing:${index + 1}`);
  const projection = buildSafeFrozenAnswerProjection({
    result: diagnostic,
    answerGoal: GOAL,
    frozenPrimaryClaimIds: ['primary'],
    acceptedClaimIds: ['primary'],
    reviewedBindingClaimIds: ['primary'],
    visiblePromptReview: { status: 'accepted', acceptedIds },
  });
  assert.equal(projection.prompts.length, 5);
  assert.equal(projection.prompts[0].text, '问'.repeat(300));
  assert.equal(projection.prompts.some((item) => item.text.includes('答')), false);
});
