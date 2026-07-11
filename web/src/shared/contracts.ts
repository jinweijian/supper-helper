export interface MessageDto {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  createdAt?: string;
  replyToMessageId?: string;
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
}

export type SessionSummaryDto = Omit<SessionDto, 'messages' | 'runs'> & {
  messages?: MessageDto[];
  runs?: Array<Record<string, unknown>>;
  lastMessage?: string;
};
