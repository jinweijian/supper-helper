import { configuredWorkspaceId, type SuperHelperConfig } from '../config.js';
import type { UserPersona } from '../domain.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import type { AcceptedUserTurn } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { personaGuide, personaName } from './persona.js';

export class SessionLifecycle {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly store: CaseRepository,
    private readonly events: CaseRuntimeEventRecorder,
  ) {}

  loadCase(caseId: string): StoredCase | undefined {
    return this.store.loadCase(caseId);
  }

  requireActiveCase(caseId: string): StoredCase {
    const caseSession = this.store.loadCase(caseId);
    if (!caseSession) {
      throw new Error(`case ${caseId} not found`);
    }
    if (caseSession.archivedAt) {
      throw new Error('session is archived and cannot continue');
    }
    return caseSession;
  }

  startUserTurn(input: {
    caseId?: string;
    message: string;
    workspaceId?: string;
    persona?: UserPersona;
  }): AcceptedUserTurn {
    const caseSession = this.loadOrCreateCase(input);
    if (caseSession.archivedAt) {
      throw new Error('session is archived and cannot continue');
    }
    if (input.persona) {
      caseSession.userPersona = input.persona;
    } else {
      caseSession.userPersona ??= this.config.agent.defaultUserPersona;
    }
    if (caseSession.messages.length === 0) {
      this.events.conversationStarted(caseSession);
    }
    if (isGenericTitle(caseSession.title)) {
      caseSession.title = titleFromMessage(input.message);
    }
    const userMessage = this.store.addMessage(caseSession, { role: 'user', body: input.message });
    this.events.inputReceived(caseSession, input.message);
    this.events.personaApplied(caseSession, personaName(caseSession.userPersona), personaGuide(caseSession.userPersona));
    this.events.inputReviewStarted(caseSession, input.message);
    caseSession.status = 'ready_for_diagnosis';
    this.store.saveCase(caseSession);
    return { caseSession, userMessageId: userMessage.id };
  }

  userMessageBody(caseSession: StoredCase, userMessageId: string): string {
    const message = caseSession.messages.find((item) => item.id === userMessageId && item.role === 'user');
    if (!message) {
      throw new Error(`user message ${userMessageId} not found in case ${caseSession.id}`);
    }
    return message.body;
  }

  recordTurnFailure(caseId: string, error: unknown, replyToMessageId?: string): void {
    const caseSession = this.store.loadCase(caseId);
    if (!caseSession) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const reply = `请求中断了，我没有继续假装思考。\n\n原因：${message}\n\n请打开“查看诊断日志”查看卡在哪一步。`;
    this.events.turnFailed(caseSession, message);
    this.store.addMessage(caseSession, { role: 'helper', body: reply, replyToMessageId });
    caseSession.status = 'partial';
    this.store.saveCase(caseSession);
  }

  private loadOrCreateCase(input: { caseId?: string; message: string; workspaceId?: string }): StoredCase {
    if (input.caseId) {
      const existing = this.store.loadCase(input.caseId);
      if (existing) {
        return existing;
      }
    }

    const workspaceId = configuredWorkspaceId(this.config, input.workspaceId);
    return this.store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId,
      title: titleFromMessage(input.message),
    });
  }
}

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 30 ? `${compact.slice(0, 30)}...` : compact || '新的诊断';
}

function isGenericTitle(title: string): boolean {
  return ['新对话', '新的诊断'].includes(title.trim());
}
