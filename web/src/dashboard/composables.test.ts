import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingUserMessageId, useChat } from './use-chat';
import { useKnowledge } from './use-knowledge';
import { useLogs } from './use-logs';
import { useSessions } from './use-sessions';
import { useSettings } from './use-settings';

const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
}));

describe('dashboard composables', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads a shared session route and updates history when switching', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ sessions: [{ id: 'case_a', title: 'A' }] }))
      .mockImplementation(() => response({ session: { id: 'case_a', title: 'A', messages: [], runs: [] } }));
    const history = { pushState: vi.fn(), replaceState: vi.fn() };
    const state = useSessions({ fetcher, history, initialPath: '/sessions/case_a' });
    await state.initialize();
    expect(state.current.value?.id).toBe('case_a');
    await state.open('case_a');
    expect(history.pushState).toHaveBeenLastCalledWith({}, '', '/sessions/case_a');
  });

  it('creates a session with the currently selected persona', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ session: { id: 'case_new', title: '新对话', status: 'collecting_input', messages: [], runs: [] } }))
      .mockImplementationOnce(() => response({ sessions: [] }));
    const state = useSessions({ fetcher, history: { pushState: vi.fn(), replaceState: vi.fn() }, initialPath: '/' });
    await state.create('developer');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ persona: 'developer' });
  });

  it('polls until the matching assistant response appears', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ accepted: true, caseId: 'case_a', userMessageId: 'msg_user' }, 202))
      .mockImplementationOnce(() => response({ session: { id: 'case_a', status: 'diagnosing', messages: [{ id: 'msg_user', role: 'user', body: '问题' }] } }))
      .mockImplementationOnce(() => response({ session: { id: 'case_a', status: 'concluded', messages: [{ id: 'msg_user', role: 'user', body: '问题' }, { id: 'msg_helper', role: 'helper', body: '答复', replyToMessageId: 'msg_user' }] } }));
    const chat = useChat({ fetcher, pollDelayMs: 0 });
    const session = await chat.send({ caseId: 'case_a', workspaceId: 'current', message: '问题', persona: 'operations' });
    expect(session.messages.at(-1)?.body).toBe('答复');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([, init]) => init?.signal instanceof AbortSignal)).toEqual([true, true, true]);
  });

  it('keeps polling across a transient terminal snapshot until the matching reply appears', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ session: {
        id: 'case_a',
        status: 'partial',
        messages: [{ id: 'msg_user', role: 'user', body: '问题' }],
      } }))
      .mockImplementationOnce(() => response({ session: {
        id: 'case_a',
        status: 'concluded',
        messages: [
          { id: 'msg_user', role: 'user', body: '问题' },
          { id: 'msg_helper', role: 'helper', body: '正式回复', replyToMessageId: 'msg_user' },
        ],
      } }));
    const chat = useChat({ fetcher, pollDelayMs: 0, maxPolls: 2 });
    await expect(chat.poll('case_a', 'msg_user')).resolves.toMatchObject({ status: 'concluded' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(chat.progress.value.state).toBe('completed');
  });

  it('interrupts immediately when the matching turn is explicitly retryable', async () => {
    const fetcher = vi.fn(() => response({ session: {
      id: 'case_a',
      status: 'partial',
      messages: [
        { id: 'msg_user', role: 'user', body: '问题' },
        {
          id: 'msg_interruption',
          role: 'helper',
          body: '这个回合因服务重启被中断。',
          replyToMessageId: 'msg_user',
        },
      ],
      retryableTurn: {
        userMessageId: 'msg_user',
        interruptedAt: '2026-07-26T00:00:00.000Z',
        reason: 'service_restarted',
      },
    } }));
    const chat = useChat({ fetcher, pollDelayMs: 0, maxPolls: 2 });
    await expect(chat.poll('case_a', 'msg_user')).rejects.toThrow('一键重试');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(chat.progress.value.state).toBe('interrupted');
  });

  it('aborts a pending chat request and clears operation-scoped UI when cancelled', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal ?? undefined;
      requestSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const chat = useChat({ fetcher });
    const pending = chat.send({ caseId: 'case_a', workspaceId: 'current', message: '问题', persona: 'operations' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    chat.error.value = '旧会话错误';
    chat.progress.value = {
      state: 'interrupted',
      error: '旧会话已中断',
      session: {
        status: 'partial',
        retryableTurn: {
          userMessageId: 'msg_user',
          interruptedAt: '2026-07-26T00:00:00.000Z',
          reason: 'service_restarted',
        },
      },
    };

    chat.cancel();

    expect(requestSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(chat.error.value).toBe('');
    expect(chat.progress.value).toEqual({ state: 'idle' });
  });

  it('does not let a late response from an older poll overwrite newer progress', async () => {
    let resolveOld!: (value: Response) => void;
    let oldSignal: AbortSignal | undefined;
    const fetcher = vi.fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
        oldSignal = init?.signal ?? undefined;
        resolveOld = resolve;
      }))
      .mockImplementationOnce(() => response({ session: {
        id: 'case_new',
        status: 'concluded',
        messages: [{ id: 'msg_new_reply', role: 'helper', body: '新回复', replyToMessageId: 'msg_new' }],
      } }));
    const chat = useChat({ fetcher, pollDelayMs: 0, maxPolls: 1 });
    const oldPoll = chat.poll('case_old', 'msg_old');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await expect(chat.poll('case_new', 'msg_new')).resolves.toMatchObject({ id: 'case_new' });
    expect(oldSignal?.aborted).toBe(true);

    resolveOld(await response({ session: {
      id: 'case_old',
      status: 'concluded',
      messages: [{ id: 'msg_old_reply', role: 'helper', body: '旧回复', replyToMessageId: 'msg_old' }],
    } }));
    await expect(oldPoll).rejects.toMatchObject({ name: 'AbortError' });
    expect(chat.progress.value).toMatchObject({ state: 'completed', session: { id: 'case_new' } });
  });

  it('does not surface a late error from an older send after newer progress completes', async () => {
    let rejectOld!: (reason: Error) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => {
        rejectOld = reject;
      }))
      .mockImplementationOnce(() => response({ session: {
        id: 'case_new',
        status: 'concluded',
        messages: [{ id: 'msg_new_reply', role: 'helper', body: '新回复', replyToMessageId: 'msg_new' }],
      } }));
    const chat = useChat({ fetcher, pollDelayMs: 0, maxPolls: 1 });
    const oldSend = chat.send({ caseId: 'case_old', workspaceId: 'current', message: '旧问题', persona: 'operations' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await expect(chat.poll('case_new', 'msg_new')).resolves.toMatchObject({ id: 'case_new' });

    rejectOld(new Error('旧请求错误'));
    await expect(oldSend).rejects.toMatchObject({ name: 'AbortError' });
    expect(chat.error.value).toBe('');
    expect(chat.progress.value).toMatchObject({ state: 'completed', session: { id: 'case_new' } });
  });

  it('does not surface a late error from an older retry after newer progress completes', async () => {
    let rejectOld!: (reason: Error) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => {
        rejectOld = reject;
      }))
      .mockImplementationOnce(() => response({ session: {
        id: 'case_new',
        status: 'concluded',
        messages: [{ id: 'msg_new_reply', role: 'helper', body: '新回复', replyToMessageId: 'msg_new' }],
      } }));
    const chat = useChat({ fetcher, pollDelayMs: 0, maxPolls: 1 });
    const oldRetry = chat.retry('case_old', 'msg_old');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await expect(chat.poll('case_new', 'msg_new')).resolves.toMatchObject({ id: 'case_new' });

    rejectOld(new Error('旧重试错误'));
    await expect(oldRetry).rejects.toMatchObject({ name: 'AbortError' });
    expect(chat.error.value).toBe('');
    expect(chat.progress.value).toMatchObject({ state: 'completed', session: { id: 'case_new' } });
  });

  it('surfaces a current retry HTTP failure as an interrupted progress state', async () => {
    const fetcher = vi.fn(() => response({ error: '重试请求失败' }, 503));
    const chat = useChat({ fetcher });
    const pending = chat.retry('case_a', 'msg_user');
    const { startedAt, lastActivityAt } = chat.progress.value;

    await expect(pending).rejects.toThrow('重试请求失败');
    expect(chat.error.value).toBe('重试请求失败');
    expect(chat.progress.value).toMatchObject({
      state: 'interrupted',
      error: '重试请求失败',
      startedAt,
      lastActivityAt,
    });
  });

  it('identifies the accepted user turn when a reloaded session is active', () => {
    expect(pendingUserMessageId({ id: 'case_a', title: 'A', status: 'diagnosing', runs: [], messages: [
      { id: 'msg_old', role: 'helper', body: '旧答复' },
      { id: 'msg_pending', role: 'user', body: '继续' },
    ] })).toBe('msg_pending');
  });

  it('identifies a retryable interrupted turn when a partial session is reloaded', () => {
    expect(pendingUserMessageId({
      id: 'case_retryable',
      title: '服务重启',
      status: 'partial',
      runs: [],
      messages: [
        { id: 'msg_user', role: 'user', body: '继续排查' },
        {
          id: 'msg_interruption',
          role: 'helper',
          body: '这个回合因服务重启被中断。',
          replyToMessageId: 'msg_user',
        },
      ],
      retryableTurn: {
        userMessageId: 'msg_user',
        interruptedAt: '2026-07-26T00:00:00.000Z',
        reason: 'service_restarted',
      },
    })).toBe('msg_user');
  });

  it('only loads logs when explicitly opened or refreshed', async () => {
    const fetcher = vi.fn(() => response({ blocks: [{ title: '运行' }] }));
    const logs = useLogs({ fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    await logs.open('case_a');
    expect(logs.blocks.value).toHaveLength(1);
    await logs.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('surfaces knowledge request errors without losing prior health', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ knowledgeHealth: { status: 'ready' } }))
      .mockImplementationOnce(() => response({ error: 'failed' }, 500));
    const knowledge = useKnowledge({ fetcher });
    await knowledge.check('current', '查询');
    await expect(knowledge.reindex('current', '查询')).rejects.toThrow('failed');
    await nextTick();
    expect(knowledge.health.value).toEqual({ status: 'ready' });
    expect(knowledge.error.value).toBe('failed');
  });

  it('loads offline local health separately and probes with the latest user question', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ knowledgeHealth: { status: 'local' } }))
      .mockImplementationOnce(() => response({ knowledgeHealth: { status: 'probed' } }));
    const knowledge = useKnowledge({ fetcher });
    await knowledge.loadLocalHealth('current');
    await knowledge.probe('current', '最新用户问题');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/knowledge/health?workspaceId=current&query=',
      '/api/knowledge/health?workspaceId=current&query=%E6%9C%80%E6%96%B0%E7%94%A8%E6%88%B7%E9%97%AE%E9%A2%98',
    ]);
  });

  it('loads, tests, and saves settings through their existing endpoints', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ model: { model: 'demo' } }))
      .mockImplementationOnce(() => response({ agents: [{ id: 'main' }] }))
      .mockImplementationOnce(() => response({ ok: true }))
      .mockImplementationOnce(() => response({ model: { model: 'next' } }));
    const settings = useSettings({ fetcher });
    await settings.load();
    await settings.testModel({ model: 'next' });
    await settings.saveModel({ model: 'next' });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/settings',
      '/api/agents',
      '/api/settings/model/test',
      '/api/settings/model',
    ]);
    expect(settings.actions.testModel.running).toBe(false);
  });

  it('treats an HTTP 200 smoke result with ok false as a visible failure', async () => {
    const settings = useSettings({ fetcher: vi.fn(() => response({ ok: false, error: '模型凭证无效' })) });
    await expect(settings.testModel({ model: 'bad' })).rejects.toThrow('模型凭证无效');
    expect(settings.actions.testModel.error).toBe('模型凭证无效');
    expect(settings.actions.testModel.running).toBe(false);
  });
});
