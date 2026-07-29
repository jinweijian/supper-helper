import type {
  AnswerGoal,
  DiagnosticClaim,
  DiagnosticClaimRole,
  Evidence,
  EvidenceKind,
} from '../domain.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import { parseAgentModelJson } from './agent-model-review.js';

export const COVERAGE_LIMITS = {
  claims: 20,
  evidence: 40,
  segmentCodePoints: 1000,
  totalCodePoints: 24_000,
} as const;

export type CoverageFreshness = 'current_v4' | 'same_run' | 'current_message';

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

export class AnswerCoverageService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly agentSpec: string,
  ) {}

  async review(input: CoverageReviewInput): Promise<AnswerCoverageReview> {
    try {
      const response = await this.model.complete([
        {
          role: 'system',
          content: `${this.agentSpec}

Return JSON only:
{"status":"accepted","bindings":[{"claimId":"claim_1","answerItemIds":["item"],"evidenceIds":["ev_1"]}],"fullQuestion":"full","fullQuestionClaimIds":["claim_1"],"missingElements":[],"reason":"..."}

Do not return user-visible prose or fields outside this schema.`,
        },
        { role: 'user', content: JSON.stringify(input) },
      ], { json: true });
      return validateAnswerCoverageReview(
        parseAgentModelJson<Partial<AnswerCoverageReview>>(response),
        input,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return unknownCoverageReview(`coverage review failed: ${reason}`);
    }
  }
}

export function validateAnswerCoverageReview(
  value: unknown,
  input: CoverageReviewInput,
): AnswerCoverageReview {
  if (!value || typeof value !== 'object') return unknownCoverageReview('malformed coverage review');
  const candidate = value as Partial<AnswerCoverageReview>;
  if (
    candidate.status !== 'accepted' ||
    !Array.isArray(candidate.bindings) ||
    !Array.isArray(candidate.fullQuestionClaimIds) ||
    !Array.isArray(candidate.missingElements) ||
    !['full', 'partial', 'none'].includes(candidate.fullQuestion ?? '')
  ) {
    return unknownCoverageReview('malformed coverage review');
  }

  const claimById = new Map(input.claimSegments.map((item) => [item.id, item]));
  const evidenceIds = new Set(input.evidenceSegments.map((item) => item.id));
  const answerItems = new Set(input.mustAnswerItems);
  const bindings: CoverageBinding[] = [];
  for (const raw of candidate.bindings) {
    if (!raw || typeof raw !== 'object') return unknownCoverageReview('malformed coverage binding');
    const binding = raw as Partial<CoverageBinding>;
    if (
      typeof binding.claimId !== 'string' ||
      !claimById.has(binding.claimId) ||
      !isUniqueStringArray(binding.answerItemIds) ||
      !isUniqueStringArray(binding.evidenceIds) ||
      binding.answerItemIds.some((item) => !answerItems.has(item)) ||
      binding.evidenceIds.some((id) => !evidenceIds.has(id))
    ) {
      return unknownCoverageReview('invalid coverage binding');
    }
    const claim = claimById.get(binding.claimId)!;
    if (binding.evidenceIds.some((id) => !claim.evidenceIds.includes(id))) {
      return unknownCoverageReview('coverage binding evidence mismatch');
    }
    bindings.push({
      claimId: binding.claimId,
      answerItemIds: [...binding.answerItemIds],
      evidenceIds: [...binding.evidenceIds],
    });
  }

  if (
    !isUniqueStringArray(candidate.fullQuestionClaimIds) ||
    candidate.fullQuestionClaimIds.some((id) => !claimById.has(id)) ||
    !candidate.missingElements.every((item) => typeof item === 'string')
  ) {
    return unknownCoverageReview('invalid full-question coverage');
  }
  return {
    status: 'accepted',
    bindings,
    fullQuestion: candidate.fullQuestion as 'full' | 'partial' | 'none',
    fullQuestionClaimIds: [...candidate.fullQuestionClaimIds],
    missingElements: [...candidate.missingElements],
    reason: typeof candidate.reason === 'string' ? candidate.reason : '',
  };
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

export function unknownCoverageReview(reason: string): AnswerCoverageReview {
  return {
    status: 'unknown',
    bindings: [],
    fullQuestion: 'unknown',
    fullQuestionClaimIds: [],
    missingElements: [],
    reason,
  };
}

function boundedWholeSegment(value: string, code: string): string {
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (codePointLength(normalized) > COVERAGE_LIMITS.segmentCodePoints) {
    throw new CoverageMaterializationError(code);
  }
  return normalized;
}

function eligibleFreshness(kind: EvidenceKind, freshness: CoverageFreshness): boolean {
  if (kind === 'knowledge') return freshness === 'current_v4';
  if (kind === 'manual') return freshness === 'current_message';
  if (kind === 'workspace' || kind === 'mcp' || kind === 'log') return freshness === 'same_run';
  return false;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function stableUnique(items: string[]): string[] {
  return Array.from(new Set(items.filter((item) => typeof item === 'string')));
}

function isUniqueStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === 'string') &&
    new Set(value).size === value.length;
}
