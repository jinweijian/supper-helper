import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticRequest, DiagnosticRun } from '../domain.js';
import {
  readActiveKnowledgeGeneration,
  readKnowledgeChunks,
  resolveKnowledgeWorkspaceRoot,
} from '../knowledge/index.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import type { RuntimeTurnResponse } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { RagAnswerabilityService, type RagAnswerabilityResult } from './rag-answerability-service.js';
import {
  attachKnowledgeCodeEscalationContext,
  diagnosticResultFromKnowledge,
  prepareKnowledgeDiagnosis,
} from './knowledge-diagnosis.js';
import type { EvidenceJudgeBlocker } from './evidence-judge.js';
import { ReviewPresentationService } from './review-presentation.js';
import { completePresentedTurn } from './turn-completion.js';

export class KnowledgeTurnService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly store: CaseRepository,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly reviewer: ReviewPresentationService,
    private readonly ragAnswerabilityService?: RagAnswerabilityService,
  ) {}

  async answer(
    caseSession: StoredCase,
    userMessage: string,
    replyToMessageId: string | undefined,
    request: DiagnosticRequest,
  ): Promise<RuntimeTurnResponse | undefined> {
    const workspaceRoot = resolveKnowledgeWorkspaceRoot(this.config, caseSession.workspaceId);
    this.events.knowledgeRouterStarted(caseSession, userMessage);
    const diagnosis = await prepareKnowledgeDiagnosis({
      config: this.config,
      workspaceRoot,
      question: userMessage,
      persona: caseSession.userPersona,
    });
    if (!diagnosis) {
      return undefined;
    }

    const { route, evidencePack, judge, retrievalTrace, glossaryTerms } = diagnosis;
    this.events.knowledgeRouterResult(caseSession, route);
    this.events.knowledgeSearchStarted(caseSession, {
      workspaceRoot,
      query: userMessage,
      moduleCandidates: route.moduleCandidates,
      intentCandidates: route.intentCandidates,
      sourceTypes: route.sourceTypes,
    });
    this.events.knowledgeSearchResult(caseSession, evidencePack);
    this.events.knowledgeRetrievalTrace(caseSession, retrievalTrace);
    this.events.evidenceJudgeStarted(caseSession, evidencePack);
    this.events.evidenceJudgeResult(caseSession, judge);

    let answerability: RagAnswerabilityResult | undefined;
    const answerGoal = request.answerGoal;
    if (
      this.ragAnswerabilityService &&
      this.config.agent.useModelForRagAnswerability !== false &&
      this.config.agent.modelProvider &&
      answerGoal &&
      evidencePack.results[0]
    ) {
      this.events.ragAnswerabilityStarted(caseSession, {
        answerObject: answerGoal.answerObject,
        evidenceIds: evidencePack.results.slice(0, 3).map((item) => item.evidence_id),
      });
      answerability = await this.ragAnswerabilityService.evaluate({
        answerGoal,
        evidence: evidencePack.results,
      });
      this.events.ragAnswerabilityResult(caseSession, answerability);
    }

    const ragBlocksDirectAnswer = Boolean(
      answerability && answerability.answerability !== 'full'
    );
    const questionNotAnsweredBlocker: EvidenceJudgeBlocker = 'question_not_answered';
    const finalJudge = {
      ...judge,
      answerable: judge.answerable && !ragBlocksDirectAnswer,
      need_code_escalation: judge.need_code_escalation || ragBlocksDirectAnswer,
      confidence: ragBlocksDirectAnswer ? 'low' as const : judge.confidence,
      reason: ragBlocksDirectAnswer ? answerability?.reason || judge.reason : judge.reason,
      blockers: ragBlocksDirectAnswer
        ? Array.from(new Set([...judge.blockers, questionNotAnsweredBlocker]))
        : judge.blockers,
      ambiguity: ragBlocksDirectAnswer
        ? Array.from(new Set([
          ...judge.ambiguity,
          `RAG Answerability 缺失答案要素：${answerability?.missingElements.join('、') || '关键要素缺失'}`,
        ]))
        : judge.ambiguity,
      recommended_next_action: ragBlocksDirectAnswer ? 'dispatch_code_diagnosis' : judge.recommended_next_action,
    };

    if (!finalJudge.answerable || finalJudge.need_code_escalation) {
      attachKnowledgeCodeEscalationContext({
        request,
        question: userMessage,
        route,
        evidencePack,
        judge: finalJudge,
        answerability,
        projectType: this.config.knowledge.projectType,
        glossaryTerms,
      });
      this.events.codeEscalationRequested(caseSession, request);
      return undefined;
    }

    const result = diagnosticResultFromKnowledge({
      evidencePack,
      judge: finalJudge,
      route,
      answerability,
      answerGoal,
    });
    const run: DiagnosticRun = {
      id: request.runId,
      caseId: caseSession.id,
      status: 'running',
      request,
      result,
    };
    caseSession.status = 'diagnosing';
    this.store.addRun(caseSession, run);
    this.events.preflightKnowledgeAnswer(caseSession, result);
    this.events.knowledgeAnswerSelected(caseSession, result);
    const activeGeneration = readActiveKnowledgeGeneration(workspaceRoot);
    const requestGenerationId = diagnosis.retrievalTrace.generationId;
    const chunksById = new Map(readKnowledgeChunks(workspaceRoot, requestGenerationId).chunks
      .map((chunk) => [chunk.chunk_id, chunk]));
    const coverageEvidenceEnvelopes = evidencePack.results.flatMap((item) => {
      const chunk = item.chunk_id ? chunksById.get(item.chunk_id) : undefined;
      const safeText = item.answer_span ?? item.excerpt;
      if (
        !chunk ||
        chunk.legacy ||
        chunk.artifact_version !== 4 ||
        chunk.chunking_strategy !== 'parent-child-v4' ||
        chunk.undersized_unmergeable ||
        chunk.manual_split_required ||
        !activeGeneration ||
        !requestGenerationId ||
        activeGeneration.generation_id !== requestGenerationId ||
        !safeText
      ) {
        return [];
      }
      return [{
        evidenceId: item.evidence_id,
        kind: 'knowledge' as const,
        safeText,
        freshness: 'current_knowledge_v4' as const,
        validated: true,
        generationId: requestGenerationId,
        currentGenerationId: activeGeneration.generation_id,
        strictEligible: item.status === 'active' && item.quality?.severity === 'ok' && !(item.grounding_issues?.length),
      }];
    });
    const review = await this.reviewer.reviewAndFormat(caseSession, result, run, {
      coverageEvidenceEnvelopes,
    });
    return completePresentedTurn({
      store: this.store,
      events: this.events,
      caseSession,
      review,
      replyToMessageId,
    });
  }
}
