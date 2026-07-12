import { describe, expect, it, vi } from 'vitest';
import { useOnboarding } from './use-onboarding';

const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
}));

describe('setup onboarding state', () => {
  it('restores the latest run and review state from the public snapshot', async () => {
    const onboarding = useOnboarding({
      fetcher: vi.fn(() => response({
        completed: true,
        latestRun: { id: 'run_saved', status: 'completed', overallProgress: 100, stages: [] },
        review: { required: false, pendingCount: 0, blockedCount: 0, items: [] },
      })),
    });

    await onboarding.load();

    expect(onboarding.run.value?.id).toBe('run_saved');
    expect(onboarding.review.value?.required).toBe(false);
  });

  it('adopts the review returned by a batch submission before refreshing it', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({
        review: { required: false, pendingCount: 0, blockedCount: 0, items: [] },
      }))
      .mockImplementationOnce(() => response({
        review: { required: false, pendingCount: 0, blockedCount: 0, items: [] },
      }));
    const onboarding = useOnboarding({ fetcher });

    await onboarding.submitReview({ action: 'approve', ids: ['slice-1'] });

    expect(onboarding.review.value?.required).toBe(false);
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/onboarding/review', expect.objectContaining({ method: 'POST' }));
  });

  it('saves draft, validates, starts a run, receives progress, and retries', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ draft: { revision: 1 } }))
      .mockImplementationOnce(() => response({ ok: true, issues: [] }))
      .mockImplementationOnce(() => response({ run: { id: 'run_a', status: 'running', stages: [] } }))
      .mockImplementationOnce(() => response({ run: { id: 'run_a', status: 'running', stages: [] } }));
    const onboarding = useOnboarding({ fetcher, eventSourceFactory: () => ({ close: vi.fn() }) });
    await onboarding.save({ draft: {} });
    await onboarding.validate();
    await onboarding.start();
    onboarding.applyProgress({ run: { id: 'run_a', status: 'failed', stages: [] } });
    await onboarding.retry();
    expect(onboarding.run.value?.status).toBe('running');
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe('/api/onboarding/runs/run_a/retry');
  });

  it('shows safe API errors', async () => {
    const onboarding = useOnboarding({ fetcher: vi.fn(() => response({ error: '草稿无效' }, 400)) });
    await expect(onboarding.validate()).rejects.toThrow('草稿无效');
    expect(onboarding.error.value).toBe('草稿无效');
  });

  it('surfaces an interrupted SSE channel without exposing payloads', async () => {
    const close = vi.fn();
    const channel: { close: () => void; onerror?: (event: Event) => void } = { close: () => close() };
    const onboarding = useOnboarding({
      fetcher: vi.fn(() => response({ run: { id: 'run_a', status: 'running', stages: [] } })),
      eventSourceFactory: () => channel,
    });
    await onboarding.start();
    channel.onerror?.(new Event('error'));
    expect(onboarding.error.value).toBe('进度连接已中断，可刷新或重试');
  });
});
