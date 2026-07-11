import type { CaseMessage, CaseSession, DiagnosticRun } from '../domain.js';

const cutoffByCase = new WeakMap<CaseSession, string>();

export function bindTurnContextCutoff(caseSession: CaseSession, userMessageId: string): void {
  cutoffByCase.set(caseSession, userMessageId);
}

export function clearTurnContextCutoff(caseSession: CaseSession): void {
  cutoffByCase.delete(caseSession);
}

export function turnContextCutoff(caseSession: CaseSession): string | undefined {
  return cutoffByCase.get(caseSession);
}

function cutoffMessageIndex(caseSession: CaseSession): number {
  const cutoff = cutoffByCase.get(caseSession);
  if (!cutoff) return -1;
  return caseSession.messages.findIndex((message) => message.id === cutoff);
}

export function turnMessages(caseSession: CaseSession): CaseMessage[] {
  const index = cutoffMessageIndex(caseSession);
  if (index === -1) return caseSession.messages;
  return caseSession.messages.slice(0, index + 1);
}

export function turnUserMessages(caseSession: CaseSession): CaseMessage[] {
  return turnMessages(caseSession).filter((message) => message.role === 'user');
}

export function turnUserMessageCount(caseSession: CaseSession): number {
  return turnUserMessages(caseSession).length;
}

export function turnRuns(caseSession: CaseSession): DiagnosticRun[] {
  const index = cutoffMessageIndex(caseSession);
  if (index === -1) return caseSession.runs;
  const allowedMessageIds = new Set(caseSession.messages.slice(0, index + 1).map((message) => message.id));
  return caseSession.runs.filter((run) => {
    const sourceIds = run.request?.answerGoal?.sourceMessageIds ?? [];
    if (sourceIds.length === 0) return true;
    return sourceIds.every((id) => allowedMessageIds.has(id));
  });
}
