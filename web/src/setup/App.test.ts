import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}

describe('Setup API Key 提示', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('根据草稿中的密钥状态说明留空是否保留原记录', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
      draft: {
        agent: { provider: { hasApiKey: true } },
        embedding: { hasApiKey: false },
        rerank: { hasApiKey: true },
      },
      review: { required: false },
    })));

    const wrapper = mount(App);
    await flushPromises();

    const hints = wrapper.findAll('.api-key-hint').map((node) => node.text());
    expect(hints).toEqual([
      '已保存 API Key，留空将继续使用原记录。',
      '当前未保存 API Key，留空则不设置。',
      '已保存 API Key，留空将继续使用原记录。',
    ]);
  });

  it('明确说明待审核状态会阻止进入 Dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => jsonResponse({
        completed: true,
        latestRun: { id: 'run_done', status: 'completed', overallProgress: 100, stages: [] },
        review: { required: true, pendingCount: 2, blockedCount: 1, items: [] },
      }))
      .mockImplementationOnce(() => jsonResponse({
        review: { required: true, pendingCount: 2, blockedCount: 1, items: [] },
      })));

    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.text()).toContain('处理完成后才能进入 Dashboard');
    expect(wrapper.find('a[href="/"]').exists()).toBe(false);
  });

  it('刷新后根据服务端完成状态恢复 Dashboard 入口', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
      completed: true,
      latestRun: { id: 'run_done', status: 'completed', overallProgress: 100, stages: [] },
      review: { required: false, pendingCount: 0, blockedCount: 0, items: [] },
    })));

    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.get('a[href="/"]').text()).toBe('进入 Dashboard');
  });
});
