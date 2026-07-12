import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatPanel from './ChatPanel.vue';
import SessionSidebar from './SessionSidebar.vue';

describe('会话能力对齐', () => {
  it('处理中筛选包含 queued、ready_for_diagnosis 和 diagnosing', async () => {
    const sessions = ['queued', 'ready_for_diagnosis', 'diagnosing', 'concluded'].map((status) => ({ id: status, title: status, status, messages: [], runs: [] }));
    const wrapper = mount(SessionSidebar, { props: { sessions } });
    await wrapper.get('[data-filter="active"]').trigger('click');
    expect(wrapper.findAll('.session-item')).toHaveLength(3);
  });

  it('归档或上下文不可用时禁用输入并说明原因', async () => {
    const wrapper = mount(ChatPanel, { props: { session: { id: 'case_1', title: '归档', status: 'concluded', archivedAt: 'now', messages: [], runs: [] }, sending: false } });
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('已归档');
    await wrapper.setProps({ session: { id: 'case_2', title: '满额', status: 'collecting_input', messages: [], runs: [], contextUsage: { available: false, percent: 100, estimatedTokens: 100, limitTokens: 100 } } });
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('上下文窗口已满');
  });
});
