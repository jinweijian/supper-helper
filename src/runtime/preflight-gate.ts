import type { SuperHelperConfig } from '../config.js';
import type { HelperAgentConfig } from '../domain.js';
import { preflight, type PreflightDecision } from './preflight-decision.js';
import type { StoredCase } from '../sessions/case-repository.js';
import { attachCaseContext, personaDiagnosticConstraints } from './request-builder.js';

export function buildLocalPreflightDecision(input: {
  config: SuperHelperConfig;
  caseSession: StoredCase;
  userMessage: string;
}): PreflightDecision {
  const { config, caseSession, userMessage } = input;
  const localDecision = preflight({
    caseSession,
    userMessage,
    agentConfig: helperAgentConfig(config),
    allowedMcpToolIds: config.workspaces.find((workspace) => workspace.id === caseSession.workspaceId)?.mcpToolIds ?? [],
  });
  if (localDecision.action === 'dispatch') {
    localDecision.request.userPersona = caseSession.userPersona;
    localDecision.request.constraints = Array.from(
      new Set([
        ...localDecision.request.constraints,
        ...personaDiagnosticConstraints(caseSession.userPersona),
      ]),
    );
    attachCaseContext(caseSession, localDecision.request);
  }
  return localDecision;
}

export function helperAgentConfig(config: SuperHelperConfig): HelperAgentConfig {
  return {
    id: 'default-helper-agent',
    name: config.agent.name,
    language: config.agent.language,
    tone: config.agent.tone,
    defaultPermission: 'read_only',
    rules: {
      noGuessing: true,
      requireEvidenceForConclusion: true,
      askWhenMissingRequiredInfo: true,
      allowUnknownAnswer: true,
      distinguishFactInferenceAssumption: true,
    },
  };
}

export function summarizePreflightDecision(decision: PreflightDecision): Record<string, unknown> {
  if (decision.action === 'ask_user') {
    return {
      action: 'ask_user',
      missingInfo: decision.missingInfo,
      question: decision.question,
    };
  }

  return {
    action: 'dispatch',
    userGoal: decision.request.userGoal,
    knownFacts: decision.request.knownFacts,
    unknowns: decision.request.unknowns,
    allowedMcpToolIds: decision.request.allowedMcpToolIds,
    reason: '当前 workspace 已选中，且用户提供了非空问题，可开始有界只读检索。',
  };
}
