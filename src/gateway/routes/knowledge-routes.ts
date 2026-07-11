import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SuperHelperConfig } from '../../config.js';
import {
  bindKnowledgeWorkspace,
  getKnowledgeHealthSummary,
  reindexKnowledgeWorkspace,
} from '../../knowledge/health-service.js';
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
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/knowledge/health') {
    const workspaceId = resolveConfiguredWorkspaceId(config, url.searchParams.get('workspaceId'));

    sendJson(res, 200, {
      ok: true,
      workspaceId,
      knowledgeHealth: await getKnowledgeHealthSummary({
        config,
        workspaceId,
        query: url.searchParams.get('query') ?? undefined,
      }),
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/knowledge/bind') {
    const body = (await readJson(req)) as KnowledgeActionBody;
    const workspaceId = resolveConfiguredWorkspaceId(config, body.workspaceId);

    const init = bindKnowledgeWorkspace({ config, workspaceId });
    sendJson(res, 200, {
      ok: true,
      workspaceId,
      init,
      knowledgeHealth: await getKnowledgeHealthSummary({
        config,
        workspaceId,
        query: body.query,
      }),
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/knowledge/reindex') {
    const body = (await readJson(req)) as KnowledgeActionBody;
    const workspaceId = resolveConfiguredWorkspaceId(config, body.workspaceId);

    const update = reindexKnowledgeWorkspace({ config, workspaceId });
    sendJson(res, 200, {
      ok: true,
      workspaceId,
      update,
      knowledgeHealth: await getKnowledgeHealthSummary({
        config,
        workspaceId,
        query: body.query,
      }),
    });
    return true;
  }

  return false;
}
