import type { DiagnosticRequest, DiagnosticResult } from '../../domain.js';
import { redactSecretText } from '../../redaction.js';

const MAX_SAFE_EXCERPT_CODE_POINTS = 1000;

export function currentWorkerCoverageEvidence(
  request: DiagnosticRequest,
  result: DiagnosticResult,
): NonNullable<import('../../domain.js').ClaudeWorkerResponse['coverageEvidence']> {
  return result.evidence.flatMap((item) => {
    if (
      (item.kind !== 'workspace' && item.kind !== 'log') ||
      item.confidence === 'low'
    ) {
      return [];
    }
    const safeText = safeWorkerExcerpt(item.summary);
    if (!safeText || Array.from(safeText).length > MAX_SAFE_EXCERPT_CODE_POINTS) {
      return [];
    }
    return [{
      evidenceId: item.id,
      kind: item.kind,
      safeText,
      runId: request.runId,
      validated: true,
    }];
  });
}

function safeWorkerExcerpt(value: string): string {
  return redactSecretText(value)
    .replace(/knowledge\/(?:_sources|faq|whitepapers)\/[^\s，。；)）\]]+/gi, '内部资料')
    .replace(/\/(?:Users|home)\/[^\s，。；)）\]]+/g, '内部路径')
    .replace(/[A-Za-z]:\\[^\s，。；)）\]]+/g, '内部路径')
    .replace(/\b(?:stdout|stderr|provider[_ -]?payload|worker[_ -]?trace)\s*[:=][^\n]*/gi, '[内部诊断信息已隐藏]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
