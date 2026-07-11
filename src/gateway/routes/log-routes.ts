import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CaseRepository } from '../../sessions/case-repository.js';
import { buildLogBlocks, formatLogSection } from '../../observability/log-blocks.js';
import { sanitizeWorkerTrace } from '../../observability/worker-trace.js';
import { sendJson } from '../http-utils.js';
import { requireCaseId } from '../request-contracts.js';

export async function handleLogRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  store: CaseRepository,
): Promise<boolean> {
  if (req.method !== 'GET' || url.pathname !== '/api/logs') {
    return false;
  }

  const caseId = requireCaseId(url.searchParams.get('caseId'));

  const caseSession = store.loadCase(caseId);
  if (!caseSession) {
    sendJson(res, 404, { error: 'case not found' });
    return true;
  }

  const caseLogs = caseSession.logs ?? [];
  const blocks = buildLogBlocks(caseSession);
  const logs = [
    `Case 概览\ncaseId: ${caseSession.id}\nworkspaceId: ${caseSession.workspaceId}\nstatus: ${caseSession.status}`,
    formatLogSection('Agent 工作链路', caseLogs.filter((event) => event.actor === 'agent')),
    formatLogSection('Claude Code 工作链路', caseLogs.filter((event) => event.actor === 'claude')),
    formatLogSection('MCP 工作链路', caseLogs.filter((event) => event.actor === 'mcp')),
    `消息记录\n${caseSession.messages.map((message) => `${message.createdAt} ${message.role}: ${message.body}`).join('\n')}`,
    `诊断运行\n${caseSession.runs
      .map(
        (run) =>
          `${run.id} status=${run.status}\nDiagnosticRequest:\n${JSON.stringify(run.request ?? {}, null, 2)}\nDiagnosticResult:\n${JSON.stringify(run.result ?? {}, null, 2)}\nWorkerTrace:\n${JSON.stringify(run.workerTrace ? sanitizeWorkerTrace(run.workerTrace) : {}, null, 2)}`,
      )
      .join('\n\n')}`,
  ].filter(Boolean);
  sendJson(res, 200, { blocks, logs });
  return true;
}
