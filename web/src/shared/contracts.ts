export interface MessageDto {
  id: string;
  role: 'user' | 'helper';
  body: string;
  createdAt?: string;
  replyToMessageId?: string;
}

export interface RetryableTurnDto {
  userMessageId: string;
  interruptedAt: string;
  reason: 'service_restarted';
}

export interface SessionDto {
  id: string;
  title: string;
  status: string;
  workspaceId?: string;
  userPersona?: string;
  messages: MessageDto[];
  runs: Array<Record<string, unknown>>;
  pinnedAt?: string;
  archivedAt?: string;
  knowledgeHealth?: Record<string, unknown>;
  contextUsage?: { percent?: number; estimatedTokens?: number; limitTokens?: number; level?: string; available?: boolean };
  agentActivity?: Array<{ agentId?: string; agentName?: string; phase?: string; label?: string; summary?: string }>;
  retryableTurn?: RetryableTurnDto;
}

export type SessionSummaryDto = Omit<SessionDto, 'messages' | 'runs'> & {
  messages?: MessageDto[];
  runs?: Array<Record<string, unknown>>;
  lastMessage?: string;
};
