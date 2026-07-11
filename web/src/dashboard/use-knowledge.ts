import { ref } from 'vue';
import { apiJson, jsonRequest, type Fetcher } from '../shared/api';

export function useKnowledge(options: { fetcher?: Fetcher } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const health = ref<Record<string, unknown>>();
  const error = ref('');
  const loading = ref(false);

  async function request(path: string, workspaceId: string, query: string, method: 'GET' | 'POST') {
    loading.value = true;
    error.value = '';
    try {
      const url = method === 'GET'
        ? `${path}?workspaceId=${encodeURIComponent(workspaceId)}&query=${encodeURIComponent(query)}`
        : path;
      const body = await apiJson<{ knowledgeHealth: Record<string, unknown> }>(
        fetcher,
        url,
        method === 'POST' ? jsonRequest('POST', { workspaceId, query }) : undefined,
      );
      health.value = body.knowledgeHealth;
      return health.value;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '知识库请求失败';
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  return {
    health,
    error,
    loading,
    check: (workspaceId: string, query = '') => request('/api/knowledge/health', workspaceId, query, 'GET'),
    bind: (workspaceId: string, query = '') => request('/api/knowledge/bind', workspaceId, query, 'POST'),
    reindex: (workspaceId: string, query = '') => request('/api/knowledge/reindex', workspaceId, query, 'POST'),
  };
}
