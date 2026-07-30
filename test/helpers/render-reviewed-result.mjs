import {
  buildSafeFrozenAnswerProjection,
  collectVisiblePromptCandidates,
  renderSafeFrozenAnswer,
} from '../../dist/runtime/safe-answer-projection.js';
import { validateDiagnosticStructure } from '../../dist/runtime/result-validator.js';

export function renderReviewedResultForTest(
  rawResult,
  persona,
  userGoal = '当前问题',
  context = {},
) {
  const structural = validateDiagnosticStructure(rawResult, context.answerGoal);
  const result = structural.result;
  const acceptedClaimIds = result.claims.map((claim) => claim.id).filter(Boolean);
  const frozenPrimaryClaimIds = result.status === 'concluded' &&
      result.recommendedNextAction === 'final_answer'
    ? result.claims
        .filter((claim) => (
          claim.role === 'primary_answer' &&
          (claim.type === 'fact' || claim.type === 'inference') &&
          claim.evidenceIds.length > 0
        ))
        .map((claim) => claim.id)
        .filter(Boolean)
    : [];
  const answerGoal = context.answerGoal ?? {
    rawUserQuestion: userGoal,
    resolvedQuestion: userGoal,
    answerObject: userGoal,
    mustAnswerItems: ['direct_answer'],
    diagnosticObjective: '',
    sourceMessageIds: [],
  };
  const promptCandidates = collectVisiblePromptCandidates({ result, acceptedClaimIds });
  const projection = buildSafeFrozenAnswerProjection({
    result,
    answerGoal,
    frozenPrimaryClaimIds,
    acceptedClaimIds,
    visiblePromptReview: {
      status: 'accepted',
      acceptedIds: promptCandidates.map((item) => item.id),
    },
  });
  return renderSafeFrozenAnswer({ projection, persona });
}
