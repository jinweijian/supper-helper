import type { DiagnosticRequest } from '../domain.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import type { DiagnosticWorker } from '../workers/diagnostic-worker.js';
import type { ReviewPresentationResult } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { buildFollowUpDiagnosticRequest } from './request-builder.js';
import { shouldRunFollowUp } from './review-gate.js';
import { ReviewPresentationService } from './review-presentation.js';
import {
  applyWorkerResponseToRun,
  createRunningDiagnosticRun,
  prepareDeepQueryRetry,
} from './worker-turn.js';

export class WorkerDiagnosisService {
  constructor(
    private readonly store: CaseRepository,
    private readonly worker: DiagnosticWorker,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly reviewer: ReviewPresentationService,
  ) {}

  async diagnose(caseSession: StoredCase, request: DiagnosticRequest): Promise<ReviewPresentationResult> {
    caseSession.status = 'diagnosing';
    this.events.preflightDispatch(caseSession, request);
    const run = createRunningDiagnosticRun({ request, caseId: caseSession.id });
    this.store.addRun(caseSession, run);
    this.events.diagnosticRequestCreated(caseSession, request);
    this.store.appendDailyMemory(`- ${new Date().toISOString()} ${caseSession.id} dispatch ${run.id}`);

    const workerResponse = await this.worker.diagnose(request);
    const result = applyWorkerResponseToRun({ run, response: workerResponse });
    caseSession.status = 'diagnosing';
    this.store.saveCase(caseSession);
    this.events.workerTrace(caseSession, workerResponse.trace);

    let review = await this.reviewer.reviewAndFormat(caseSession, result, run);
    if (!shouldRunFollowUp(review, result, workerResponse.trace)) {
      return review;
    }

    const deepRetry = prepareDeepQueryRetry({
      previousRequest: request,
      previousResult: result,
      workerTrace: workerResponse.trace,
      reviewDecision: review.decision,
    });
    if (deepRetry.stop) {
      this.events.deepQueryStopped(caseSession, deepRetry.stop);
      return review;
    }

    this.events.followUpDiagnosticRequested(caseSession, run, result);
    const followUpRequest = buildFollowUpDiagnosticRequest({
      caseSession,
      previousRequest: request,
      previousResult: result,
    });
    if (deepRetry.retry) {
      followUpRequest.context ??= {
        isFollowUp: true,
        currentUserMessage: followUpRequest.userGoal,
        recentMessages: [],
        previousRuns: [],
      };
      followUpRequest.context.knowledge = request.context?.knowledge;
      followUpRequest.context.deepQuery = deepRetry.retry.deepQuery;
      followUpRequest.constraints = Array.from(new Set([
        ...followUpRequest.constraints,
        'Deep Query retry: continue read-only investigation with the pivoted artifact targets.',
        `Pivot artifact targets: ${deepRetry.retry.deepQuery.artifactTargets.join(', ')}`,
        `Correction actions: ${deepRetry.retry.deepQuery.correctionActions.join(', ')}`,
      ]));
      this.events.deepQueryRetryRequested(caseSession, {
        attempt: deepRetry.retry.deepQuery.attempt ?? 2,
        maxAttempts: deepRetry.retry.deepQuery.maxAttempts ?? 2,
        previousArtifactTargets: deepRetry.retry.deepQuery.previousArtifactTargets ?? [],
        nextArtifactTargets: deepRetry.retry.deepQuery.artifactTargets,
        failedReasons: deepRetry.retry.deepQuery.failedReasons ?? [],
        correctionActions: deepRetry.retry.deepQuery.correctionActions,
      });
      this.events.deepQueryPivotSelected(caseSession, {
        attempt: deepRetry.retry.deepQuery.attempt ?? 2,
        previousArtifactTargets: deepRetry.retry.deepQuery.previousArtifactTargets ?? [],
        nextArtifactTargets: deepRetry.retry.deepQuery.artifactTargets,
        correctionActions: deepRetry.retry.deepQuery.correctionActions,
      });
    }

    const followUpRun = createRunningDiagnosticRun({
      request: followUpRequest,
      caseId: caseSession.id,
    });
    this.store.addRun(caseSession, followUpRun);
    this.events.diagnosticRequestCreated(caseSession, followUpRequest, { followUp: true });
    const followUpResponse = await this.worker.diagnose(followUpRequest);
    applyWorkerResponseToRun({ run: followUpRun, response: followUpResponse });
    caseSession.status = 'diagnosing';
    this.store.saveCase(caseSession);
    this.events.workerTrace(caseSession, followUpResponse.trace);
    review = await this.reviewer.reviewAndFormat(caseSession, followUpResponse.result, followUpRun);
    return review;
  }
}
