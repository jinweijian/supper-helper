import { randomUUID } from 'node:crypto';
import type { DiagnosticRequest, DiagnosticRun } from '../domain.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import type { RuntimeTurnResponse } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { findExperienceMatch, findRejectedExperienceCandidates } from './experience-agent.js';
import { ReviewPresentationService } from './review-presentation.js';
import { completePresentedTurn } from './turn-completion.js';

export class ExperienceTurnService {
  constructor(
    private readonly store: CaseRepository,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly reviewer: ReviewPresentationService,
  ) {}

  async answer(
    caseSession: StoredCase,
    request: DiagnosticRequest,
    replyToMessageId?: string,
  ): Promise<RuntimeTurnResponse | undefined> {
    this.events.experienceStarted(caseSession, request.userGoal);
    const match = findExperienceMatch({
      store: this.store,
      currentCase: caseSession,
      userMessage: request.userGoal,
      answerGoal: request.answerGoal,
    });

    if (!match) {
      const rejectedCandidates = findRejectedExperienceCandidates({
        store: this.store,
        currentCase: caseSession,
        userMessage: request.userGoal,
        answerGoal: request.answerGoal,
      });
      if (rejectedCandidates.length > 0) {
        request.context ??= {
          isFollowUp: false,
          currentUserMessage: request.userGoal,
          recentMessages: [],
          previousRuns: [],
        };
        request.context.experienceCandidates = rejectedCandidates;
        this.events.experienceCandidatesRejected(caseSession, rejectedCandidates);
      }
      this.events.experienceMiss(caseSession);
      return undefined;
    }

    this.events.experienceHit(caseSession, {
      sourceCaseId: match.sourceCaseId,
      sourceMessageId: match.sourceMessageId,
      sourceReplyId: match.sourceReplyId,
      sourceRunId: match.sourceRunId,
      score: match.score,
    });
    const run: DiagnosticRun = {
      id: `run_${randomUUID().slice(0, 8)}`,
      caseId: caseSession.id,
      status: 'running',
      request,
      result: match.result,
    };
    caseSession.status = 'diagnosing';
    this.store.addRun(caseSession, run);
    const review = await this.reviewer.reviewAndFormat(caseSession, match.result, run);
    return completePresentedTurn({
      store: this.store,
      events: this.events,
      caseSession,
      review,
      replyToMessageId,
    });
  }
}
