import type { StoredCase, CaseRepository } from '../sessions/case-repository.js';
import type { ReviewPresentationResult, RuntimeTurnResponse } from './contracts.js';
import type { CaseRuntimeEventRecorder } from './event-recorder.js';

export function completePresentedTurn(input: {
  store: CaseRepository;
  events: CaseRuntimeEventRecorder;
  caseSession: StoredCase;
  review: ReviewPresentationResult;
  replyToMessageId?: string;
}): RuntimeTurnResponse {
  const { store, events, caseSession, review, replyToMessageId } = input;
  events.presentationPrepared(caseSession, review.decision);
  store.addMessage(caseSession, {
    role: 'helper',
    body: review.reply,
    replyToMessageId,
  });
  events.finalReplyCreated(caseSession, review.reply, review.decision);
  caseSession.status = review.caseStatus;
  store.saveCase(caseSession);
  return {
    caseSession,
    assistantMessage: review.reply,
    decision: review.decision,
  };
}
