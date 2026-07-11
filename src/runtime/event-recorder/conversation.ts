import type { DiagnosticLogEvent, DiagnosticRequest, DiagnosticResult, DiagnosticRun, WorkerTrace } from "../../domain.js";
import type { KnowledgeEvidencePack, KnowledgeRoute } from "../../knowledge/index.js";
import type { StoredCase } from "../../sessions/case-repository.js";
import type { PreflightDecision } from "../preflight-decision.js";
import type { EvidenceJudgeResult } from "../evidence-judge.js";
import type { RetrievalTrace } from "../../retrieval/types.js";
import type { ValidatedDiagnosticResult } from "../result-validator.js";
import type { RagAnswerabilityResult } from "../rag-answerability-service.js";
import { redactSecretText } from "../../redaction.js";
import { decisionFromDiagnosticResult } from "../review-gate.js";
import { agentIdentities, diagnosticRequestLogDetail, evidenceIdsFromResult, rawOutputSeverity, safeWorkerTrace, type EventRecorderSink } from "./base.js";

export function createConversationEvents(sink: EventRecorderSink) {
  return {
  conversationStarted(caseSession: StoredCase): DiagnosticLogEvent {
    return sink.record(caseSession, {
      actor: 'system',
      phase: 'conversation_started',
      label: '开始对话',
      severity: 'ok',
      summary: '创建或初始化当前会话',
      detail: {
        caseId: caseSession.id,
        claudeSessionId: caseSession.claudeSessionId,
        userPersona: caseSession.userPersona,
      },
    });
  },

  inputReceived(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.main, {
      actor: 'agent',
      phase: 'input_received',
      label: '输入',
      severity: 'ok',
      summary: 'Agent 收到用户输入',
      detail: { message, tag: '问的问题' },
    });
  },

  personaApplied(caseSession: StoredCase, personaLabel: string, guide: Record<string, string>): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.main, {
      actor: 'agent',
      phase: 'persona_agent_result',
      label: '用户视角',
      severity: 'ok',
      summary: `${personaLabel}视角已应用`,
      detail: guide,
    });
  },

  preflightReplyCreated(caseSession: StoredCase, reply: string): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.presentation, {
      actor: 'agent',
      phase: 'user_reply',
      label: '最终输出',
      severity: 'warn',
      summary: 'Agent 向用户发起追问',
      detail: { reply, tag: '最终回答' },
    });
  },

  finalReplyCreated(caseSession: StoredCase, reply: string, decision: string): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.presentation, {
      actor: 'agent',
      phase: 'user_reply',
      label: '最终输出',
      severity: decision === 'final' ? 'ok' : 'warn',
      summary: 'Agent 完成证据审核并回复用户',
      detail: { reply, decision, evidenceIds: [], tag: '最终回答' },
    });
  },

  turnFailed(caseSession: StoredCase, error: string): DiagnosticLogEvent {
    return sink.record(caseSession, {
      actor: 'system',
      phase: 'turn_failed',
      label: '系统',
      severity: 'error',
      summary: '本轮处理异常中断',
      detail: { error },
    });
  },

  experienceStarted(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.experience, {
      actor: 'agent',
      phase: 'experience_started',
      label: '经验',
      severity: 'ok',
      summary: '经验 Agent 开始检查历史会话是否可复用',
      detail: { message },
    });
  },

  experienceMiss(caseSession: StoredCase): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.experience, {
      actor: 'agent',
      phase: 'experience_miss',
      label: '经验',
      severity: 'info',
      summary: '经验 Agent 未找到可安全复用的历史答案',
    });
  },

  experienceCandidatesRejected(
    caseSession: StoredCase,
    candidates: Array<{
      sourceCaseId: string;
      sourceMessageId: string;
      sourceReplyId?: string;
      sourceRunId?: string;
      score: number;
      rejectionReason: string;
    }>,
  ): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.experience, {
      actor: 'agent',
      phase: 'experience_candidates_rejected',
      label: '经验',
      severity: 'warn',
      summary: `经验 Agent 记录 ${candidates.length} 个未通过当前复核的候选，继续本轮诊断`,
      detail: { candidates },
    });
  },

  experienceHit(
    caseSession: StoredCase,
    detail: { sourceCaseId: string; sourceMessageId: string; sourceReplyId: string; sourceRunId: string; score: number },
  ): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.experience, {
      actor: 'agent',
      phase: 'experience_hit',
      label: '经验',
      severity: 'ok',
      summary: '经验 Agent 找到可复用历史答案，将交给输出审核',
      detail,
    });
  },

  };
}

export type ConversationEvents = ReturnType<typeof createConversationEvents>;
