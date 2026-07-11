import { ref } from 'vue';
import { apiJson, type Fetcher } from '../shared/api';

export interface LogBlock {
  title?: string;
  body?: string;
  severity?: string;
  command?: string;
}

export function useLogs(options: { fetcher?: Fetcher } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const caseId = ref('');
  const blocks = ref<LogBlock[]>([]);
  const loading = ref(false);
  const error = ref('');

  async function open(id: string): Promise<void> {
    caseId.value = id;
    await refresh();
  }

  async function refresh(): Promise<void> {
    if (!caseId.value) return;
    loading.value = true;
    error.value = '';
    try {
      const body = await apiJson<{ blocks?: LogBlock[]; logs?: string[] }>(fetcher, `/api/logs?caseId=${encodeURIComponent(caseId.value)}`);
      blocks.value = body.blocks ?? (body.logs ?? []).map((entry) => ({ body: entry }));
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '日志加载失败';
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  return { blocks, loading, error, open, refresh };
}
