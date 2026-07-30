import { redactSecretText } from '../redaction.js';
import { DIRECT_ANSWER_ITEM } from './answer-goal.js';
import type { AnswerGoalCompletenessReview } from './answer-goal-completeness-review-service.js';

const MAX_ITEM_COUNT = 5;
const MAX_ITEM_CODE_POINTS = 80;

export interface ReconciledMustAnswerItems {
  items: string[];
  source: 'model' | 'fallback';
  reason: string;
}

export function reconcileMustAnswerItems(input: {
  resolvedQuestion: string;
  proposedItems: unknown;
  completenessReview?: AnswerGoalCompletenessReview;
}): ReconciledMustAnswerItems {
  const proposed = input.proposedItems;
  if (
    !Array.isArray(proposed) ||
    proposed.length < 1 ||
    proposed.length > MAX_ITEM_COUNT
  ) {
    return fallback('invalid_item_collection');
  }

  const resolvedQuestion = normalizeText(input.resolvedQuestion);
  const items: string[] = [];
  for (const raw of proposed) {
    if (typeof raw !== 'string') return fallback('invalid_item_shape');
    const item = normalizeText(raw);
    if (
      !item ||
      hasControlCharacter(raw) ||
      Array.from(item).length > MAX_ITEM_CODE_POINTS ||
      redactSecretText(item) !== item
    ) {
      return fallback('invalid_item_shape');
    }
    if (!resolvedQuestion.includes(item)) {
      return fallback('item_out_of_scope');
    }
    if (!items.includes(item)) items.push(item);
  }
  if (items.length === 0) return fallback('invalid_item_collection');

  const review = input.completenessReview;
  if (
    !review ||
    review.status !== 'complete' ||
    !Array.isArray(review.missingElements) ||
    review.missingElements.length > 0 ||
    'proposerCertified' in review
  ) {
    return fallback(review?.status === 'incomplete' ? 'incomplete_item_set' : 'completeness_review_unavailable');
  }

  return {
    items,
    source: 'model',
    reason: 'accepted',
  };
}

function fallback(reason: string): ReconciledMustAnswerItems {
  return {
    items: [DIRECT_ANSWER_ITEM],
    source: 'fallback',
    reason,
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value);
}
