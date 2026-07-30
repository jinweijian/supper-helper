import type { AnswerGoal, DiagnosticClaim, DiagnosticClaimRole, DiagnosticResult, Evidence } from '../domain.js';
import { DIRECT_ANSWER_ITEM } from './answer-goal.js';
import {
  selectFrozenPrimaryClaimIds,
  type AnswerCoverageReview,
} from './answer-coverage.js';
import {
  freezeReviewOutcome,
  type ReviewGlobalBlocker,
} from './review-gate.js';

export interface DiagnosticValidationIssue {
  code:
    | 'duplicate_evidence_id'
    | 'missing_evidence_reference'
    | 'low_confidence_fact'
    | 'invalid_claim_type'
    | 'missing_claim_role'
    | 'missing_claim_answers'
    | 'missing_primary_answer'
    | 'incomplete_primary_answer'
    | 'duplicate_claim_id'
    | 'unsupported_claim';
  claimId?: string;
  evidenceId?: string;
  message: string;
}

export interface ValidatedDiagnosticResult {
  result: DiagnosticResult;
  issues: DiagnosticValidationIssue[];
  acceptedClaimIds: string[];
  rejectedClaimIds: string[];
  acceptedPrimaryAnswerClaimIds: string[];
  globalBlockers: ReviewGlobalBlocker[];
  outcomeReasonCode: string;
}

export function validateDiagnosticStructure(
  result: DiagnosticResult,
  answerGoal?: AnswerGoal,
): ValidatedDiagnosticResult {
  const issues: DiagnosticValidationIssue[] = [];
  const globalBlockers: ReviewGlobalBlocker[] = [];
  const evidence = uniqueEvidence(result.evidence, issues);
  if (evidence.length !== result.evidence.length) {
    globalBlockers.push({ code: 'duplicate_evidence_id' });
  }
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const claims: DiagnosticClaim[] = [];
  const rejectedClaimIds: string[] = [];
  const seenClaimIds = new Set<string>();

  result.claims.forEach((claim, index) => {
    const id = claim.id ?? `claim_${index + 1}`;
    if (seenClaimIds.has(id)) {
      issues.push({ code: 'duplicate_claim_id', claimId: id, message: `Duplicate claim id ${id}.` });
      rejectedClaimIds.push(id);
      globalBlockers.push({ code: 'duplicate_claim_id', claimIds: [id] });
      return;
    }
    seenClaimIds.add(id);
    if (!['fact', 'inference', 'assumption', 'unknown'].includes(claim.type)) {
      issues.push({ code: 'invalid_claim_type', claimId: id, message: `Claim ${id} has an invalid claim type.` });
      issues.push({ code: 'unsupported_claim', claimId: id, message: `Claim ${id} was rejected by deterministic validation.` });
      rejectedClaimIds.push(id);
      return;
    }
    if (!validClaimRole(claim.role)) {
      issues.push({ code: 'missing_claim_role', claimId: id, message: `Claim ${id} must declare a valid role.` });
      issues.push({ code: 'unsupported_claim', claimId: id, message: `Claim ${id} was rejected by deterministic validation.` });
      rejectedClaimIds.push(id);
      return;
    }
    if (!Array.isArray(claim.answers)) {
      issues.push({ code: 'missing_claim_answers', claimId: id, message: `Claim ${id} must declare answers.` });
      issues.push({ code: 'unsupported_claim', claimId: id, message: `Claim ${id} was rejected by deterministic validation.` });
      rejectedClaimIds.push(id);
      return;
    }
    if (claim.role === 'primary_answer' && claim.answers.length === 0) {
      issues.push({ code: 'incomplete_primary_answer', claimId: id, message: `Primary answer claim ${id} must cover answerGoal.mustAnswerItems.` });
      issues.push({ code: 'unsupported_claim', claimId: id, message: `Claim ${id} was rejected by deterministic validation.` });
      rejectedClaimIds.push(id);
      return;
    }
    const missing = claim.evidenceIds.filter((evidenceId) => !evidenceById.has(evidenceId));
    for (const evidenceId of missing) {
      issues.push({
        code: 'missing_evidence_reference',
        claimId: id,
        evidenceId,
        message: `Claim ${id} references missing evidence ${evidenceId}.`,
      });
    }
    const validEvidenceIds = Array.from(new Set(claim.evidenceIds.filter((evidenceId) => evidenceById.has(evidenceId))));
    const validEvidence = validEvidenceIds.map((evidenceId) => evidenceById.get(evidenceId)!);
    const factHasAuthority = claim.type !== 'fact' || validEvidence.some((item) => (
      item.kind !== 'unknown' && (item.confidence === 'medium' || item.confidence === 'high')
    ));
    const supported = claim.type === 'unknown' || claim.type === 'assumption'
      ? missing.length === 0
      : validEvidenceIds.length > 0 && missing.length === 0;
    if (!factHasAuthority) {
      issues.push({ code: 'low_confidence_fact', claimId: id, message: `Fact ${id} has no medium/high confidence evidence.` });
    }
    if (!supported || !factHasAuthority) {
      issues.push({ code: 'unsupported_claim', claimId: id, message: `Claim ${id} was rejected by deterministic validation.` });
      rejectedClaimIds.push(id);
      return;
    }
    claims.push({ ...claim, id, evidenceIds: validEvidenceIds });
  });

  const validated: DiagnosticResult = {
    ...result,
    evidence,
    claims,
    missingInfo: result.missingInfo,
  };
  return {
    result: validated,
    issues,
    acceptedClaimIds: claims.map((claim) => claim.id!),
    rejectedClaimIds,
    acceptedPrimaryAnswerClaimIds: [],
    globalBlockers,
    outcomeReasonCode: 'structural_validation_complete',
  };
}

export function freezeReviewedDiagnosticResult(input: {
  structural: ValidatedDiagnosticResult;
  answerGoal: AnswerGoal;
  coverageReview?: AnswerCoverageReview;
  upstreamBlockers?: ReviewGlobalBlocker[];
}): ValidatedDiagnosticResult {
  const issues = [...input.structural.issues];
  const globalBlockers = [
    ...input.structural.globalBlockers,
    ...(input.upstreamBlockers ?? []),
  ];
  const acceptedPrimaryAnswerClaimIds = input.coverageReview
    ? selectFrozenPrimaryClaimIds({
        claims: input.structural.result.claims,
        answerGoal: input.answerGoal,
        review: input.coverageReview,
      })
    : [];
  const coverageComplete = acceptedPrimaryAnswerClaimIds.length > 0;
  const result = input.structural.result;
  if (
    (result.status === 'concluded' || result.recommendedNextAction === 'final_answer') &&
    !coverageComplete
  ) {
    issues.push({
      code: 'missing_primary_answer',
      message: 'Final answer requires an accepted primary_answer claim that covers answerGoal.mustAnswerItems.',
    });
    globalBlockers.push({ code: 'primary_coverage_incomplete' });
  }
  const outcome = freezeReviewOutcome({
    upstreamStatus: result.status,
    upstreamAction: result.recommendedNextAction,
    coverageComplete,
    missingInfo: result.missingInfo,
    globalBlockers,
  });
  const downgrade = outcome.status !== result.status ||
    outcome.action !== result.recommendedNextAction;
  return {
    ...input.structural,
    result: {
      ...result,
      status: outcome.status,
      summary: downgrade
        ? '诊断结果包含未通过证据校验的内容，暂不能形成最终结论。'
        : result.summary,
      recommendedNextAction: outcome.action,
    },
    issues,
    acceptedPrimaryAnswerClaimIds,
    globalBlockers,
    outcomeReasonCode: outcome.reasonCode,
  };
}

/**
 * Conservative convenience API for non-presentation callers.
 * Production presentation uses the two explicit phases above.
 */
export function validateDiagnosticResult(
  result: DiagnosticResult,
  answerGoal?: AnswerGoal,
  coverageReview?: AnswerCoverageReview,
  upstreamReview?: { blockers?: ReviewGlobalBlocker[] },
): ValidatedDiagnosticResult {
  const goal = answerGoal ?? fallbackAnswerGoal();
  return freezeReviewedDiagnosticResult({
    structural: validateDiagnosticStructure(result, goal),
    answerGoal: goal,
    coverageReview,
    upstreamBlockers: upstreamReview?.blockers,
  });
}

function validClaimRole(role: unknown): role is DiagnosticClaimRole {
  return role === 'primary_answer' ||
    role === 'supporting_context' ||
    role === 'evidence_locator' ||
    role === 'process_note' ||
    role === 'next_action' ||
    role === 'unknown';
}

function fallbackAnswerGoal(): AnswerGoal {
  return {
    rawUserQuestion: '',
    resolvedQuestion: '',
    answerObject: '当前问题',
    mustAnswerItems: [DIRECT_ANSWER_ITEM],
    diagnosticObjective: '',
    sourceMessageIds: [],
  };
}

function uniqueEvidence(evidence: Evidence[], issues: DiagnosticValidationIssue[]): Evidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    if (seen.has(item.id)) {
      issues.push({
        code: 'duplicate_evidence_id',
        evidenceId: item.id,
        message: `Duplicate evidence id ${item.id} was discarded.`,
      });
      return false;
    }
    seen.add(item.id);
    return true;
  });
}
