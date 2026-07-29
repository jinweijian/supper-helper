import { ref } from 'vue';
import { apiJson, jsonRequest, type Fetcher } from '../shared/api';
import type { SessionDto, SessionSummaryDto } from '../shared/contracts';

interface SessionOptions {
  fetcher?: Fetcher;
  history?: Pick<History, 'pushState' | 'replaceState'>;
  initialPath?: string;
}

export function sessionIdFromPath(path: string): string | undefined {
  const match = path.match(/^\/sessions\/([^/]+)(\/audit)?$/);
  return match ? decodeURIComponent(match[1]!) : undefined;
}

export function useSessions(options: SessionOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const browserHistory = options.history ?? history;
  const sessions = ref<SessionSummaryDto[]>([]);
  const current = ref<SessionDto>();
  const loading = ref(false);
  const error = ref('');

  async function list(): Promise<void> {
    const body = await apiJson<{ sessions: SessionSummaryDto[] }>(fetcher, '/api/sessions?includeKnowledgeHealth=false');
    sessions.value = body.sessions;
  }

  async function load(id: string): Promise<SessionDto> {
    const body = await apiJson<{ session: SessionDto }>(fetcher, `/api/session?caseId=${encodeURIComponent(id)}&includeKnowledgeHealth=false`);
    current.value = body.session;
    return body.session;
  }

  async function initialize(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      await list();
      const id = sessionIdFromPath(options.initialPath ?? location.pathname);
      if (id) await load(id);
    } catch (cause) {
      error.value = errorMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  async function open(id: string, replace = false): Promise<void> {
    await load(id);
    browserHistory[replace ? 'replaceState' : 'pushState']({}, '', `/sessions/${encodeURIComponent(id)}`);
  }

  async function create(persona = 'operations'): Promise<SessionDto> {
    const body = await apiJson<{ session: SessionDto }>(fetcher, '/api/sessions', jsonRequest('POST', { title: '新对话', persona }));
    await list();
    current.value = body.session;
    browserHistory.pushState({}, '', `/sessions/${encodeURIComponent(body.session.id)}`);
    return body.session;
  }

  async function action(id: string, actionName: 'pin' | 'unpin' | 'archive'): Promise<void> {
    await apiJson(fetcher, '/api/session', jsonRequest('PATCH', { caseId: id, action: actionName }));
    await list();
    if (current.value?.id === id) await load(id);
  }

  async function remove(id: string): Promise<void> {
    await apiJson(fetcher, `/api/session?caseId=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (current.value?.id === id) {
      current.value = undefined;
      browserHistory.pushState({}, '', '/');
    }
    await list();
  }

  return { sessions, current, loading, error, initialize, list, load, open, create, action, remove };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : '请求失败';
}
