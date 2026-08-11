import type { AgentModelClient } from '../providers/model/adapter.js';
import { redactSecretText } from '../redaction.js';
import { parseAgentModelJson } from './agent-model-review.js';
import type {
  AnswerCoverageReview,
  CoverageBinding,
  CoverageReviewInput,
} from './answer-coverage.js';

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
      return unknownCoverageReview(`coverage review failed: ${boundedText(reason, 160)}`);
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
      binding.answerItemIds.length === 0 ||
      binding.evidenceIds.length === 0 ||
      binding.answerItemIds.some((item) => !answerItems.has(item)) ||
      binding.evidenceIds.some((id) => !evidenceIds.has(id))
    ) {
      return unknownCoverageReview('invalid coverage binding');
    }
    const claim = claimById.get(binding.claimId)!;
    if (
      binding.answerItemIds.some((item) => !claim.candidateAnswerItemIds.includes(item)) ||
      binding.evidenceIds.some((id) => !claim.evidenceIds.includes(id))
    ) {
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
    candidate.missingElements.length > 20 ||
    !candidate.missingElements.every((item) => (
      typeof item === 'string' &&
      item.trim().length > 0 &&
      Array.from(item.trim()).length <= 160
    )) ||
    (candidate.fullQuestion === 'full' && (
      candidate.missingElements.length > 0 ||
      candidate.fullQuestionClaimIds.length === 0 ||
      candidate.fullQuestionClaimIds.some((id) => (
        claimById.get(id)?.role !== 'primary_answer' ||
        !bindings.some((binding) => binding.claimId === id)
      ))
    ))
  ) {
    return unknownCoverageReview('invalid full-question coverage');
  }
  return {
    status: 'accepted',
    bindings,
    fullQuestion: candidate.fullQuestion as 'full' | 'partial' | 'none',
    fullQuestionClaimIds: [...candidate.fullQuestionClaimIds],
    missingElements: candidate.missingElements.map((item) => boundedText(item, 160)),
    reason: typeof candidate.reason === 'string' ? boundedText(candidate.reason, 160) : '',
  };
}

export function unknownCoverageReview(reason: string): AnswerCoverageReview {
  return {
    status: 'unknown',
    bindings: [],
    fullQuestion: 'unknown',
    fullQuestionClaimIds: [],
    missingElements: [],
    reason: boundedText(reason, 160),
  };
}

function isUniqueStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === 'string') &&
    new Set(value).size === value.length;
}

function boundedText(value: string, limit: number): string {
  return Array.from(
    redactSecretText(value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim(),
  ).slice(0, limit).join('');
}
