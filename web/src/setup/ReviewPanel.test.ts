import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ReviewPanel from './ReviewPanel.vue';

function review(items = [warnItem('slice-1'), warnItem('slice-2')]) {
  return {
    required: true,
    pendingCount: items.filter((item) => item.qualitySeverity === 'warn').length,
    blockedCount: items.filter((item) => item.qualitySeverity === 'error').length,
    page: { returned: items.length, total: items.length },
    items,
  };
}

function warnItem(id: string) {
  return {
    id,
    sourceDocumentId: `source-${id}`,
    title: `审核切片 ${id}`,
    module: '用户登录',
    path: `knowledge/${id}.md`,
    qualitySeverity: 'warn',
    qualityStatus: 'warn',
    pipelineStatus: 'review_required',
    excerptPreview: `${id} 的内容摘要，包含可供审核的实际文本。`,
    issues: [{
      code: 'not_answer_bearing',
      severity: 'warn',
      message: '内容缺少完整结论',
      explanation: {
        reason: '原因：缺少完整结论。',
        impact: '影响：无法直接回答。',
        suggestion: '建议：补充操作步骤。',
        missingInfo: ['缺少适用版本'],
      },
    }],
  };
}

describe('Setup 审核面板', () => {
  it('展示切片摘要、状态和问题判断依据', () => {
    const wrapper = mount(ReviewPanel, { props: { review: review([warnItem('slice-1')]), loading: false } });

    expect(wrapper.text()).toContain('用户登录');
    expect(wrapper.text()).toContain('slice-1 的内容摘要');
    expect(wrapper.text()).toContain('warn');
    expect(wrapper.text()).toContain('review_required');
    expect(wrapper.text()).toContain('原因：缺少完整结论。');
    expect(wrapper.text()).toContain('影响：无法直接回答。');
    expect(wrapper.text()).toContain('建议：补充操作步骤。');
    expect(wrapper.text()).toContain('缺少适用版本');
  });

  it('全选和取消全选只影响当前页，并以显式 ID 批量提交', async () => {
    const wrapper = mount(ReviewPanel, { props: { review: review(), loading: false } });

    await wrapper.get('[data-testid="select-page"]').trigger('click');
    expect(wrapper.text()).toContain('已选 2 / 本页 2 条');
    await wrapper.get('[data-testid="approve-selected"]').trigger('click');

    expect(wrapper.emitted('submit')?.[0]).toEqual([{
      action: 'approve',
      ids: ['slice-1', 'slice-2'],
      notes: '',
    }]);

    await wrapper.get('[data-testid="clear-selection"]').trigger('click');
    expect(wrapper.get('[data-testid="approve-selected"]').attributes('disabled')).toBeDefined();
  });

  it('刷新和列表变化后不会提交不可见的旧选择', async () => {
    const wrapper = mount(ReviewPanel, { props: { review: review(), loading: false } });
    await wrapper.get('[data-testid="select-page"]').trigger('click');
    await wrapper.get('[data-testid="refresh-review"]').trigger('click');
    expect(wrapper.text()).toContain('已选 0 / 本页 2 条');

    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.setProps({ review: review([warnItem('slice-2')]) });
    await wrapper.get('[data-testid="approve-selected"]').trigger('click');

    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('选中错误级别项目时禁止发布并解释处理方式', async () => {
    const blocked = { ...warnItem('blocked-1'), qualitySeverity: 'error' };
    const wrapper = mount(ReviewPanel, { props: { review: review([blocked]), loading: false } });

    await wrapper.get('[data-testid="select-page"]').trigger('click');

    expect(wrapper.get('[data-testid="approve-selected"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('错误级别项目不能发布，请退回修改或选择不发布');
  });
});
