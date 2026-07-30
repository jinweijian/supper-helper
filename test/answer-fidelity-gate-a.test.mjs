import assert from 'node:assert/strict';
import test from 'node:test';
import {
  freezeReviewedDiagnosticResult,
  validateDiagnosticResult,
  validateDiagnosticStructure,
} from '../dist/runtime/result-validator.js';

const GOAL = {
  rawUserQuestion: '如何开启 X，多久生效？',
  resolvedQuestion: '如何开启 X，多久生效？',
  answerObject: 'X',
  mustAnswerItems: ['如何开启 X', '多久生效'],
  diagnosticObjective: '检查配置与生效时机',
  sourceMessageIds: ['msg_current'],
};

function evidence(id, kind = 'workspace', overrides = {}) {
  return {
    id,
    kind,
    source: `${kind}:${id}:RAW_SOURCE_MUST_NOT_LEAK`,
    summary: `RAW_SUMMARY_MUST_NOT_LEAK_${id}`,
    confidence: 'high',
    ...overrides,
  };
}

function claim(id, answers, evidenceIds, overrides = {}) {
  return {
    id,
    type: 'fact',
    role: 'primary_answer',
    text: `${id} 的安全结论`,
    evidenceIds,
    answers,
    ...overrides,
  };
}

function concluded(claims, evidenceItems, overrides = {}) {
  return {
    status: 'concluded',
    summary: 'RAW_RESULT_SUMMARY_MUST_NOT_LEAK',
    missingInfo: [],
    evidence: evidenceItems,
    claims,
    recommendedNextAction: 'final_answer',
    ...overrides,
  };
}

function acceptedCoverage(bindings, fullQuestionClaimIds, overrides = {}) {
  return {
    status: 'accepted',
    bindings,
    fullQuestion: 'full',
    fullQuestionClaimIds,
    missingElements: [],
    ...overrides,
  };
}

test('Gate A API: structural validation and reviewed freeze are explicit, and missing review cannot final', () => {
  const primary = claim('primary_full', GOAL.mustAnswerItems, ['ev_primary']);
  const structural = validateDiagnosticStructure(
    concluded([primary], [evidence('ev_primary')]),
    GOAL,
  );
  const frozen = freezeReviewedDiagnosticResult({
    structural,
    answerGoal: GOAL,
    coverageReview: undefined,
    upstreamBlockers: [],
  });

  assert.equal(frozen.result.status, 'partial');
  assert.notEqual(frozen.result.recommendedNextAction, 'final_answer');
  assert.deepEqual(frozen.acceptedPrimaryAnswerClaimIds, []);
});

test('Gate A API: validator implementation does not infer security semantics from arguments.length', async () => {
  const source = await import('node:fs').then(({ readFileSync }) => (
    readFileSync(new URL('../src/runtime/result-validator.ts', import.meta.url), 'utf8')
  ));
  assert.doesNotMatch(source, /arguments\.length/);
});

test('Gate A: invalid supporting claim is local rejection when reviewed primary coverage remains complete', () => {
  const primary = claim('primary_full', GOAL.mustAnswerItems, ['ev_primary']);
  const invalidSupporting = claim('supporting_invalid', [], ['ev_missing'], {
    role: 'supporting_context',
  });
  const validation = validateDiagnosticResult(
    concluded([primary, invalidSupporting], [evidence('ev_primary')]),
    GOAL,
    acceptedCoverage(
      [{ claimId: 'primary_full', answerItemIds: GOAL.mustAnswerItems, evidenceIds: ['ev_primary'] }],
      ['primary_full'],
    ),
  );

  assert.equal(validation.result.status, 'concluded');
  assert.equal(validation.result.recommendedNextAction, 'final_answer');
  assert.deepEqual(validation.rejectedClaimIds, ['supporting_invalid']);
  assert.deepEqual(validation.acceptedPrimaryAnswerClaimIds, ['primary_full']);
});

test('Gate A: rejected primary remains a global coverage blocker', () => {
  const invalidPrimary = claim('primary_invalid', GOAL.mustAnswerItems, ['ev_missing']);
  const validation = validateDiagnosticResult(
    concluded([invalidPrimary], []),
    GOAL,
    acceptedCoverage([], []),
  );

  assert.equal(validation.result.status, 'partial');
  assert.notEqual(validation.result.recommendedNextAction, 'final_answer');
  assert.deepEqual(validation.acceptedPrimaryAnswerClaimIds, []);
  assert.equal(
    validation.globalBlockers.some((blocker) => blocker.code === 'primary_coverage_incomplete'),
    true,
  );
});

test('Gate A: reviewed union of two primary claims can cover the complete answer', () => {
  const how = claim('primary_how', ['如何开启 X'], ['ev_how']);
  const when = claim('primary_when', ['多久生效'], ['ev_when']);
  const validation = validateDiagnosticResult(
    concluded([how, when], [evidence('ev_how'), evidence('ev_when')]),
    GOAL,
    acceptedCoverage(
      [
        { claimId: 'primary_how', answerItemIds: ['如何开启 X'], evidenceIds: ['ev_how'] },
        { claimId: 'primary_when', answerItemIds: ['多久生效'], evidenceIds: ['ev_when'] },
      ],
      ['primary_how', 'primary_when'],
    ),
  );

  assert.equal(validation.result.status, 'concluded');
  assert.equal(validation.result.recommendedNextAction, 'final_answer');
  assert.deepEqual(validation.acceptedPrimaryAnswerClaimIds, ['primary_how', 'primary_when']);
});

test('Gate A: frozen primary order is greedy cover plus required full-question ids', () => {
  const how = claim('primary_how', ['如何开启 X'], ['ev_how']);
  const condition = claim('primary_condition', ['如何开启 X'], ['ev_condition']);
  const when = claim('primary_when', ['多久生效'], ['ev_when']);
  const redundant = claim('primary_redundant', ['如何开启 X'], ['ev_redundant']);
  const validation = validateDiagnosticResult(
    concluded(
      [how, condition, when, redundant],
      [evidence('ev_how'), evidence('ev_condition'), evidence('ev_when'), evidence('ev_redundant')],
    ),
    GOAL,
    acceptedCoverage(
      [
        { claimId: 'primary_how', answerItemIds: ['如何开启 X'], evidenceIds: ['ev_how'] },
        { claimId: 'primary_condition', answerItemIds: ['如何开启 X'], evidenceIds: ['ev_condition'] },
        { claimId: 'primary_when', answerItemIds: ['多久生效'], evidenceIds: ['ev_when'] },
        { claimId: 'primary_redundant', answerItemIds: ['如何开启 X'], evidenceIds: ['ev_redundant'] },
      ],
      ['primary_condition', 'primary_when'],
    ),
  );

  assert.deepEqual(
    validation.acceptedPrimaryAnswerClaimIds,
    ['primary_how', 'primary_when', 'primary_condition'],
  );
});

test('Gate A: producer over-label cannot override independent reviewed bindings', () => {
  const overLabelled = claim('primary_overlabelled', GOAL.mustAnswerItems, ['ev_how']);
  const validation = validateDiagnosticResult(
    concluded([overLabelled], [evidence('ev_how')]),
    GOAL,
    acceptedCoverage(
      [{ claimId: 'primary_overlabelled', answerItemIds: ['如何开启 X'], evidenceIds: ['ev_how'] }],
      ['primary_overlabelled'],
      { fullQuestion: 'partial', missingElements: ['多久生效'] },
    ),
  );

  assert.equal(validation.result.status, 'partial');
  assert.notEqual(validation.result.recommendedNextAction, 'final_answer');
  assert.deepEqual(validation.acceptedPrimaryAnswerClaimIds, []);
});

test('Gate A: unavailable or malformed coverage review conservatively blocks final', () => {
  const primary = claim('primary_full', GOAL.mustAnswerItems, ['ev_primary']);
  for (const review of [
    undefined,
    { status: 'unknown', bindings: [], fullQuestion: 'unknown', fullQuestionClaimIds: [], missingElements: [] },
    { status: 'accepted', bindings: 'malformed', fullQuestion: 'full', fullQuestionClaimIds: ['primary_full'], missingElements: [] },
  ]) {
    const validation = validateDiagnosticResult(
      concluded([primary], [evidence('ev_primary')]),
      GOAL,
      review,
    );
    assert.equal(validation.result.status, 'partial');
    assert.notEqual(validation.result.recommendedNextAction, 'final_answer');
  }
});

test('Gate A: contradictory or unbounded coverage review output is rejected and redacted', async () => {
  const { validateAnswerCoverageReview, unknownCoverageReview } = await import(
    '../dist/runtime/answer-coverage.js'
  );
  const input = {
    resolvedQuestion: GOAL.resolvedQuestion,
    mustAnswerItems: GOAL.mustAnswerItems,
    claimSegments: [{
      id: 'primary_full',
      text: '安全结论',
      type: 'fact',
      role: 'primary_answer',
      candidateAnswerItemIds: GOAL.mustAnswerItems,
      evidenceIds: ['ev_primary'],
    }],
    evidenceSegments: [{
      id: 'ev_primary',
      text: '安全证据',
      kind: 'workspace',
      freshness: 'current_worker_run',
    }],
  };
  const contradictory = validateAnswerCoverageReview({
    status: 'accepted',
    bindings: [{
      claimId: 'primary_full',
      answerItemIds: GOAL.mustAnswerItems,
      evidenceIds: ['ev_primary'],
    }],
    fullQuestion: 'full',
    fullQuestionClaimIds: ['primary_full'],
    missingElements: ['仍有缺项'],
  }, input);
  assert.equal(contradictory.status, 'unknown');

  const secret = unknownCoverageReview(`token=sk-${'a'.repeat(40)} ${'长'.repeat(300)}`);
  assert.doesNotMatch(secret.reason, /sk-|a{20}/);
  assert.ok(Array.from(secret.reason).length <= 160);
});

test('Gate A: sentinel still requires independent coverage of the complete resolved question', () => {
  const sentinelGoal = { ...GOAL, mustAnswerItems: ['direct_answer'] };
  const sentinelClaim = claim('sentinel_primary', ['direct_answer'], ['ev_how']);
  const validation = validateDiagnosticResult(
    concluded([sentinelClaim], [evidence('ev_how')]),
    sentinelGoal,
    acceptedCoverage(
      [{ claimId: 'sentinel_primary', answerItemIds: ['direct_answer'], evidenceIds: ['ev_how'] }],
      ['sentinel_primary'],
      { fullQuestion: 'partial', missingElements: ['多久生效'] },
    ),
  );
  assert.equal(validation.result.status, 'partial');
  assert.notEqual(validation.result.recommendedNextAction, 'final_answer');
});

test('Gate A: source-neutral materializer accepts current workspace and MCP evidence without raw fields', async () => {
  const { materializeCoverageReviewInput } = await import('../dist/runtime/answer-coverage.js');
  const claims = [
    claim('workspace_claim', ['如何开启 X'], ['ev_workspace']),
    claim('mcp_claim', ['多久生效'], ['ev_mcp']),
  ];
  const input = materializeCoverageReviewInput({
    answerGoal: GOAL,
    claims,
    evidence: [evidence('ev_workspace'), evidence('ev_mcp', 'mcp')],
    provenance: {
      ev_workspace: { freshness: 'same_run', safeText: '配置项 X 可在控制台开启。' },
      ev_mcp: { freshness: 'same_run', safeText: '配置将在五分钟内生效。' },
    },
  });

  assert.deepEqual(input.evidenceSegments.map((item) => item.kind), ['workspace', 'mcp']);
  const serialized = JSON.stringify(input);
  assert.doesNotMatch(serialized, /RAW_SUMMARY_MUST_NOT_LEAK|RAW_SOURCE_MUST_NOT_LEAK/);
});

test('Gate A: coverage materializer enforces whole-item and batch bounds without truncation', async () => {
  const { materializeCoverageReviewInput } = await import('../dist/runtime/answer-coverage.js');
  const within = '甲'.repeat(1000);
  const overflow = '乙'.repeat(1001);
  assert.doesNotThrow(() => materializeCoverageReviewInput({
    answerGoal: GOAL,
    claims: [claim('within', GOAL.mustAnswerItems, ['ev_within'], { text: within })],
    evidence: [evidence('ev_within')],
    provenance: { ev_within: { freshness: 'same_run', safeText: within } },
  }));
  assert.throws(() => materializeCoverageReviewInput({
    answerGoal: GOAL,
    claims: [claim('overflow', GOAL.mustAnswerItems, ['ev_overflow'], { text: overflow })],
    evidence: [evidence('ev_overflow')],
    provenance: { ev_overflow: { freshness: 'same_run', safeText: within } },
  }), /coverage_.*limit/);

  const tooManyClaims = Array.from({ length: 21 }, (_, index) => (
    claim(`claim_${index}`, GOAL.mustAnswerItems, [`ev_${index}`])
  ));
  assert.throws(() => materializeCoverageReviewInput({
    answerGoal: GOAL,
    claims: tooManyClaims,
    evidence: tooManyClaims.map((_, index) => evidence(`ev_${index}`)),
    provenance: Object.fromEntries(tooManyClaims.map((_, index) => [
      `ev_${index}`,
      { freshness: 'same_run', safeText: '安全证据' },
    ])),
  }), /coverage_.*limit/);

  const fortyEvidence = Array.from({ length: 40 }, (_, index) => evidence(`ev_bound_${index}`));
  const fortyProvenance = Object.fromEntries(fortyEvidence.map((item) => [
    item.id,
    { freshness: 'same_run', safeText: '安全证据' },
  ]));
  assert.doesNotThrow(() => materializeCoverageReviewInput({
    answerGoal: GOAL,
    claims: [claim('forty', GOAL.mustAnswerItems, fortyEvidence.map((item) => item.id))],
    evidence: fortyEvidence,
    provenance: fortyProvenance,
  }));
  const fortyOneEvidence = [...fortyEvidence, evidence('ev_bound_40')];
  assert.throws(() => materializeCoverageReviewInput({
    answerGoal: GOAL,
    claims: [claim('forty_one', GOAL.mustAnswerItems, fortyOneEvidence.map((item) => item.id))],
    evidence: fortyOneEvidence,
    provenance: {
      ...fortyProvenance,
      ev_bound_40: { freshness: 'same_run', safeText: '安全证据' },
    },
  }), /coverage_.*limit/);

  const totalEvidence = Array.from({ length: 25 }, (_, index) => evidence(`ev_total_${index}`));
  const exactTotalProvenance = Object.fromEntries(totalEvidence.map((item) => [
    item.id,
    { freshness: 'same_run', safeText: '丙'.repeat(960) },
  ]));
  exactTotalProvenance.ev_total_24 = { freshness: 'same_run', safeText: '丙'.repeat(959) };
  assert.doesNotThrow(() => materializeCoverageReviewInput({
    answerGoal: { ...GOAL, resolvedQuestion: '', mustAnswerItems: [] },
    claims: [claim('total_exact', [], totalEvidence.map((item) => item.id), { text: '答' })],
    evidence: totalEvidence,
    provenance: exactTotalProvenance,
  }));
  assert.throws(() => materializeCoverageReviewInput({
    answerGoal: { ...GOAL, resolvedQuestion: '', mustAnswerItems: [] },
    claims: [claim('total_overflow', [], totalEvidence.map((item) => item.id), { text: '答' })],
    evidence: totalEvidence,
    provenance: {
      ...exactTotalProvenance,
      ev_total_24: { freshness: 'same_run', safeText: '丙'.repeat(960) },
    },
  }), /coverage_.*limit/);
});

test('Gate A: structured upstream conflict blocks final without natural-language guessing', () => {
  const primary = claim('primary_full', GOAL.mustAnswerItems, ['ev_primary']);
  const coverage = acceptedCoverage(
    [{ claimId: 'primary_full', answerItemIds: GOAL.mustAnswerItems, evidenceIds: ['ev_primary'] }],
    ['primary_full'],
  );
  const conflicted = validateDiagnosticResult(
    concluded([primary], [evidence('ev_primary')]),
    GOAL,
    coverage,
    { blockers: [{ code: 'evidence_conflict', claimIds: ['primary_full'], evidenceIds: ['ev_primary'] }] },
  );
  assert.equal(conflicted.result.status, 'partial');

  const keywordOnly = validateDiagnosticResult(
    concluded([
      { ...primary, text: '日志文本提到 conflict，但结构化审核没有冲突 signal。' },
    ], [evidence('ev_primary')]),
    GOAL,
    coverage,
    { blockers: [] },
  );
  assert.equal(keywordOnly.result.status, 'concluded');
});

test('Gate A: duplicate claim or evidence identities are result-global blockers', () => {
  const duplicateClaims = [
    claim('duplicate', ['如何开启 X'], ['ev_how']),
    claim('duplicate', ['多久生效'], ['ev_when']),
  ];
  const coverage = acceptedCoverage(
    [{ claimId: 'duplicate', answerItemIds: GOAL.mustAnswerItems, evidenceIds: ['ev_how', 'ev_when'] }],
    ['duplicate'],
  );
  const claimValidation = validateDiagnosticResult(
    concluded(duplicateClaims, [evidence('ev_how'), evidence('ev_when')]),
    GOAL,
    coverage,
  );
  assert.equal(claimValidation.result.status, 'partial');

  const full = claim('primary_full', GOAL.mustAnswerItems, ['ev_duplicate']);
  const evidenceValidation = validateDiagnosticResult(
    concluded([full], [evidence('ev_duplicate'), evidence('ev_duplicate')]),
    GOAL,
    acceptedCoverage(
      [{ claimId: 'primary_full', answerItemIds: GOAL.mustAnswerItems, evidenceIds: ['ev_duplicate'] }],
      ['primary_full'],
    ),
  );
  assert.equal(evidenceValidation.result.status, 'partial');
});

test('Gate A: review outcome never upgrades an upstream partial result', () => {
  const primary = claim('primary_full', GOAL.mustAnswerItems, ['ev_primary']);
  const validation = validateDiagnosticResult(
    concluded([primary], [evidence('ev_primary')], {
      status: 'partial',
      recommendedNextAction: 'continue_diagnosis',
    }),
    GOAL,
    acceptedCoverage(
      [{ claimId: 'primary_full', answerItemIds: GOAL.mustAnswerItems, evidenceIds: ['ev_primary'] }],
      ['primary_full'],
    ),
  );
  assert.equal(validation.result.status, 'partial');
  assert.equal(validation.result.recommendedNextAction, 'continue_diagnosis');
  assert.equal(validation.outcomeReasonCode, 'upstream_partial');
});

test('Gate A: deterministic outcome table selects ask_user, partial, or escalate without upgrading', async () => {
  const { freezeReviewOutcome } = await import('../dist/runtime/review-gate.js');
  assert.deepEqual(freezeReviewOutcome({
    upstreamStatus: 'concluded',
    upstreamAction: 'final_answer',
    coverageComplete: false,
    missingInfo: ['请提供当前配置值'],
    globalBlockers: [],
  }), { status: 'need_input', action: 'ask_user', reasonCode: 'coverage_missing_user_input' });
  assert.deepEqual(freezeReviewOutcome({
    upstreamStatus: 'concluded',
    upstreamAction: 'final_answer',
    coverageComplete: false,
    missingInfo: [],
    globalBlockers: [],
  }), { status: 'partial', action: 'continue_diagnosis', reasonCode: 'coverage_incomplete' });
  assert.deepEqual(freezeReviewOutcome({
    upstreamStatus: 'concluded',
    upstreamAction: 'final_answer',
    coverageComplete: false,
    missingInfo: [],
    globalBlockers: [{ code: 'identity_or_safety_blocker' }],
  }), { status: 'partial', action: 'escalate_to_human', reasonCode: 'identity_or_safety_blocker' });
  assert.deepEqual(freezeReviewOutcome({
    upstreamStatus: 'partial',
    upstreamAction: 'continue_diagnosis',
    coverageComplete: true,
    missingInfo: [],
    globalBlockers: [],
  }), { status: 'partial', action: 'continue_diagnosis', reasonCode: 'upstream_partial' });
});
