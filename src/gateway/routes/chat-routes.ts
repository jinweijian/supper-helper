import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveContextWindowTokens, type SuperHelperConfig } from '../../config.js';
import { estimateCaseContextUsage } from '../../context-window.js';
import type { UserPersona } from '../../domain.js';
import type { DiagnosticRuntime } from '../../runtime/diagnostic-runtime.js';
import { RetryableTurnError } from '../../runtime/diagnostic-runtime.js';
import { readJson, sendJson } from '../http-utils.js';
import { assertChatMessageSize, requireCaseId, resolveConfiguredWorkspaceId } from '../request-contracts.js';

export async function handleChatRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: SuperHelperConfig,
  agent: DiagnosticRuntime,
): Promise<boolean> {
  if (req.method !== 'POST') {
    return false;
  }

  if (url.pathname === '/api/chat/retry') {
    return handleRetryRoute(req, res, agent);
  }

  if (url.pathname !== '/api/chat') {
    return false;
  }

  const body = (await readJson(req)) as {
    caseId?: string;
    message?: string;
    workspaceId?: string;
    persona?: UserPersona;
    async?: boolean;
  };
  if (!body.message?.trim()) {
    sendJson(res, 400, { error: 'message is required' });
    return true;
  }
  assertChatMessageSize(body.message);
  const caseId = body.caseId ? requireCaseId(body.caseId) : undefined;
  const workspaceId = resolveConfiguredWorkspaceId(config, body.workspaceId);
  if (caseId) {
    const existing = agent.loadCase?.(caseId);
    if (existing?.archivedAt) {
      sendJson(res, 409, { error: 'session is archived and cannot continue' });
      return true;
    }
  }

  if (body.async) {
    const turn = agent.startUserTurn({
      caseId,
      message: body.message,
      workspaceId,
      persona: body.persona,
    });
    const caseSession = turn.caseSession;
    const userMessageId = turn.userMessageId;
    sendJson(res, 202, {
      accepted: true,
      caseId: caseSession.id,
      userMessageId,
      claudeSessionId: caseSession.claudeSessionId,
      title: caseSession.title,
      status: caseSession.status,
      persona: caseSession.userPersona,
      contextUsage: estimateCaseContextUsage(caseSession, resolveContextWindowTokens(config)),
    });
    void agent.completeUserTurn(caseSession.id, userMessageId).catch((error) => {
      agent.recordTurnFailure(caseSession.id, error, userMessageId);
    });
    return true;
  }

  const response = await agent.handleUserMessage({
    caseId,
    message: body.message,
    workspaceId,
    persona: body.persona,
  });

  sendJson(res, 200, {
    caseId: response.caseSession.id,
    claudeSessionId: response.caseSession.claudeSessionId,
    title: response.caseSession.title,
    status: response.caseSession.status,
    message: response.assistantMessage,
    decision: response.decision,
    persona: response.caseSession.userPersona,
    contextUsage: estimateCaseContextUsage(response.caseSession, resolveContextWindowTokens(config)),
  });
  return true;
}

async function handleRetryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  agent: DiagnosticRuntime,
): Promise<boolean> {
  const body = (await readJson(req)) as { caseId?: unknown; userMessageId?: unknown };
  if (
    typeof body.caseId !== 'string'
    || typeof body.userMessageId !== 'string'
    || !body.userMessageId
    || body.userMessageId.length > 128
  ) {
    sendJson(res, 400, { error: 'caseId and userMessageId are required' });
    return true;
  }
  const caseId = requireCaseId(body.caseId);

  try {
    const result = agent.retryInterruptedTurn(caseId, body.userMessageId);
    sendJson(res, 202, { accepted: true, caseId: result.caseId, userMessageId: result.userMessageId });
  } catch (error) {
    if (error instanceof RetryableTurnError) {
      sendJson(res, error.statusCode, { error: error.message });
    } else {
      throw error;
    }
  }
  return true;
}
