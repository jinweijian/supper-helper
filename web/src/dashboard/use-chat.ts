import { ref } from 'vue';
import { apiJson, jsonRequest, type Fetcher } from '../shared/api';
import type { SessionDto } from '../shared/contracts';
import type { ChatProgressState } from './chat-progress';

interface ChatOptions {
  fetcher?: Fetcher;
  pollDelayMs?: number;
  maxPolls?: number;
}

interface SendInput {
  caseId?: string;
  workspaceId: string;
  message: string;
  persona: string;
}

export function pendingUserMessageId(session: SessionDto): string | undefined {
  if (!['diagnosing', 'queued'].includes(session.status)) return undefined;
  return [...session.messages].reverse().find((message) => message.role === 'user')?.id;
}

export function useChat(options: ChatOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const sending = ref(false);
  const error = ref('');
  const progress = ref<ChatProgressState>({ state: 'idle' });

  async function send(input: SendInput, onSession?: (session: SessionDto) => void): Promise<SessionDto> {
    sending.value = true;
    error.value = '';
    progress.value = { state: 'running', startedAt: Date.now(), lastActivityAt: Date.now() };
    try {
      const accepted = await apiJson<{ caseId: string; userMessageId: string }>(
        fetcher,
        '/api/chat',
        jsonRequest('POST', { ...input, async: true }),
      );
      return await poll(accepted.caseId, accepted.userMessageId, onSession);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '发送失败';
      throw cause;
    } finally {
      sending.value = false;
    }
  }

  async function poll(caseId: string, userMessageId: string, onSession?: (session: SessionDto) => void): Promise<SessionDto> {
    if (progress.value.state !== 'running') progress.value = { state: 'running', startedAt: Date.now(), lastActivityAt: Date.now() };
    const maxPolls = options.maxPolls ?? 120;
    for (let index = 0; index < maxPolls; index += 1) {
      const body = await apiJson<{ session: SessionDto }>(fetcher, `/api/session?caseId=${encodeURIComponent(caseId)}&includeKnowledgeHealth=false`);
      progress.value = { ...progress.value, state: 'running', lastActivityAt: Date.now(), session: body.session };
      onSession?.(body.session);
      const reply = body.session.messages.find((message) =>
        message.role === 'assistant' && message.replyToMessageId === userMessageId,
      );
      const active = body.session.status === 'diagnosing' || body.session.status === 'queued';
      if (reply) { progress.value = { ...progress.value, state: 'completed', session: body.session }; return body.session; }
      if (!active) {
        const message = '回答已中断：诊断已停止但没有返回回复';
        progress.value = { ...progress.value, state: 'interrupted', session: body.session, error: message };
        throw new Error(message);
      }
      await delay(options.pollDelayMs ?? 500);
    }
    const message = '等待回复超时，请刷新会话重试';
    progress.value = { ...progress.value, state: 'interrupted', error: message };
    throw new Error(message);
  }

  return { sending, error, progress, send, poll };
}

function delay(milliseconds: number): Promise<void> {
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}
