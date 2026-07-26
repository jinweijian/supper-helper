import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import ChatProgressCard from './ChatProgressCard.vue';

const appMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  chatError: '',
  initialize: vi.fn(async () => undefined),
  open: vi.fn(async () => undefined),
  sessionError: '',
  sessionSummaries: [] as Array<Record<string, unknown>>,
}));

vi.mock('./use-chat', async () => {
  const { ref } = await import('vue');
  return {
    pendingUserMessageId: () => undefined,
    useChat: () => ({
      sending: ref(false),
      error: ref(appMocks.chatError),
      progress: ref({ state: 'idle' }),
      send: vi.fn(),
      poll: vi.fn(),
      retry: vi.fn(),
      cancel: appMocks.cancel,
    }),
  };
});

vi.mock('./use-sessions', async () => {
  const { ref } = await import('vue');
  return {
    useSessions: () => ({
      sessions: ref(appMocks.sessionSummaries),
      current: ref(),
      loading: ref(false),
      error: ref(appMocks.sessionError),
      initialize: appMocks.initialize,
      list: vi.fn(),
      load: vi.fn(),
      open: appMocks.open,
      create: vi.fn(),
      action: vi.fn(),
      remove: vi.fn(),
    }),
  };
});

vi.mock('./use-knowledge', async () => {
  const { ref } = await import('vue');
  return {
    useKnowledge: () => ({
      health: ref(),
      error: ref(''),
      loading: ref(false),
      loadLocalHealth: vi.fn(),
      probe: vi.fn(),
      bind: vi.fn(),
      reindex: vi.fn(),
    }),
  };
});

vi.mock('./use-logs', async () => {
  const { ref } = await import('vue');
  return {
    useLogs: () => ({
      blocks: ref([]),
      loading: ref(false),
      error: ref(''),
      open: vi.fn(),
      refresh: vi.fn(),
    }),
  };
});

vi.mock('./use-settings', async () => {
  const { ref } = await import('vue');
  return {
    useSettings: () => ({
      value: ref({}),
      actions: { load: { running: false, status: '', error: '' } },
      load: vi.fn(),
    }),
  };
});

describe('进度卡', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appMocks.chatError = '';
    appMocks.sessionError = '';
    appMocks.sessionSummaries = [];
  });

  it('运行中显示进度语义，中断时没有活动动画', async () => {
    const wrapper = mount(ChatProgressCard, { props: { progress: { state: 'running', startedAt: Date.now() - 5_000, lastActivityAt: Date.now(), session: { status: 'diagnosing' } } } });
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBeDefined();
    expect(wrapper.text()).toContain('估计');
    await wrapper.setProps({ progress: { state: 'interrupted', startedAt: Date.now() - 5_000, lastActivityAt: Date.now(), error: '服务连接中断' } });
    expect(wrapper.text()).toContain('回答已中断');
    expect(wrapper.classes()).not.toContain('is-active');
  });

  it('可重试中断仍显示一键重试', async () => {
    const wrapper = mount(ChatProgressCard, {
      props: {
        progress: {
          state: 'interrupted',
          error: '服务重启中断',
          session: {
            status: 'partial',
            retryableTurn: {
              userMessageId: 'msg_user',
              interruptedAt: '2026-07-26T00:00:00.000Z',
              reason: 'service_restarted',
            },
          },
        },
      },
    });

    await wrapper.get('.retry-button').trigger('click');
    expect(wrapper.get('.retry-button').text()).toBe('一键重试');
    expect(wrapper.emitted('retry')).toHaveLength(1);
    wrapper.unmount();
  });
});

describe('Dashboard 聊天生命周期', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appMocks.chatError = '';
    appMocks.sessionError = '';
    appMocks.sessionSummaries = [];
  });

  function mountApp() {
    return mount(App, {
      global: {
        stubs: {
          AccessibleDrawer: true,
          AuditPage: true,
          LogList: true,
          SettingsForm: true,
        },
      },
    });
  }

  it('普通聊天错误只在 composer 内联显示，不渲染顶端错误横幅', async () => {
    appMocks.chatError = '聊天发送失败';
    const wrapper = mountApp();
    await flushPromises();

    expect(wrapper.find('.global-error').exists()).toBe(false);
    expect(wrapper.get('.composer .error-banner').text()).toBe('聊天发送失败');
    wrapper.unmount();
  });

  it('会话加载错误仍由顶端错误横幅显示', async () => {
    appMocks.sessionError = '会话加载失败';
    const wrapper = mountApp();
    await flushPromises();

    expect(wrapper.get('.global-error').text()).toBe('会话加载失败');
    expect(wrapper.find('.composer .error-banner').exists()).toBe(false);
    wrapper.unmount();
  });

  it('切换会话前取消旧聊天轮询', async () => {
    appMocks.sessionSummaries = [{ id: 'case_next', title: '下一个会话', status: 'collecting_input' }];
    const wrapper = mountApp();
    await flushPromises();
    appMocks.cancel.mockClear();
    appMocks.open.mockClear();

    await wrapper.get('.session-open').trigger('click');
    await flushPromises();

    expect(appMocks.cancel).toHaveBeenCalledTimes(1);
    expect(appMocks.cancel.mock.invocationCallOrder[0]).toBeLessThan(appMocks.open.mock.invocationCallOrder[0]!);
    wrapper.unmount();
  });

  it('popstate 重新初始化会话前取消旧聊天轮询', async () => {
    const wrapper = mountApp();
    await flushPromises();
    appMocks.cancel.mockClear();
    appMocks.initialize.mockClear();

    window.dispatchEvent(new PopStateEvent('popstate'));
    await flushPromises();

    expect(appMocks.cancel).toHaveBeenCalledTimes(1);
    expect(appMocks.cancel.mock.invocationCallOrder[0]).toBeLessThan(appMocks.initialize.mock.invocationCallOrder[0]!);
    wrapper.unmount();
  });

  it('组件卸载时取消旧聊天轮询', async () => {
    const wrapper = mountApp();
    await flushPromises();
    appMocks.cancel.mockClear();

    wrapper.unmount();

    expect(appMocks.cancel).toHaveBeenCalledTimes(1);
  });
});
