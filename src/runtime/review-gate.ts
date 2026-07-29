import type { DiagnosticResult, WorkerTrace } from '../domain.js';
import type { StoredCase } from '../sessions/case-repository.js';

export type AgentDecision = 'ask_user' | 'dispatched' | 'final' | 'partial' | 'escalate';

export interface ReviewGlobalBlocker {
  code: string;
  claimIds?: string[];
  evidenceIds?: string[];
}

export interface FrozenReviewOutcome {
  status: DiagnosticResult['status'];
  action: DiagnosticResult['recommendedNextAction'];
  reasonCode: string;
}

export function freezeReviewOutcome(input: {
  upstreamStatus: DiagnosticResult['status'];
  upstreamAction: DiagnosticResult['recommendedNextAction'];
  coverageComplete: boolean;
  missingInfo: string[];
  globalBlockers: ReviewGlobalBlocker[];
}): FrozenReviewOutcome {
  if (input.upstreamAction === 'escalate_to_human') {
    return { status: 'partial', action: 'escalate_to_human', reasonCode: 'upstream_escalate' };
  }
  const safety = input.globalBlockers.find((item) => (
    item.code === 'identity_or_safety_blocker' ||
    item.code === 'evidence_conflict'
  ));
  if (safety) {
    return { status: 'partial', action: 'escalate_to_human', reasonCode: safety.code };
  }
  if (input.upstreamStatus === 'need_input' || input.upstreamAction === 'ask_user') {
    return { status: 'need_input', action: 'ask_user', reasonCode: 'upstream_ask_user' };
  }
  if (input.upstreamStatus === 'partial' || input.upstreamAction === 'continue_diagnosis') {
    return { status: 'partial', action: 'continue_diagnosis', reasonCode: 'upstream_partial' };
  }
  if (input.coverageComplete && input.globalBlockers.length === 0) {
    return { status: 'concluded', action: 'final_answer', reasonCode: 'coverage_complete' };
  }
  if (input.missingInfo.length > 0) {
    return { status: 'need_input', action: 'ask_user', reasonCode: 'coverage_missing_user_input' };
  }
  return { status: 'partial', action: 'continue_diagnosis', reasonCode: 'coverage_incomplete' };
}

export function decisionFromReviewOutcome(
  _outcome: 'ask_user' | 'partial' | 'final_answer' | 'escalate_to_human' | undefined,
  result: DiagnosticResult,
): AgentDecision {
  return decisionFromDiagnosticResult(result);
}

export function decisionFromDiagnosticResult(result: DiagnosticResult): AgentDecision {
  if (result.recommendedNextAction === 'ask_user' || result.status === 'need_input') {
    return 'ask_user';
  }
  if (result.recommendedNextAction === 'escalate_to_human') {
    return 'escalate';
  }
  if (
    result.recommendedNextAction === 'final_answer' &&
    result.status === 'concluded' &&
    hasAcceptedPrimaryAnswerShape(result)
  ) {
    return 'final';
  }
  return 'partial';
}

export function caseStatusFromDiagnosticResult(result: DiagnosticResult): StoredCase['status'] {
  if (
    result.status === 'concluded' &&
    result.recommendedNextAction === 'final_answer' &&
    hasAcceptedPrimaryAnswerShape(result)
  ) {
    return 'concluded';
  }
  if (result.status === 'need_input') {
    return 'need_input';
  }
  return 'partial';
}

function hasAcceptedPrimaryAnswerShape(result: DiagnosticResult): boolean {
  return result.claims.some((claim) => (
    claim.role === 'primary_answer' &&
    (claim.type === 'fact' || claim.type === 'inference') &&
    Array.isArray(claim.answers) &&
    claim.answers.length > 0 &&
    claim.evidenceIds.length > 0 &&
    claim.evidenceIds.every((evidenceId) => result.evidence.some((item) => item.id === evidenceId)) &&
    (
      claim.type !== 'fact' ||
      claim.evidenceIds.some((evidenceId) => {
        const evidence = result.evidence.find((item) => item.id === evidenceId);
        return evidence?.kind !== 'unknown' && (evidence?.confidence === 'medium' || evidence?.confidence === 'high');
      })
    )
  ));
}

export function shouldRunFollowUp(
  review: { reply: string; decision: AgentDecision },
  result: DiagnosticResult,
  trace: WorkerTrace,
): boolean {
  return review.decision === 'partial' && result.recommendedNextAction === 'continue_diagnosis' && !trace.error;
}
