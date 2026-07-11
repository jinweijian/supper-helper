import type { CaseStatus, UserPersona } from './base.js';
import type { DiagnosticLogEvent, DiagnosticRun } from './diagnostic.js';

export interface CaseSession {
  id: string;
  claudeSessionId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  title: string;
  status: CaseStatus;
  userPersona: UserPersona;
  messages: CaseMessage[];
  runs: DiagnosticRun[];
  logs: DiagnosticLogEvent[];
  pinnedAt?: string;
  archivedAt?: string;
}

export interface CaseMessage {
  id: string;
  role: 'user' | 'helper' | 'system';
  body: string;
  createdAt: string;
  replyToMessageId?: string;
}
