import type { SuperHelperConfig } from '../config.js';
import type { CaseSession, DiagnosticRequest, DiagnosticResult, ResolvedTurnContext, UserPersona } from '../domain.js';
import { buildDiagnosticRequestContext } from '../sessions/context-builder.js';
import type { StoredCase } from '../sessions/case-repository.js';
import { turnMessages } from '../sessions/turn-context-snapshot.js';
import { buildAnswerGoal, followUpAnswerGoal } from './answer-goal.js';
import { buildResolvedTurnContext } from './resolved-turn.js';

export const ANSWER_GOAL_CONSTRAINT = 'Use DiagnosticRequest.answerGoal as the authoritative user-visible answer goal; answer its mustAnswerItems first and mark missing items as unknown.';

export function buildDiagnosticRequest(input: {
  caseSession: StoredCase;
  userMessage: string;
  unknowns: string[];
  config: SuperHelperConfig;
}): DiagnosticRequest {
  const { caseSession, userMessage, unknowns, config } = input;
  const resolvedTurn = buildResolvedTurnContext({ caseSession, latestUserMessage: userMessage });
  const request = buildDiagnosticRequestFromResolvedTurn({
    caseSession,
    rawUserQuestion: userMessage,
    resolvedTurn,
    unknowns,
    allowedMcpToolIds: config.workspaces.find((workspace) => workspace.id === caseSession.workspaceId)?.mcpToolIds ?? [],
    includePersonaConstraints: true,
  });
  attachCaseContext(caseSession, request);
  request.context!.resolvedTurn = resolvedTurn;
  return request;
}

export function buildDiagnosticRequestFromResolvedTurn(input: {
  caseSession: CaseSession;
  rawUserQuestion: string;
  resolvedTurn: ResolvedTurnContext;
  unknowns: string[];
  allowedMcpToolIds: string[];
  includePersonaConstraints?: boolean;
}): DiagnosticRequest {
  const { caseSession, rawUserQuestion, resolvedTurn } = input;
  const answerGoal = buildAnswerGoal({ rawUserQuestion, resolvedTurn });
  const latestRunNumber = caseSession.runs.length + 1;
  const knownFacts = resolvedTurn.confirmedFacts.map((fact) => fact.text);
  const constraints = [
    'Claude Code is an inspection tool and must not respond directly to the user.',
    ...(input.includePersonaConstraints ? personaDiagnosticConstraints(caseSession.userPersona) : []),
    'Handle both troubleshooting requests and general project questions.',
    'Return structured evidence, assumptions, missing information, and recommended next action.',
    'Do not make final claims without evidence.',
    ANSWER_GOAL_CONSTRAINT,
  ];

  return {
    caseId: caseSession.id,
    runId: `run_${String(latestRunNumber).padStart(2, '0')}`,
    workspaceId: caseSession.workspaceId,
    claudeSessionId: caseSession.claudeSessionId,
    answerGoal,
    userGoal: resolvedTurn.resolvedQuery,
    knownFacts,
    unknowns: Array.from(new Set([...input.unknowns, ...resolvedTurn.unknowns.map((item) => item.text)])),
    constraints,
    allowedMcpToolIds: input.allowedMcpToolIds,
    userPersona: caseSession.userPersona,
    context: {
      isFollowUp: resolvedTurn.isFollowUp,
      currentUserMessage: resolvedTurn.latestUserMessage,
      recentMessages: turnMessages(caseSession).slice(-8).map((message) => ({
        id: message.id,
        role: message.role,
        body: message.body,
        createdAt: message.createdAt,
      })),
      previousRuns: [],
      resolvedTurn,
    },
  };
}

export function buildFollowUpDiagnosticRequest(input: {
  caseSession: StoredCase;
  previousRequest: DiagnosticRequest;
  previousResult: DiagnosticResult;
}): DiagnosticRequest {
  const { caseSession, previousRequest, previousResult } = input;
  const latestRunNumber = caseSession.runs.length + 1;
  const evidenceSummaries = previousResult.evidence.map((item) => `${item.id}: ${item.summary} (${item.source})`);
  const claimSummaries = previousResult.claims.map((claim) => `${claim.type}: ${claim.text}`);

  const request: DiagnosticRequest = {
    ...previousRequest,
    runId: `run_${String(latestRunNumber).padStart(2, '0')}`,
    answerGoal: followUpAnswerGoal({
      previous: previousRequest.answerGoal,
      diagnosticObjective: `继续追查上一轮未完成的问题：${previousRequest.answerGoal.diagnosticObjective}`,
    }),
    userGoal: previousRequest.answerGoal.resolvedQuestion,
    knownFacts: Array.from(new Set([...previousRequest.knownFacts, previousResult.summary, ...evidenceSummaries, ...claimSummaries])),
    unknowns: previousResult.missingInfo,
    constraints: [
      ...previousRequest.constraints,
      ...personaDiagnosticConstraints(caseSession.userPersona),
      'This is a follow-up run in the same Claude session; reuse earlier context and focus only on the missing evidence.',
      ANSWER_GOAL_CONSTRAINT,
    ],
    userPersona: caseSession.userPersona,
  };
  attachCaseContext(caseSession, request);
  return request;
}

export function personaDiagnosticConstraints(persona: UserPersona): string[] {
  const shared = `User-facing persona is ${persona}; return evidence for super helper Agent to translate.`;
  const personaSpecific: Record<UserPersona, string> = {
    operations: '运营视角：优先判断这是系统 bug、设计使然、配置或使用问题；优先提取功能名、页面入口、角色、期望行为和业务影响，不要要求用户提供代码路径。',
    developer: '开发视角：优先返回问题位置、确认方式、下一步排查路径；重点保留接口、错误、日志、复现条件、版本/分支和可疑模块。',
    support: '技术支持视角：优先提取客户环境、账号角色、时间范围、URL、截图/报错和影响范围；输出可转交研发的证据包和升级条件。',
    customer: '客户视角：优先提取所在页面、操作步骤和看到的提示；避免技术化追问和内部代码路径，输出非技术化说明。',
  };
  return [shared, personaSpecific[persona] ?? personaSpecific.operations];
}

export function attachCaseContext(caseSession: StoredCase, request: DiagnosticRequest): void {
  const existingResolvedTurn = request.context?.resolvedTurn;
  const existingAnswerGoal = request.answerGoal;
  const rawMessage = existingResolvedTurn?.latestUserMessage ?? request.context?.currentUserMessage ?? request.userGoal;
  const context = buildDiagnosticRequestContext(caseSession, rawMessage);
  context.resolvedTurn = existingResolvedTurn ?? buildResolvedTurnContext({
    caseSession,
    latestUserMessage: rawMessage,
  });
  request.answerGoal = existingAnswerGoal ?? buildAnswerGoal({ rawUserQuestion: rawMessage, resolvedTurn: context.resolvedTurn });
  request.context = context;
  if (context.isFollowUp) {
    request.constraints = Array.from(
      new Set([
        ...request.constraints,
        'Resolve follow-up references such as "刚刚", "上一轮", "这个设置", "那个页面", or "the previous answer" using DiagnosticRequest.context.recentMessages and DiagnosticRequest.context.previousRuns.',
        'Answer the latest userGoal first. Do not repeat a previous answer unless it is needed to ground the follow-up.',
      ]),
    );
  }
}
