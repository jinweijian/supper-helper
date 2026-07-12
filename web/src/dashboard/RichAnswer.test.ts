import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RichAnswer from './RichAnswer.vue';

describe('回答富文本', () => {
  it('安全渲染强调、列表和代码且不执行 HTML', () => {
    const wrapper = mount(RichAnswer, { props: { text: '**结论**\n\n- 第一步\n- 第二步\n\n`代码`\n<script>alert(1)</script>' } });
    expect(wrapper.get('strong').text()).toBe('结论');
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual(['第一步', '第二步']);
    expect(wrapper.get('code').text()).toBe('代码');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
    expect(wrapper.text()).not.toContain('**');
  });
});
