import type { SuperHelperConfig } from '../config.js';
import { getModelProvider } from '../config.js';
import type { DiagnosticRun, UserPersona } from '../domain.js';
import { createModelClient } from '../providers/model/adapter.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import type { DiagnosticWorker } from '../workers/diagnostic-worker.js';
import { resolveAgentConfig } from './agent-configs.js';
import { CaseCurationService } from './case-curation-service.js';
import type { RuntimeTurnResponse, AcceptedUserTurn } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { ExperienceTurnService } from './experience-turn.js';
import { KnowledgeTurnService } from './knowledge-turn.js';
import { PreflightService } from './preflight-service.js';
import { formatPreflightQuestion } from './presenter.js';
import { RagAnswerabilityService } from './rag-answerability-service.js';
import { ReviewPresentationService } from './review-presentation.js';
import { SessionLifecycle } from './session-lifecycle.js';
import { CaseTurnQueue } from './turn-queue.js';
import { bindTurnContextCutoff, clearTurnContextCutoff } from '../sessions/turn-context-snapshot.js';
import { WorkerDiagnosisService } from './worker-diagnosis.js';
import { McpEvidenceService, type McpEvidenceServiceOptions } from '../mcp/evidence-service.js';
import { findRetryableInterruption, markInheritedActiveTurnsRetryable, removeInterruptionPlaceholder } from '../sessions/stale-turn.js';
import { completePresentedTurn } from './turn-completion.js';

export interface AgentResponse extends RuntimeTurnResponse {}
export interface DiagnosticRuntimeOptions { mcp?: McpEvidenceServiceOptions }

export class DiagnosticRuntime {
  private readonly events: CaseRuntimeEventRecorder;
  private readonly turnQueue = new CaseTurnQueue();
  private readonly sessions: SessionLifecycle;
  private readonly preflight: PreflightService;
  private readonly experienceTurn: ExperienceTurnService;
  private readonly knowledgeTurn: KnowledgeTurnService;
  private readonly workerDiagnosis: WorkerDiagnosisService;
  private readonly reviewer: ReviewPresentationService;
  private readonly caseCuration: CaseCurationService;
  private readonly mcpEvidence: McpEvidenceService;

  constructor(
    config: SuperHelperConfig,
    private readonly store: CaseRepository,
    worker: DiagnosticWorker,
    options: DiagnosticRuntimeOptions = {},
  ) {
    const model = createModelClient(getModelProvider(config));
    const mainAgentSpec = resolveAgentConfig('main').content;
    const inputReviewAgentSpec = resolveAgentConfig('preflight').content;
    const experienceAgentSpec = resolveAgentConfig('experience').content;
    const outputReviewAgentSpec = resolveAgentConfig('output_review').content;
    const presentationAgentSpec = resolveAgentConfig('presentation').content;
    const ragAnswerabilityAgentSpec = resolveAgentConfig('rag_answerability').content;

    this.events = new CaseRuntimeEventRecorder(store);
    this.reviewer = new ReviewPresentationService(
      config,
      model,
      this.events,
      mainAgentSpec,
      outputReviewAgentSpec,
      presentationAgentSpec,
    );
    this.sessions = new SessionLifecycle(config, store, this.events);
    this.preflight = new PreflightService(
      config,
      store,
      model,
      this.events,
      mainAgentSpec,
      inputReviewAgentSpec,
      experienceAgentSpec,
    );
    this.experienceTurn = new ExperienceTurnService(store, this.events, this.reviewer);
    const ragAnswerabilityService = new RagAnswerabilityService(
      model,
      ragAnswerabilityAgentSpec,
      config.agent.ragAnswerabilityTopN ?? config.agent.evidenceCoverageTopN ?? 3,
    );
    this.knowledgeTurn = new KnowledgeTurnService(config, store, this.events, this.reviewer, ragAnswerabilityService);
    this.workerDiagnosis = new WorkerDiagnosisService(store, worker, this.events, this.reviewer);
    this.caseCuration = new CaseCurationService(config, store, this.events);
    this.mcpEvidence = new McpEvidenceService(config, options.mcp);
  }

  async handleUserMessage(input: {
    caseId?: string;
    message: string;
    workspaceId?: string;
    persona?: UserPersona;
  }): Promise<AgentResponse> {
    const turn = this.startUserTurn(input);
    return this.completeUserTurn(turn.caseSession.id, turn.userMessageId);
  }

  loadCase(caseId: string): StoredCase | undefined {
    return this.sessions.loadCase(caseId);
  }

  startUserTurn(input: {
    caseId?: string;
    message: string;
    workspaceId?: string;
    persona?: UserPersona;
  }): AcceptedUserTurn {
    return this.sessions.startUserTurn(input);
  }

  async completeUserTurn(caseId: string, userMessageId: string): Promise<AgentResponse> {
    return this.turnQueue.run(caseId, () => this.completeUserTurnNow(caseId, userMessageId));
  }

  recordTurnFailure(caseId: string, error: unknown, replyToMessageId?: string): void {
    this.sessions.recordTurnFailure(caseId, error, replyToMessageId);
  }

  recoverInterruptedTurns(): void {
    const cases = this.store.listCases(Number.MAX_SAFE_INTEGER);
    for (const caseSession of cases) {
      markInheritedActiveTurnsRetryable(caseSession, this.store);
    }
  }

  retryInterruptedTurn(caseId: string, userMessageId: string): { accepted: boolean; caseId: string; userMessageId: string } {
    const caseSession = this.store.loadCase(caseId);
    if (!caseSession) {
      throw new RetryableTurnError('case not found', 404);
    }
    if (caseSession.archivedAt) {
      throw new RetryableTurnError('session is archived and cannot continue', 409);
    }

    const interruption = findRetryableInterruption(caseSession);
    if (!interruption) {
      throw new RetryableTurnError('turn is not retryable', 409);
    }
    if (interruption.userMessageId !== userMessageId) {
      throw new RetryableTurnError('turn is not retryable', 409);
    }

    const userMessage = caseSession.messages.find((m) => m.id === userMessageId && m.role === 'user');
    if (!userMessage) {
      throw new RetryableTurnError('user message not found', 404);
    }

    removeInterruptionPlaceholder(caseSession, interruption.placeholderMessageId);

    this.store.addLogEvent(caseSession, {
      actor: 'system',
      phase: 'turn_retry_started',
      label: '重试开始',
      severity: 'ok',
      summary: '用户点击一键重试，正在重新执行原回合。',
      detail: { userMessageId },
    });

    caseSession.status = 'ready_for_diagnosis';
    this.store.saveCase(caseSession);

    void this.completeUserTurn(caseId, userMessageId).catch((error) => {
      this.recordTurnFailure(caseId, error, userMessageId);
    });

    return { accepted: true, caseId, userMessageId };
  }

  private async completeUserTurnNow(caseId: string, userMessageId: string): Promise<AgentResponse> {
    const caseSession = this.sessions.requireActiveCase(caseId);
    const userMessage = this.sessions.userMessageBody(caseSession, userMessageId);
    const replyToMessageId = userMessageId;

    bindTurnContextCutoff(caseSession, userMessageId);
    try {
      return await this.runTurnPipeline(caseSession, userMessage, replyToMessageId);
    } finally {
      clearTurnContextCutoff(caseSession);
    }
  }

  private async runTurnPipeline(
    caseSession: StoredCase,
    userMessage: string,
    replyToMessageId: string,
  ): Promise<AgentResponse> {
    const curationResponse = this.caseCuration.answer(caseSession, userMessage, replyToMessageId);
    if (curationResponse) {
      return curationResponse;
    }

    const decision = await this.preflight.decide(caseSession, userMessage);
    if (decision.action === 'ask_user') {
      this.events.preflightAskUser(caseSession, decision);
      const reply = formatPreflightQuestion(decision.question, decision.missingInfo);
      this.store.addMessage(caseSession, { role: 'helper', body: reply, replyToMessageId });
      this.events.preflightReplyCreated(caseSession, reply);
      this.store.appendDailyMemory(`- ${new Date().toISOString()} ${caseSession.id} preflight ask: ${decision.missingInfo.join(', ')}`);
      caseSession.status = 'need_input';
      this.store.saveCase(caseSession);
      return { caseSession, assistantMessage: reply, decision: 'ask_user' };
    }

    const experienceResponse = await this.experienceTurn.answer(caseSession, decision.request, replyToMessageId);
    if (experienceResponse) {
      return experienceResponse;
    }

    const knowledgeResponse = await this.knowledgeTurn.answer(
      caseSession,
      decision.request.userGoal,
      replyToMessageId,
      decision.request,
    );
    if (knowledgeResponse) {
      return knowledgeResponse;
    }

    const mcpResult = await this.mcpEvidence.run(decision.request);
    if (decision.request.context?.mcp) {
      this.store.addLogEvent(caseSession, {
        actor: 'mcp',
        phase: 'mcp_evidence_completed',
        summary: `MCP evidence stage completed with ${decision.request.context.mcp.calls.length} bounded call(s).`,
        severity: decision.request.context.mcp.evidence.length > 0 ? 'ok' : 'warn',
        detail: {
          calls: decision.request.context.mcp.calls.map((call) => ({
            serverId: call.serverId,
            toolName: call.toolName,
            status: call.status,
            reason: call.reason,
            evidenceId: call.evidenceId,
          })),
        },
      });
    }
    if (mcpResult) {
      const run: DiagnosticRun = {
        id: decision.request.runId,
        caseId: caseSession.id,
        status: mcpResult.status,
        request: decision.request,
        result: mcpResult,
      };
      caseSession.status = 'diagnosing';
      this.store.addRun(caseSession, run);
      const review = await this.reviewer.reviewAndFormat(caseSession, mcpResult, run);
      return completePresentedTurn({
        store: this.store,
        events: this.events,
        caseSession,
        review,
        replyToMessageId,
      });
    }

    const review = await this.workerDiagnosis.diagnose(caseSession, decision.request);
    return completePresentedTurn({
      store: this.store,
      events: this.events,
      caseSession,
      review,
      replyToMessageId,
    });
  }
}

export class RetryableTurnError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'RetryableTurnError';
  }
}
