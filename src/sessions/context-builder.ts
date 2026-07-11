import type { DiagnosticRequest } from '../domain.js';
import type { StoredCase } from './case-repository.js';
import { turnMessages, turnRuns, turnUserMessageCount } from './turn-context-snapshot.js';

export function buildDiagnosticRequestContext(
  caseSession: StoredCase,
  currentUserMessage: string,
): NonNullable<DiagnosticRequest['context']> {
  const previousRuns = turnRuns(caseSession)
    .filter((run) => Boolean(run.result))
    .slice(-3)
    .map((run) => ({
      runId: run.id,
      status: run.status,
      userGoal: truncateText(run.request?.userGoal ?? '', 1200),
      summary: truncateText(run.result?.summary ?? '', 1200),
      missingInfo: (run.result?.missingInfo ?? []).map((item) => truncateText(item, 300)),
      evidence: (run.result?.evidence ?? []).slice(0, 8).map((item) => ({
        ...item,
        source: truncateText(item.source, 300),
        summary: truncateText(item.summary, 600),
      })),
      claims: (run.result?.claims ?? []).slice(0, 10).map((claim) => ({
        ...claim,
        text: truncateText(claim.text, 700),
      })),
    }));

  const recentMessages = turnMessages(caseSession).slice(-8).map((message) => ({
    id: message.id,
    role: message.role,
    body: truncateText(message.body, 1600),
    createdAt: message.createdAt,
  }));

  const userMessageCount = turnUserMessageCount(caseSession);
  return {
    isFollowUp: userMessageCount > 1 || previousRuns.length > 0,
    currentUserMessage: truncateText(currentUserMessage, 1600),
    recentMessages,
    previousRuns,
  };
}

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
