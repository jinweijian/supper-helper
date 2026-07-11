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
});
