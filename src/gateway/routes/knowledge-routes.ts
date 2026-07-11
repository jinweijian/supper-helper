import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SuperHelperConfig } from '../../config.js';
import type { KnowledgeManagementService } from '../../application/knowledge-management-service.js';
import { readJson, sendJson } from '../http-utils.js';
import { resolveConfiguredWorkspaceId } from '../request-contracts.js';

type KnowledgeActionBody = {
  workspaceId?: string;
  query?: string;
};

export async function handleKnowledgeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: SuperHelperConfig,
  knowledge: KnowledgeManagementService,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/knowledge/health') {
    const workspaceId = resolveConfiguredWorkspaceId(config, url.searchParams.get('workspaceId'));

    const query = url.searchParams.get('query')?.trim() ?? '';
    const knowledgeHealth = query
      ? (await knowledge.probeSearch(workspaceId, query)).knowledgeHealth
      : await knowledge.getLocalHealth(workspaceId);
    sendJson(res, 200, {
      ok: true,
      workspaceId,
      knowledgeHealth,
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/knowledge/bind') {
    const body = (await readJson(req)) as KnowledgeActionBody;
    const workspaceId = resolveConfiguredWorkspaceId(config, body.workspaceId);

    const result = await knowledge.bind(workspaceId);
    sendJson(res, 200, {
      ok: true,
      workspaceId,
      init: result.init,
      knowledgeHealth: result.knowledgeHealth,
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/knowledge/reindex') {
    const body = (await readJson(req)) as KnowledgeActionBody;
    const workspaceId = resolveConfiguredWorkspaceId(config, body.workspaceId);

    const result = await knowledge.reindex(workspaceId);
    sendJson(res, 200, {
      ok: true,
      workspaceId,
      update: result.update,
      knowledgeHealth: result.knowledgeHealth,
    });
    return true;
  }

  return false;
}
