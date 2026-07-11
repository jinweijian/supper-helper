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

export function createKnowledgeEvents(sink: EventRecorderSink) {
  return {
  knowledgeRouterStarted(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.knowledgeRouter, {
      actor: 'agent',
      phase: 'knowledge_router_started',
      label: '知识路由',
      severity: 'ok',
      summary: '知识路由 Agent 开始归一化问题',
      detail: { message },
    });
  },

  knowledgeRouterResult(caseSession: StoredCase, route: KnowledgeRoute): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.knowledgeRouter, {
      actor: 'agent',
      phase: 'knowledge_router_result',
      label: '知识路由',
      severity: 'ok',
      summary: '知识路由 Agent 完成模块、意图和关键词识别',
      detail: route,
    });
  },

  knowledgeSearchStarted(caseSession: StoredCase, detail: unknown): DiagnosticLogEvent {
    return sink.record(caseSession, {
      actor: 'system',
      phase: 'knowledge_search_started',
      label: '知识检索',
      severity: 'ok',
      summary: '知识搜索服务开始检索企业知识库',
      detail,
    });
  },

  knowledgeSearchResult(caseSession: StoredCase, evidencePack: KnowledgeEvidencePack): DiagnosticLogEvent {
    return sink.record(caseSession, {
      actor: 'system',
      phase: 'knowledge_search_result',
      label: '知识检索',
      severity: evidencePack.results.length ? 'ok' : 'warn',
      summary: `知识搜索完成，命中 ${evidencePack.results.length} 条证据`,
      detail: evidencePack,
    });
  },

  knowledgeRetrievalTrace(caseSession: StoredCase, trace: RetrievalTrace): DiagnosticLogEvent {
    return sink.record(caseSession, {
      actor: 'system',
      phase: 'knowledge_retrieval_trace',
      label: '检索轨迹',
      severity: trace.strategies.some((strategy) => strategy.status === 'failed') ? 'warn' : 'ok',
      summary: `检索策略 ${trace.strategies.length} 个，最终候选 ${trace.fusion.finalCandidateCount} 条`,
      detail: trace,
    });
  },

  evidenceJudgeStarted(caseSession: StoredCase, evidencePack: KnowledgeEvidencePack): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'evidence_judge_started',
      label: '证据判断',
      severity: 'ok',
      summary: '证据充分性 Agent 开始判断知识证据是否足够',
      detail: {
        resultCount: evidencePack.results.length,
      },
    });
  },

  evidenceJudgeResult(caseSession: StoredCase, judge: EvidenceJudgeResult): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'evidence_judge_result',
      label: '证据判断',
      severity: judge.answerable ? 'ok' : 'warn',
      summary: judge.answerable ? '知识证据足够，可进入输出审核' : '知识证据不足，需要升级查询',
      detail: JSON.parse(JSON.stringify(judge)) as unknown,
    });
  },

  evidenceCoverageStarted(caseSession: StoredCase, input: { question: string; evidenceIds: string[] }): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.evidenceCoverage, {
      actor: 'agent',
      phase: 'evidence_coverage_started',
      label: '证据覆盖',
      severity: 'ok',
      summary: '证据覆盖 Agent 开始判断证据是否覆盖原问题',
      detail: {
        question: input.question,
        evidenceIds: input.evidenceIds,
      },
    });
  },

  evidenceCoverageResult(caseSession: StoredCase, coverage: { coverage: string; missingElements: string[]; reason: string }): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.evidenceCoverage, {
      actor: 'agent',
      phase: 'evidence_coverage_result',
      label: '证据覆盖',
      severity: coverage.coverage === 'covered' ? 'ok' : 'warn',
      summary: coverage.coverage === 'covered'
        ? '证据覆盖原问题答案要素，维持直答'
        : coverage.coverage === 'unknown'
          ? '证据覆盖判断失败，降级回 Evidence Judge 结论'
          : '证据未覆盖原问题答案要素，拒绝直答',
      detail: coverage,
    });
  },

  ragAnswerabilityStarted(caseSession: StoredCase, input: { answerObject?: string; evidenceIds: string[] }): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.ragAnswerability, {
      actor: 'agent',
      phase: 'rag_answerability_started',
      label: 'RAG 可回答性',
      severity: 'ok',
      summary: 'RAG 可回答性 Agent 开始判断知识证据是否满足 AnswerGoal',
      detail: {
        answerObject: input.answerObject,
        evidenceIds: input.evidenceIds,
      },
    });
  },

  ragAnswerabilityResult(caseSession: StoredCase, result: RagAnswerabilityResult): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.ragAnswerability, {
      actor: 'agent',
      phase: 'rag_answerability_result',
      label: 'RAG 可回答性',
      severity: result.answerability === 'full' ? 'ok' : 'warn',
      summary: result.answerability === 'full'
        ? 'RAG 证据覆盖当前 AnswerGoal'
        : result.answerability === 'partial'
          ? 'RAG 证据只覆盖部分答案，需要继续升级'
          : 'RAG 证据不足以回答当前问题',
      detail: JSON.parse(JSON.stringify(result)) as unknown,
    });
  },

  knowledgeAnswerSelected(caseSession: StoredCase, result: DiagnosticResult): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'knowledge_answer_selected',
      label: '知识直答',
      severity: 'ok',
      summary: 'Evidence Judge 选择使用知识库证据直接回答',
      detail: {
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

  codeEscalationRequested(caseSession: StoredCase, request: DiagnosticRequest): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'code_escalation_requested',
      label: '升级代码',
      severity: 'warn',
      summary: '知识证据不足，升级到 Claude Code 只读静态调查',
      detail: request.context?.deepQuery,
    });
  },

  deepQueryRetryRequested(caseSession: StoredCase, detail: {
    attempt: number;
    maxAttempts: number;
    previousArtifactTargets: string[];
    nextArtifactTargets: string[];
    failedReasons: string[];
    correctionActions?: string[];
    stopReason?: string;
  }): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'deep_query_retry_requested',
      label: 'Deep Query 重试',
      severity: 'warn',
      summary: `Deep Query 触发第 ${detail.attempt} 次重试`,
      detail,
    });
  },

  deepQueryPivotSelected(caseSession: StoredCase, detail: {
    attempt: number;
    previousArtifactTargets: string[];
    nextArtifactTargets: string[];
    correctionActions: string[];
  }): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'deep_query_pivot_selected',
      label: 'Deep Query Pivot',
      severity: 'info',
      summary: 'Deep Query 选择新的 pivot 目标',
      detail,
    });
  },

  deepQueryStopped(caseSession: StoredCase, detail: {
    reason: string;
    attempt: number;
    maxAttempts?: number;
    previousArtifactTargets?: string[];
    nextArtifactTargets?: string[];
    failedReasons?: string[];
    correctionActions?: string[];
  }): DiagnosticLogEvent {
    return sink.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'deep_query_stopped',
      label: 'Deep Query 停止',
      severity: 'info',
      summary: `Deep Query 停止: ${detail.reason}`,
      detail,
    });
  },

  };
}

export type KnowledgeEvents = ReturnType<typeof createKnowledgeEvents>;
