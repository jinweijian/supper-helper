import type { DiagnosticLogEvent, DiagnosticRequest, DiagnosticResult, DiagnosticRun, WorkerTrace } from "../../domain.js";
import type { KnowledgeEvidencePack, KnowledgeRoute } from "../../knowledge/index.js";
import type { StoredCase } from "../../sessions/case-repository.js";
import type { PreflightDecision } from "../preflight-decision.js";
import type { EvidenceJudgeResult } from "../evidence-judge.js";
import type { RetrievalTrace } from "../../retrieval/types.js";
import type { ValidatedDiagnosticResult } from "../result-validator.js";
import type { RagAnswerabilityResult } from "../rag-answerability-service.js";
import { decisionFromDiagnosticResult } from "../review-gate.js";
import { agentIdentities, diagnosticRequestLogDetail, evidenceIdsFromResult, rawOutputSeverity, safeWorkerTrace, type EventRecorderSink } from "./base.js";

export interface ModelPreflightParsed { action?: 'ask_user' | 'dispatch'; reason?: string; missingInfo?: string[]; question?: string; }
export function createPreflightEvents(sink: EventRecorderSink) {
  return {
  inputReviewStarted(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'input_review_started',
      label: '输入审核',
      severity: 'ok',
      summary: '输入审核员开始整理用户输入',
      detail: {
        userPersona: caseSession.userPersona,
        message,
      },
    });
  },

  preflightStarted(
    caseSession: StoredCase,
    detail: { useModelForPreflight: boolean; modelProvider?: string },
  ): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'preflight_started',
      label: '预检',
      severity: 'ok',
      summary: 'Agent 开始执行 Preflight Gate',
      detail,
    });
  },

  localPreflightResult(caseSession: StoredCase, decision: PreflightDecision): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'local_preflight_result',
      label: '输入审核',
      severity: decision.action === 'dispatch' ? 'ok' : 'warn',
      summary: '本地规则预检完成',
      detail: decision,
    });
  },

  modelPreflightFailed(caseSession: StoredCase, error: string): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'model_preflight_failed',
      label: '预检',
      severity: 'warn',
      summary: 'Agent 模型预检失败，降级到本地规则预检',
      detail: { error },
    });
  },

  modelPreflightResult(caseSession: StoredCase, _raw: string, parsed: ModelPreflightParsed): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'model_preflight_result',
      label: '输入审核',
      severity: parsed.action === 'dispatch' ? 'ok' : 'warn',
      summary: 'Agent 模型完成预检判断',
      detail: {
        action: parsed.action,
        missingInfoCount: Array.isArray(parsed.missingInfo) ? parsed.missingInfo.length : 0,
      },
    });
  },

  answerGoalItemsReconciled(
    caseSession: StoredCase,
    detail: { source: 'model' | 'fallback'; count: number; fallbackReason?: string },
  ): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'answer_goal_items_reconciled',
      label: '答案目标',
      severity: detail.source === 'model' ? 'ok' : 'warn',
      summary: '答案目标子项已完成结构化校验',
      detail,
    });
  },

  modelPreflightOverriddenByLocalDispatch(
    caseSession: StoredCase,
    modelDecision: PreflightDecision,
    localDecision: PreflightDecision,
  ): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'model_preflight_overridden_by_local_dispatch',
      label: '输入审核',
      severity: 'ok',
      summary: '模型预检提出泛化追问，但当前 workspace 已足够先做只读诊断',
      detail: {
        modelAction: modelDecision.action,
        localAction: localDecision.action,
        reason: 'selected_workspace_allows_bounded_read_only_dispatch',
      },
    });
  },

  preflightAskUser(caseSession: StoredCase, decision: PreflightDecision): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'preflight_decision',
      label: '预检',
      severity: 'warn',
      summary: 'Preflight Gate 决定先追问用户',
      detail: decision,
    });
  },

  preflightDispatch(caseSession: StoredCase, request: DiagnosticRequest): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'preflight_decision',
      label: '预检',
      severity: 'ok',
      summary: 'Preflight Gate 决定派发 Claude Code 诊断',
      detail: diagnosticRequestLogDetail(request, 'dispatch'),
    });
  },

  preflightKnowledgeAnswer(caseSession: StoredCase, result: DiagnosticResult): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'preflight_decision',
      label: '预检',
      severity: 'ok',
      summary: 'Preflight Gate 决定使用知识库证据直接回答',
      detail: {
        decision: 'knowledge_answer',
        status: result.status,
        summary: result.summary,
        recommendedNextAction: result.recommendedNextAction,
        evidenceIds: evidenceIdsFromResult(result),
      },
    });
  },

  diagnosticRequestCreated(
    caseSession: StoredCase,
    request: DiagnosticRequest,
    options: { followUp?: boolean } = {},
  ): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.main, {
      actor: 'agent',
      phase: 'diagnostic_request',
      label: '调用 CC',
      severity: 'ok',
      summary: options.followUp ? 'Agent 生成追查 DiagnosticRequest' : 'Agent 生成 DiagnosticRequest',
      detail: diagnosticRequestLogDetail(request, options.followUp ? 'follow_up_dispatch' : 'dispatch'),
    });
  },

  };
}

export type PreflightEvents = ReturnType<typeof createPreflightEvents>;
