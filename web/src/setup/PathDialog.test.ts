import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PathDialog from './PathDialog.vue';

describe('PathDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sets initial focus, closes on Escape, and restores the browser button', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ path: '/tmp', entries: [] }), { status: 200 }))));
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const wrapper = mount(PathDialog, { attachTo: document.body, props: { open: false, initialPath: '/tmp', returnFocus: opener } });
    await wrapper.setProps({ open: true });
    await flushPromises();
    await nextTick();
    expect(document.activeElement?.textContent).toBe('关闭');
    document.querySelector('.modal-backdrop')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(opener);
  });
});
