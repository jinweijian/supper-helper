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

export function createWorkerEvents(sink: EventRecorderSink) {
  return {
  workerTrace(caseSession: StoredCase, trace: WorkerTrace): void {
    const safeTrace = safeWorkerTrace(trace);
    sink.record(caseSession, {
      actor: 'claude',
      phase: 'command',
      label: '调用 CC',
      severity: safeTrace.error ? 'error' : 'ok',
      summary: '实际调用 Claude Code 的命令',
      detail: {
        command: safeTrace.command,
        cwd: safeTrace.cwd,
        startedAt: safeTrace.startedAt,
        finishedAt: safeTrace.finishedAt,
      },
    });
    sink.record(caseSession, {
      actor: 'claude',
      phase: 'raw_output',
      label: '调用 CC',
      severity: rawOutputSeverity(safeTrace),
      summary: 'Claude Code 返回的原始数据',
      detail: {
        stdout: safeTrace.stdout,
        stderr: safeTrace.stderr,
        exitCode: safeTrace.exitCode,
        signal: safeTrace.signal,
        error: safeTrace.error,
      },
    });
  },
  };
}

export type WorkerEvents = ReturnType<typeof createWorkerEvents>;
