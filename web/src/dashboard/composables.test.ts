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

  it('polls until the matching assistant response appears', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ accepted: true, caseId: 'case_a', userMessageId: 'msg_user' }, 202))
      .mockImplementationOnce(() => response({ session: { id: 'case_a', status: 'diagnosing', messages: [{ id: 'msg_user', role: 'user', body: '问题' }] } }))
      .mockImplementationOnce(() => response({ session: { id: 'case_a', status: 'concluded', messages: [{ id: 'msg_user', role: 'user', body: '问题' }, { id: 'msg_helper', role: 'assistant', body: '答复', replyToMessageId: 'msg_user' }] } }));
    const chat = useChat({ fetcher, pollDelayMs: 0 });
    const session = await chat.send({ caseId: 'case_a', workspaceId: 'current', message: '问题', persona: 'operations' });
    expect(session.messages.at(-1)?.body).toBe('答复');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('identifies the accepted user turn when a reloaded session is active', () => {
    expect(pendingUserMessageId({ id: 'case_a', title: 'A', status: 'diagnosing', runs: [], messages: [
      { id: 'msg_old', role: 'assistant', body: '旧答复' },
      { id: 'msg_pending', role: 'user', body: '继续' },
    ] })).toBe('msg_pending');
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

  it('loads, tests, and saves settings through their existing endpoints', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ model: { model: 'demo' } }))
      .mockImplementationOnce(() => response({ ok: true }))
      .mockImplementationOnce(() => response({ model: { model: 'next' } }));
    const settings = useSettings({ fetcher });
    await settings.load();
    await settings.testModel({ model: 'next' });
    await settings.saveModel({ model: 'next' });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/settings',
      '/api/settings/model/test',
      '/api/settings/model',
    ]);
  });
});
