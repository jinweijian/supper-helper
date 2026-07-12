import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LogList from './LogList.vue';

const blocks = Array.from({ length: 5 }, (_, index) => ({ id: `log_${index}`, title: `日志 ${index}`, label: '预检', severity: index === 0 ? 'warn' : 'ok', createdAt: `2026-07-12T00:00:0${index}Z`, phase: 'preflight', agentName: '输入审核 Agent', detail: { index } }));

describe('结构化日志列表', () => {
  it('默认展开最近三条并支持全部展开和收起', async () => {
    const wrapper = mount(LogList, { props: { blocks, loading: false } });
    expect(wrapper.findAll('details[open]')).toHaveLength(3);
    expect(wrapper.text()).toContain('输入审核 Agent');
    expect(wrapper.text()).toContain('warn');
    await wrapper.get('[data-testid="collapse-all-logs"]').trigger('click');
    expect(wrapper.findAll('details[open]')).toHaveLength(0);
    await wrapper.get('[data-testid="expand-all-logs"]').trigger('click');
    expect(wrapper.findAll('details[open]')).toHaveLength(5);
  });

  it('刷新后按稳定 ID 保留展开状态', async () => {
    const wrapper = mount(LogList, { props: { blocks, loading: false } });
    await wrapper.get('[data-testid="collapse-all-logs"]').trigger('click');
    await wrapper.setProps({ blocks: [{ id: 'new', title: '新日志' }, ...blocks] });
    expect(wrapper.findAll('details[open]')).toHaveLength(0);
  });
});
