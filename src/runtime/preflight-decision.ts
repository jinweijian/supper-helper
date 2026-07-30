import type { CaseSession, DiagnosticRequest, HelperAgentConfig } from '../domain.js';
import { buildDiagnosticRequestFromResolvedTurn } from './request-builder.js';
import { buildResolvedTurnContext } from './resolved-turn.js';

export interface PreflightInput {
  caseSession: CaseSession;
  userMessage: string;
  agentConfig: HelperAgentConfig;
  allowedMcpToolIds?: string[];
}

export type PreflightDecision =
  | {
      action: 'ask_user';
      question: string;
      missingInfo: string[];
    }
  | {
      action: 'dispatch';
      request: DiagnosticRequest;
    };

export function preflight(input: PreflightInput): PreflightDecision {
  const userMessage = input.userMessage.trim();
  const missingInfo = [
    ...(!input.caseSession.workspaceId ? ['目标 workspace'] : []),
    ...(!userMessage ? ['具体问题'] : []),
  ];
  if (input.agentConfig.rules.askWhenMissingRequiredInfo && missingInfo.length > 0) {
    return {
      action: 'ask_user',
      missingInfo,
      question: `为了避免无证据猜测，请先补充：${missingInfo.join('、')}。如果不清楚，可以直接回答“不清楚”。`,
    };
  }

  const resolvedTurn = buildResolvedTurnContext({
    caseSession: input.caseSession,
    latestUserMessage: input.userMessage,
  });
  const unknowns = Array.from(new Set(resolvedTurn.unknowns.map((unknown) => unknown.text)));

  return {
    action: 'dispatch',
    request: buildDiagnosticRequestFromResolvedTurn({
      caseSession: input.caseSession,
      rawUserQuestion: input.userMessage,
      resolvedTurn,
      unknowns,
      allowedMcpToolIds: input.allowedMcpToolIds ?? [],
    }),
  };
}
