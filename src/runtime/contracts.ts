import type { StoredCase } from '../sessions/case-repository.js';

export type RuntimeDecision = 'ask_user' | 'dispatched' | 'final' | 'partial' | 'escalate';

export interface RuntimeTurnResponse {
  caseSession: StoredCase;
  assistantMessage: string;
  decision: RuntimeDecision;
}

export interface ReviewPresentationResult {
  reply: string;
  decision: RuntimeDecision;
}

export interface AcceptedUserTurn {
  caseSession: StoredCase;
  userMessageId: string;
}
