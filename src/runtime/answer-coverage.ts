import type {
  AnswerGoal,
  DiagnosticClaim,
  DiagnosticClaimRole,
  Evidence,
  EvidenceKind,
} from '../domain.js';
import {
  normalizeCoverageSafeText,
  resolveCoverageEvidenceProvenance,
  type CoverageEvidenceEnvelope,
} from './coverage-evidence-provenance.js';
export {
  AnswerCoverageService,
  unknownCoverageReview,
  validateAnswerCoverageReview,
} from './answer-coverage-service.js';

export const COVERAGE_LIMITS = {
  claims: 20,
  evidence: 40,
  segmentCodePoints: 1000,
  totalCodePoints: 24_000,
} as const;

export type CoverageFreshness =
  | 'current_knowledge_v4'
  | 'current_worker_run'
  | 'current_mcp_call'
  | 'current_user_message'
  | 'current_log_excerpt'
  | 'revalidated_current_source'
  // Temporary input aliases retained only for already-materialized test fixtures.
  | 'current_v4'
  | 'same_run'
  | 'current_message';

export interface CoverageClaimSegment {
  id: string;
  text: string;
  type: 'fact' | 'inference';
  role: DiagnosticClaimRole;
  candidateAnswerItemIds: string[];
  evidenceIds: string[];
}

export interface CoverageEvidenceSegment {
  id: string;
  text: string;
  kind: Exclude<EvidenceKind, 'history' | 'unknown'>;
  freshness: CoverageFreshness;
}

export interface CoverageReviewInput {
  resolvedQuestion: string;
  mustAnswerItems: string[];
  claimSegments: CoverageClaimSegment[];
  evidenceSegments: CoverageEvidenceSegment[];
}

export interface CoverageBinding {
  claimId: string;
  answerItemIds: string[];
  evidenceIds: string[];
}

export interface AnswerCoverageReview {
  status: 'accepted' | 'unknown';
  bindings: CoverageBinding[];
  fullQuestion: 'full' | 'partial' | 'none' | 'unknown';
  fullQuestionClaimIds: string[];
  missingElements: string[];
  reason?: string;
}

export interface CoverageEvidenceProvenance {
  freshness: CoverageFreshness;
  safeText: string;
}

export class CoverageMaterializationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CoverageMaterializationError';
  }
}

export function materializeCoverageReviewInput(input: {
  answerGoal: AnswerGoal;
  claims: DiagnosticClaim[];
  evidence: Evidence[];
  provenance: Record<string, CoverageEvidenceProvenance | undefined>;
}): CoverageReviewInput {
  const candidateClaims = input.claims.filter((item) => (
    (item.type === 'fact' || item.type === 'inference') &&
    item.role === 'primary_answer'
  ));
  if (candidateClaims.length > COVERAGE_LIMITS.claims) {
    throw new CoverageMaterializationError('coverage_claim_limit');
  }

  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const selectedEvidenceIds = stableUnique(candidateClaims.flatMap((item) => item.evidenceIds));
  if (selectedEvidenceIds.length > COVERAGE_LIMITS.evidence) {
    throw new CoverageMaterializationError('coverage_evidence_limit');
  }

  const claimSegments = candidateClaims.map((item): CoverageClaimSegment => {
    const id = item.id?.trim();
    if (!id) throw new CoverageMaterializationError('coverage_claim_identity');
    const text = boundedWholeSegment(item.text, 'coverage_claim_segment_limit');
    if (!text) throw new CoverageMaterializationError('coverage_claim_empty');
    return {
      id,
      text,
      type: item.type as 'fact' | 'inference',
      role: item.role,
      candidateAnswerItemIds: stableUnique(item.answers),
      evidenceIds: stableUnique(item.evidenceIds),
    };
  });

  const evidenceSegments = selectedEvidenceIds.map((id): CoverageEvidenceSegment => {
    const item = evidenceById.get(id);
    const provenance = input.provenance[id];
    if (!item || !provenance || !eligibleFreshness(item.kind, provenance.freshness)) {
      throw new CoverageMaterializationError('coverage_evidence_freshness');
    }
    if (item.kind === 'history' || item.kind === 'unknown') {
      throw new CoverageMaterializationError('coverage_evidence_kind');
    }
    const text = boundedWholeSegment(provenance.safeText, 'coverage_evidence_segment_limit');
    if (!text) throw new CoverageMaterializationError('coverage_evidence_empty');
    return {
      id,
      text,
      kind: item.kind,
      freshness: provenance.freshness,
    };
  });

  const resolvedQuestion = boundedWholeSegment(
    input.answerGoal.resolvedQuestion,
    'coverage_question_segment_limit',
  );
  const mustAnswerItems = input.answerGoal.mustAnswerItems.map((item) => (
    boundedWholeSegment(item, 'coverage_answer_item_limit')
  ));
  const total = [
    resolvedQuestion,
    ...mustAnswerItems,
    ...claimSegments.map((item) => item.text),
    ...evidenceSegments.map((item) => item.text),
  ].reduce((sum, item) => sum + codePointLength(item), 0);
  if (total > COVERAGE_LIMITS.totalCodePoints) {
    throw new CoverageMaterializationError('coverage_total_text_limit');
  }

  return {
    resolvedQuestion,
    mustAnswerItems,
    claimSegments,
    evidenceSegments,
  };
}

export function materializeCurrentCoverageReviewInput(input: {
  answerGoal: AnswerGoal;
  claims: DiagnosticClaim[];
  evidence: Evidence[];
  envelopes: CoverageEvidenceEnvelope[];
  currentRunId: string;
}): CoverageReviewInput {
  return materializeCoverageReviewInput({
    answerGoal: input.answerGoal,
    claims: input.claims,
    evidence: input.evidence,
    provenance: resolveCoverageEvidenceProvenance({
      evidence: input.evidence,
      envelopes: input.envelopes,
      currentRunId: input.currentRunId,
      currentSourceMessageIds: input.answerGoal.sourceMessageIds,
    }),
  });
}

export function selectFrozenPrimaryClaimIds(input: {
  claims: DiagnosticClaim[];
  answerGoal: AnswerGoal;
  review: AnswerCoverageReview;
}): string[] {
  if (
    !input.review ||
    input.review.status !== 'accepted' ||
    !Array.isArray(input.review.bindings) ||
    !Array.isArray(input.review.fullQuestionClaimIds) ||
    !Array.isArray(input.review.missingElements) ||
    input.review.fullQuestion !== 'full' ||
    input.review.missingElements.length > 0
  ) {
    return [];
  }
  const bindingByClaim = new Map(input.review.bindings.map((item) => [item.claimId, item]));
  const eligible = input.claims.filter((claim) => (
    Boolean(claim.id) &&
    claim.role === 'primary_answer' &&
    (claim.type === 'fact' || claim.type === 'inference') &&
    bindingByClaim.has(claim.id!)
  ));
  const eligibleIds = new Set(eligible.map((claim) => claim.id!));
  if (input.review.fullQuestionClaimIds.some((id) => !eligibleIds.has(id))) return [];

  const selected: string[] = [];
  const covered = new Set<string>();
  for (const claim of eligible) {
    const binding = bindingByClaim.get(claim.id!)!;
    if (binding.answerItemIds.some((item) => !covered.has(item))) {
      selected.push(claim.id!);
      binding.answerItemIds.forEach((item) => covered.add(item));
    }
  }
  if (input.answerGoal.mustAnswerItems.some((item) => !covered.has(item))) return [];
  for (const claim of eligible) {
    if (input.review.fullQuestionClaimIds.includes(claim.id!) && !selected.includes(claim.id!)) {
      selected.push(claim.id!);
    }
  }
  return selected;
}

function boundedWholeSegment(value: string, code: string): string {
  const normalized = normalizeCoverageSafeText(value);
  if (codePointLength(normalized) > COVERAGE_LIMITS.segmentCodePoints) {
    throw new CoverageMaterializationError(code);
  }
  return normalized;
}

function eligibleFreshness(kind: EvidenceKind, freshness: CoverageFreshness): boolean {
  if (kind === 'knowledge') return freshness === 'current_knowledge_v4' || freshness === 'current_v4';
  if (kind === 'manual') return freshness === 'current_user_message' || freshness === 'current_message';
  if (kind === 'workspace') return freshness === 'current_worker_run' || freshness === 'revalidated_current_source' || freshness === 'same_run';
  if (kind === 'mcp') return freshness === 'current_mcp_call' || freshness === 'revalidated_current_source' || freshness === 'same_run';
  if (kind === 'log') return freshness === 'current_log_excerpt' || freshness === 'same_run';
  return false;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function stableUnique(items: string[]): string[] {
  return Array.from(new Set(items.filter((item) => typeof item === 'string')));
}
