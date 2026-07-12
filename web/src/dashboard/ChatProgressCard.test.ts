import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatProgressCard from './ChatProgressCard.vue';

describe('进度卡', () => {
  it('运行中显示进度语义，中断时没有活动动画', async () => {
    const wrapper = mount(ChatProgressCard, { props: { progress: { state: 'running', startedAt: Date.now() - 5_000, lastActivityAt: Date.now(), session: { status: 'diagnosing' } } } });
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBeDefined();
    expect(wrapper.text()).toContain('估计');
    await wrapper.setProps({ progress: { state: 'interrupted', startedAt: Date.now() - 5_000, lastActivityAt: Date.now(), error: '服务连接中断' } });
    expect(wrapper.text()).toContain('回答已中断');
    expect(wrapper.classes()).not.toContain('is-active');
  });
});
