import { ref } from 'vue';
import { apiJson, jsonRequest, type Fetcher } from '../shared/api';

export interface RunDto {
  id: string;
  status: string;
  overallProgress?: number;
  stages: Array<Record<string, unknown>>;
  counters?: Record<string, number>;
  safeError?: { message?: string };
}

interface OnboardingSnapshot extends Record<string, unknown> {
  latestRun?: RunDto;
  review?: Record<string, unknown>;
}

interface EventSourceLike {
  close(): void;
  addEventListener?(type: string, listener: (event: MessageEvent) => void): void;
  onmessage?: ((event: MessageEvent) => void) | null;
  onerror?: ((event: Event) => void) | null;
}

export function useOnboarding(options: {
  fetcher?: Fetcher;
  eventSourceFactory?: (url: string) => EventSourceLike;
} = {}) {
  const fetcher = options.fetcher ?? fetch;
  const eventSourceFactory: (url: string) => EventSourceLike = options.eventSourceFactory ?? ((url) => new EventSource(url) as EventSourceLike);
  const snapshot = ref<Record<string, unknown>>({});
  const validation = ref<Record<string, unknown>>();
  const review = ref<Record<string, unknown>>();
  const run = ref<RunDto>();
  const error = ref('');
  const loading = ref(false);
  let source: EventSourceLike | undefined;

  async function execute<T>(work: () => Promise<T>): Promise<T> {
    loading.value = true;
    error.value = '';
    try {
      return await work();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '配置请求失败';
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  async function load() {
    const state = await execute(() => apiJson<OnboardingSnapshot>(fetcher, '/api/onboarding'));
    snapshot.value = state;
    run.value = state.latestRun;
    review.value = state.review;
    return state;
  }

  async function save(input: Record<string, unknown>) {
    snapshot.value = await execute(() => apiJson(fetcher, '/api/onboarding/draft', jsonRequest('PUT', input)));
    return snapshot.value;
  }

  async function validate() {
    validation.value = await execute(() => apiJson(fetcher, '/api/onboarding/validate', { method: 'POST' }));
    return validation.value;
  }

  async function start() {
    const body = await execute(() => apiJson<{ run: RunDto }>(fetcher, '/api/onboarding/runs', { method: 'POST' }));
    run.value = body.run;
    subscribe(body.run.id);
    return body.run;
  }

  function subscribe(runId: string): void {
    source?.close();
    const current = eventSourceFactory(`/api/onboarding/runs/${encodeURIComponent(runId)}/events`);
    source = current;
    const listener = (event: MessageEvent) => {
      try { applyProgress(JSON.parse(event.data)); } catch { error.value = '进度事件格式无效'; }
    };
    current.onmessage = listener;
    for (const eventName of ['run.snapshot', 'run.started', 'stage.started', 'stage.progress', 'stage.completed', 'stage.failed', 'run.completed', 'run.failed']) {
      current.addEventListener?.(eventName, listener);
    }
    current.onerror = () => { error.value = '进度连接已中断，可刷新或重试'; };
  }

  function applyProgress(payload: { run?: RunDto }): void {
    if (payload.run) run.value = payload.run;
  }

  async function retry() {
    if (!run.value) throw new Error('没有可重试的运行');
    const body = await execute(() => apiJson<{ run: RunDto }>(fetcher, `/api/onboarding/runs/${encodeURIComponent(run.value!.id)}/retry`, { method: 'POST' }));
    run.value = body.run;
    subscribe(body.run.id);
    return body.run;
  }

  async function loadReview(query = '') {
    const body = await execute(() => apiJson<{ review: Record<string, unknown> }>(fetcher, `/api/onboarding/review${query}`));
    review.value = body.review;
    return body.review;
  }

  async function submitReview(input: Record<string, unknown>) {
    const body = await execute(() => apiJson<Record<string, unknown>>(fetcher, '/api/onboarding/review', jsonRequest('POST', input)));
    if (body.review && typeof body.review === 'object') review.value = body.review as Record<string, unknown>;
    await loadReview();
    return body;
  }

  function close(): void { source?.close(); }

  return { snapshot, validation, review, run, error, loading, load, save, validate, start, retry, loadReview, submitReview, applyProgress, close };
}
