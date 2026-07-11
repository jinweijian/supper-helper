import type { DiagnosticLogEvent, DiagnosticRequest, DiagnosticResult, LogSeverity, WorkerTrace } from '../../domain.js';
import type { CaseRepository, StoredCase } from '../../sessions/case-repository.js';
import { sanitizeWorkerTrace } from '../../observability/worker-trace.js';

export interface AgentIdentity {
  agentId: string;
  agentRole: string;
  agentName: string;
}

export const agentIdentities = {
  main: { agentId: 'main', agentRole: 'main-coordinator', agentName: '主 Agent' },
  inputReview: { agentId: 'input-review', agentRole: 'input-review-and-preflight', agentName: '输入审核 Agent' },
  experience: { agentId: 'experience', agentRole: 'prior-session-experience-review', agentName: '经验 Agent' },
  knowledgeRouter: { agentId: 'knowledge-router', agentRole: 'knowledge-router', agentName: '知识路由 Agent' },
  evidenceJudge: { agentId: 'evidence-judge', agentRole: 'evidence-sufficiency-judge', agentName: '证据充分性 Agent' },
  ragAnswerability: { agentId: 'rag-answerability', agentRole: 'rag-answerability-and-extraction-judge', agentName: 'RAG 可回答性 Agent' },
  evidenceCoverage: { agentId: 'evidence-coverage', agentRole: 'evidence-coverage-judge', agentName: '证据覆盖 Agent' },
  caseCurator: { agentId: 'case-curator', agentRole: 'solved-case-curator', agentName: 'Case 沉淀 Agent' },
  outputReview: { agentId: 'output-review', agentRole: 'evidence-and-output-review', agentName: '输出审核 Agent' },
  presentation: { agentId: 'presentation', agentRole: 'persona-aware-presentation', agentName: '美化输出 Agent' },
} satisfies Record<string, AgentIdentity>;

export interface EventRecorderSink {
  record(caseSession: StoredCase, event: Omit<DiagnosticLogEvent, 'id' | 'createdAt'>): DiagnosticLogEvent;
  recordAgent(
    caseSession: StoredCase,
    agent: AgentIdentity,
    event: Omit<DiagnosticLogEvent, 'id' | 'createdAt' | 'agentId' | 'agentRole' | 'agentName'>,
  ): DiagnosticLogEvent;
}

export function createEventRecorderSink(cases: Pick<CaseRepository, 'addLogEvent'>): EventRecorderSink {
  const sink: EventRecorderSink = {
    record: (caseSession, event) => cases.addLogEvent(caseSession, event),
    recordAgent: (caseSession, agent, event) => sink.record(caseSession, { ...event, ...agent }),
  };
  return sink;
}

export function evidenceIdsFromResult(result: DiagnosticResult): string[] {
  return [...new Set([
    ...result.evidence.map((item) => item.id),
    ...result.claims.flatMap((claim) => claim.evidenceIds),
  ])];
}

export function evidenceIdsFromRequest(request: DiagnosticRequest): string[] {
  const knowledgeEvidence = request.context?.knowledge?.evidence?.map((item) => item.id) ?? [];
  const previousEvidence = request.context?.previousRuns?.flatMap((run) => run.evidence.map((item) => item.id)) ?? [];
  return [...new Set([...knowledgeEvidence, ...previousEvidence].filter(Boolean))];
}

export function diagnosticRequestLogDetail(
  request: DiagnosticRequest,
  dispatch: 'dispatch' | 'follow_up_dispatch' | 'code_escalation',
): Record<string, unknown> {
  return {
    dispatch,
    caseId: request.caseId,
    runId: request.runId,
    workspaceId: request.workspaceId,
    answerGoal: request.answerGoal,
    userGoal: request.userGoal,
    knownFacts: request.knownFacts,
    unknowns: request.unknowns,
    constraints: request.constraints,
    allowedMcpToolIds: request.allowedMcpToolIds,
    userPersona: request.userPersona,
    evidenceIds: evidenceIdsFromRequest(request),
  };
}

export function safeWorkerTrace(trace: WorkerTrace): ReturnType<typeof sanitizeWorkerTrace> {
  return sanitizeWorkerTrace(trace);
}

export function rawOutputSeverity(trace: WorkerTrace): LogSeverity {
  if (trace.error || trace.exitCode) return 'error';
  if (trace.stderr || /"subtype":"error_|error_max_budget_usd|timed out|already in use/i.test(trace.stdout)) return 'warn';
  return 'ok';
}
