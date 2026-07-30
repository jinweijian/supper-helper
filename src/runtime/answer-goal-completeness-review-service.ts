import type { AgentModelClient } from '../providers/model/adapter.js';
import { redactSecretText } from '../redaction.js';
import { parseAgentModelJson } from './agent-model-review.js';

const MAX_MISSING_ELEMENTS = 5;
const MAX_ELEMENT_CODE_POINTS = 80;

export interface AnswerGoalCompletenessReview {
  status: 'complete' | 'incomplete' | 'unknown';
  missingElements: string[];
  reason: string;
}

export class AnswerGoalCompletenessReviewService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly agentSpec: string,
  ) {}

  async review(input: {
    resolvedQuestion: string;
    proposedItems: string[];
  }): Promise<AnswerGoalCompletenessReview> {
    try {
      const response = await this.model.complete([
        {
          role: 'system',
          content: `${this.agentSpec}

Return JSON only:
{"status":"complete|incomplete|unknown","missingElements":["..."],"reason":"bounded_reason"}

Only judge whether the proposed items represent every user-visible answer obligation in the complete resolved question. Do not rewrite items or return user-facing prose.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            resolvedQuestion: input.resolvedQuestion,
            proposedItems: input.proposedItems,
          }),
        },
      ], { json: true });
      return validateCompletenessReview(
        parseAgentModelJson<Partial<AnswerGoalCompletenessReview>>(response),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return unknownReview(`completeness_review_failed:${boundedReason(reason)}`);
    }
  }
}

export function validateCompletenessReview(value: unknown): AnswerGoalCompletenessReview {
  if (!value || typeof value !== 'object') return unknownReview('malformed_review');
  const candidate = value as Partial<AnswerGoalCompletenessReview>;
  if (
    (candidate.status !== 'complete' &&
      candidate.status !== 'incomplete' &&
      candidate.status !== 'unknown') ||
    !Array.isArray(candidate.missingElements) ||
    candidate.missingElements.length > MAX_MISSING_ELEMENTS ||
    !candidate.missingElements.every((item) => (
      typeof item === 'string' &&
      item.trim().length > 0 &&
      Array.from(item.trim()).length <= MAX_ELEMENT_CODE_POINTS
    ))
  ) {
    return unknownReview('malformed_review');
  }
  if (candidate.status === 'complete' && candidate.missingElements.length > 0) {
    return unknownReview('contradictory_review');
  }
  return {
    status: candidate.status,
    missingElements: candidate.missingElements.map((item) => item.replace(/\s+/g, ' ').trim()),
    reason: typeof candidate.reason === 'string'
      ? boundedReason(candidate.reason)
      : 'unspecified',
  };
}

function unknownReview(reason: string): AnswerGoalCompletenessReview {
  return {
    status: 'unknown',
    missingElements: [],
    reason,
  };
}

function boundedReason(value: string): string {
  return Array.from(redactSecretText(value).replace(/[\u0000-\u001F\u007F]/g, '').trim())
    .slice(0, 160)
    .join('');
}
