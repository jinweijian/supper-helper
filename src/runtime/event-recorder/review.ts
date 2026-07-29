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

export interface ModelReviewParsed { accepted: boolean; answerTarget?: string; claimIds: string[]; evidenceIds: string[]; directAnswerClaimIds: string[]; }
export function createReviewEvents(sink: EventRecorderSink) {
  return {
  followUpDiagnosticRequested(
    caseSession: StoredCase,
    run: DiagnosticRun,
    result: DiagnosticResult,
  ): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.outputReview, {
      actor: 'agent',
      phase: 'follow_up_diagnostic_requested',
      label: '输出审核',
      severity: 'warn',
      summary: 'Agent 审核认为证据仍不足，自动追查一轮 Claude Code',
      detail: {
        previousRunId: run.id,
        reason: result.summary,
      },
    });
  },

  evidenceReviewStarted(caseSession: StoredCase, run: DiagnosticRun, result: DiagnosticResult): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.outputReview, {
      actor: 'agent',
      phase: 'evidence_review_started',
      label: '输出审核',
      severity: 'ok',
      summary: 'Agent 开始审核 Claude Code 返回结果',
      detail: {
        runId: run.id,
        status: result.status,
        summary: result.summary,
        missingInfo: result.missingInfo,
        recommendedNextAction: result.recommendedNextAction,
        evidenceIds: evidenceIdsFromResult(result),
        claimCount: result.claims.length,
        evidenceCount: result.evidence.length,
      },
    });
  },

  modelReviewFailed(caseSession: StoredCase, error: string): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.outputReview, {
      actor: 'agent',
      phase: 'model_review_failed',
      label: '输出审核',
      severity: 'warn',
      summary: 'Agent 模型审核失败，降级到本地审核规则',
      detail: { error },
    });
  },

  modelReviewResult(caseSession: StoredCase, parsed: ModelReviewParsed): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.outputReview, {
      actor: 'agent',
      phase: 'model_review_result',
      label: '输出审核',
      severity: parsed.accepted ? 'ok' : 'warn',
      summary: parsed.accepted
        ? 'Presentation 模型回复草案通过确定性校验'
        : 'Presentation 模型回复草案未通过确定性校验，降级到本地格式化',
      detail: { parsed },
    });
  },

  evidenceValidationResult(
    caseSession: StoredCase,
    runId: string,
    validation: ValidatedDiagnosticResult,
  ): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.outputReview, {
      actor: 'agent',
      phase: 'evidence_validation_result',
      label: '确定性审核',
      severity: validation.issues.length > 0 ? 'warn' : 'ok',
      summary: `确定性审核冻结结果：接受 ${validation.acceptedClaimIds.length} 条，拒绝 ${validation.rejectedClaimIds.length} 条`,
      detail: {
        runId,
        frozenDecision: decisionFromDiagnosticResult(validation.result),
        issues: validation.issues,
        acceptedClaimIds: validation.acceptedClaimIds,
        rejectedClaimIds: validation.rejectedClaimIds,
        acceptedPrimaryAnswerClaimIds: validation.acceptedPrimaryAnswerClaimIds,
        globalBlockerCodes: validation.globalBlockers.map((item) => item.code),
        outcomeReasonCode: validation.outcomeReasonCode,
      },
    });
  },

  presentationPrepared(caseSession: StoredCase, decision: string): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.presentation, {
      actor: 'agent',
      phase: 'presentation_agent_result',
      label: '美观输出',
      severity: 'ok',
      summary: '美观输出 agent 完成最终回复整理',
      detail: {
        userPersona: caseSession.userPersona,
        decision,
      },
    });
  },

  };
}

export type ReviewEvents = ReturnType<typeof createReviewEvents>;
