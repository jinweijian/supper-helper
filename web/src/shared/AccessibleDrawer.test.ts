import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import AccessibleDrawer from './AccessibleDrawer.vue';

describe('AccessibleDrawer', () => {
  it('focuses the close button, closes on Escape, and restores opener focus', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const wrapper = mount(AccessibleDrawer, {
      attachTo: document.body,
      props: { open: true, title: '诊断日志', returnFocus: opener },
      slots: { default: '日志内容' },
    });
    await nextTick();
    expect(document.activeElement?.getAttribute('data-close-drawer')).not.toBeNull();
    document.querySelector('.drawer-backdrop')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(opener);
  });
});
