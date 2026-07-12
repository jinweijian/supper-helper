import { computed, reactive, ref } from 'vue';
import { apiJson, jsonRequest, type Fetcher } from '../shared/api';

export interface SettingsActionState { running: boolean; status: string; error: string; elapsedMs?: number; startedAt?: number }
export type SettingsAction = 'load' | 'saveModel' | 'saveEmbedding' | 'saveRerank' | 'saveClaude' | 'testModel' | 'testEmbedding' | 'testRerank';

export function useSettings(options: { fetcher?: Fetcher } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const value = ref<Record<string, any>>({});
  const actions = reactive(Object.fromEntries(['load', 'saveModel', 'saveEmbedding', 'saveRerank', 'saveClaude', 'testModel', 'testEmbedding', 'testRerank'].map((name) => [name, { running: false, status: '', error: '' }])) as Record<SettingsAction, SettingsActionState>);
  const loading = computed(() => Object.values(actions).some((action) => action.running));
  const status = computed(() => Object.values(actions).map((action) => action.status).filter(Boolean).at(-1) ?? '');
  const error = computed(() => Object.values(actions).map((action) => action.error).filter(Boolean).at(-1) ?? '');

  async function execute<T>(name: SettingsAction, work: () => Promise<T>, success: string): Promise<T> {
    const action = actions[name];
    action.running = true; action.status = ''; action.error = ''; action.startedAt = Date.now();
    try { const result = await work(); action.status = success; return result; }
    catch (cause) { action.error = cause instanceof Error ? cause.message : '配置请求失败'; throw cause; }
    finally { action.running = false; action.elapsedMs = Date.now() - action.startedAt!; }
  }

  async function load() {
    const settings = await execute('load', () => apiJson<Record<string, any>>(fetcher, '/api/settings'), '配置已加载');
    const agents = await apiJson<{ agents?: unknown[] }>(fetcher, '/api/agents');
    value.value = { ...settings, agents: agents.agents ?? [] };
    return value.value;
  }

  async function post(name: SettingsAction, path: string, body: Record<string, unknown>, success: string) {
    const result = await execute(name, () => apiJson<Record<string, unknown>>(fetcher, path, jsonRequest('POST', body)), success);
    if (!path.endsWith('/test')) value.value = { ...value.value, ...result, agents: value.value.agents };
    return result;
  }

  return {
    value, actions, loading, status, error, load,
    testModel: (body: Record<string, unknown>) => post('testModel', '/api/settings/model/test', body, '模型连接正常'),
    saveModel: (body: Record<string, unknown>) => post('saveModel', '/api/settings/model', body, '模型配置已保存'),
    testEmbedding: (body: Record<string, unknown>) => post('testEmbedding', '/api/settings/embedding/test', body, 'Embedding 连接正常'),
    saveEmbedding: (body: Record<string, unknown>) => post('saveEmbedding', '/api/settings/embedding', body, 'Embedding 配置已保存'),
    testRerank: (body: Record<string, unknown>) => post('testRerank', '/api/settings/rerank/test', body, 'Rerank 连接正常'),
    saveRerank: (body: Record<string, unknown>) => post('saveRerank', '/api/settings/rerank', body, 'Rerank 配置已保存'),
    saveClaude: (body: Record<string, unknown>) => post('saveClaude', '/api/settings/claude', body, 'Claude 配置已保存'),
  };
}
