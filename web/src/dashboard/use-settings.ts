import { ref } from 'vue';
import { apiJson, jsonRequest, type Fetcher } from '../shared/api';

export function useSettings(options: { fetcher?: Fetcher } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const value = ref<Record<string, unknown>>({});
  const status = ref('');
  const error = ref('');
  const loading = ref(false);

  async function execute<T>(work: () => Promise<T>, success: string): Promise<T> {
    loading.value = true;
    error.value = '';
    try {
      const result = await work();
      status.value = success;
      return result;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '配置请求失败';
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  async function load() {
    const body = await execute(() => apiJson<Record<string, unknown>>(fetcher, '/api/settings'), '配置已加载');
    value.value = body;
    return body;
  }

  async function post(path: string, body: Record<string, unknown>, success: string) {
    const result = await execute(() => apiJson<Record<string, unknown>>(fetcher, path, jsonRequest('POST', body)), success);
    if (!path.endsWith('/test')) value.value = { ...value.value, ...result };
    return result;
  }

  return {
    value,
    status,
    error,
    loading,
    load,
    testModel: (body: Record<string, unknown>) => post('/api/settings/model/test', body, '模型连接正常'),
    saveModel: (body: Record<string, unknown>) => post('/api/settings/model', body, '模型配置已保存'),
    testEmbedding: (body: Record<string, unknown>) => post('/api/settings/embedding/test', body, 'Embedding 连接正常'),
    saveEmbedding: (body: Record<string, unknown>) => post('/api/settings/embedding', body, 'Embedding 配置已保存'),
    testRerank: (body: Record<string, unknown>) => post('/api/settings/rerank/test', body, 'Rerank 连接正常'),
    saveRerank: (body: Record<string, unknown>) => post('/api/settings/rerank', body, 'Rerank 配置已保存'),
  };
}
