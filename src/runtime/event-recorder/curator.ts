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

export function createCuratorEvents(sink: EventRecorderSink) {
  return {
  caseReviewStarted(caseSession: StoredCase, detail: {
    documentId: string;
    action: string;
    reviewer: string;
  }): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.caseCurator, {
      actor: 'agent',
      phase: 'case_review_started',
      label: 'Case 审核',
      severity: 'info',
      summary: `审核 ${detail.documentId} (${detail.action})`,
      detail,
    });
  },

  caseReviewResult(caseSession: StoredCase, detail: {
    documentId: string;
    action: string;
    reviewer: string;
    nextStatus: string;
    targetPath?: string;
  }): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.caseCurator, {
      actor: 'agent',
      phase: 'case_review_result',
      label: 'Case 审核结果',
      severity: 'ok',
      summary: `${detail.documentId} 审核完成: ${detail.nextStatus}`,
      detail,
    });
  },

  caseReviewFailed(caseSession: StoredCase, detail: {
    documentId: string;
    reason: string;
  }): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.caseCurator, {
      actor: 'agent',
      phase: 'case_review_failed',
      label: 'Case 审核失败',
      severity: 'error',
      summary: `${detail.documentId} 审核失败: ${detail.reason}`,
      detail,
    });
  },

  caseResolutionConfirmed(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.caseCurator, {
      actor: 'agent',
      phase: 'resolution_confirmed',
      label: 'Case 沉淀',
      severity: 'ok',
      summary: '用户确认问题已解决，准备沉淀 solved case',
      detail: { message },
    });
  },

  caseCuratorStarted(caseSession: StoredCase): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.caseCurator, {
      actor: 'agent',
      phase: 'case_curator_started',
      label: 'Case 沉淀',
      severity: 'ok',
      summary: 'Case Curator 开始生成 solved case 草稿',
    });
  },

  caseCuratorResult(
    caseSession: StoredCase,
    detail: { documentId: string; path: string; moduleId: string; status: string; confidence: string },
  ): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.caseCurator, {
      actor: 'agent',
      phase: 'case_curator_result',
      label: 'Case 沉淀',
      severity: 'ok',
      summary: 'Case Curator 已保存 review_required solved case 草稿并标记索引脏',
      detail,
    });
  },

  };
}

export type CuratorEvents = ReturnType<typeof createCuratorEvents>;
