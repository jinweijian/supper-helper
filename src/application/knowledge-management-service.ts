import type { SuperHelperConfig } from '../config.js';
import {
  bindKnowledgeWorkspace,
  getLocalKnowledgeHealthSummary,
  reindexKnowledgeWorkspace,
} from '../knowledge/health-service.js';
import type { KnowledgeHealthSummary } from '../knowledge/health.js';
import { resolveKnowledgeWorkspaceRoot } from '../knowledge/storage-scope.js';
import { retrieveKnowledgeWithConfiguredRetrieval } from '../retrieval/configured-search.js';
import type { RetrievalTrace } from '../retrieval/types.js';

export interface KnowledgeProbeResult {
  knowledgeHealth: KnowledgeHealthSummary;
  trace: RetrievalTrace;
}

export interface KnowledgeManagementService {
  getLocalHealth(workspaceId: string): Promise<KnowledgeHealthSummary>;
  probeSearch(workspaceId: string, query: string): Promise<KnowledgeProbeResult>;
  bind(workspaceId: string): Promise<{ init: unknown; knowledgeHealth: KnowledgeHealthSummary }>;
  reindex(workspaceId: string): Promise<{ update: unknown; knowledgeHealth: KnowledgeHealthSummary }>;
}

export function createKnowledgeManagementService(config: SuperHelperConfig): KnowledgeManagementService {
  return {
    getLocalHealth: (workspaceId) => getLocalKnowledgeHealthSummary({ config, workspaceId }),
    async probeSearch(workspaceId, query) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        throw new Error('knowledge probe query is required');
      }
      const [local, retrieval] = await Promise.all([
        getLocalKnowledgeHealthSummary({ config, workspaceId }),
        retrieveKnowledgeWithConfiguredRetrieval({
          config,
          query: {
            workspaceRoot: resolveKnowledgeWorkspaceRoot(config, workspaceId),
            query: normalizedQuery,
            limit: 5,
          },
        }),
      ]);
      const evidence = retrieval.evidencePack;
      return {
        knowledgeHealth: {
          ...local,
          search: {
            status: evidence.results.length ? 'ok' : 'warn',
            query: normalizedQuery,
            searchedFiles: evidence.coverage.searched_files,
            matchedFiles: evidence.coverage.matched_files,
            filteredOut: evidence.coverage.filtered_out,
            reason: evidence.results.length
              ? 'configured retrieval returned evidence for the current query'
              : 'configured retrieval returned no evidence for the current query',
          },
        },
        trace: retrieval.trace,
      };
    },
    async bind(workspaceId) {
      const init = bindKnowledgeWorkspace({ config, workspaceId });
      return { init, knowledgeHealth: await getLocalKnowledgeHealthSummary({ config, workspaceId }) };
    },
    async reindex(workspaceId) {
      const update = reindexKnowledgeWorkspace({ config, workspaceId });
      return { update, knowledgeHealth: await getLocalKnowledgeHealthSummary({ config, workspaceId }) };
    },
  };
}
