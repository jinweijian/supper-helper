import { ref } from 'vue';
import { apiJson, jsonRequest, type Fetcher } from '../shared/api';
import type { SessionDto } from '../shared/contracts';

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

  async function send(input: SendInput): Promise<SessionDto> {
    sending.value = true;
    error.value = '';
    try {
      const accepted = await apiJson<{ caseId: string; userMessageId: string }>(
        fetcher,
        '/api/chat',
        jsonRequest('POST', { ...input, async: true }),
      );
      return await poll(accepted.caseId, accepted.userMessageId);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '发送失败';
      throw cause;
    } finally {
      sending.value = false;
    }
  }

  async function poll(caseId: string, userMessageId: string): Promise<SessionDto> {
    const maxPolls = options.maxPolls ?? 120;
    for (let index = 0; index < maxPolls; index += 1) {
      const body = await apiJson<{ session: SessionDto }>(fetcher, `/api/session?caseId=${encodeURIComponent(caseId)}&includeKnowledgeHealth=false`);
      const reply = body.session.messages.find((message) =>
        message.role === 'assistant' && message.replyToMessageId === userMessageId,
      );
      const active = body.session.status === 'diagnosing' || body.session.status === 'queued';
      if (reply || !active) return body.session;
      await delay(options.pollDelayMs ?? 500);
    }
    throw new Error('等待回复超时，请刷新会话重试');
  }

  return { sending, error, send, poll };
}

function delay(milliseconds: number): Promise<void> {
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}
