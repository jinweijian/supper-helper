import type { DiagnosticRequest, DiagnosticResult } from '../../domain.js';

export function normalizeWorkerDiagnosticResult(
  result: DiagnosticResult,
  request: DiagnosticRequest,
): DiagnosticResult {
  if (!result || !Array.isArray(result.claims) || !Array.isArray(result.evidence)) {
    return result;
  }
  const validEvidenceIds = new Set(result.evidence
    .map((evidence) => evidence?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0));
  const exactItems = request.answerGoal?.mustAnswerItems ?? [];
  const claims = result.claims.flatMap((claim) => {
    if (!claim || typeof claim !== 'object') return [];
    const raw = claim as typeof claim & {
      actionSafety?: unknown;
      executionStatus?: unknown;
    };
    const evidenceIds = Array.isArray(claim.evidenceIds)
      ? claim.evidenceIds.filter((id) => validEvidenceIds.has(id))
      : [];
    const answers = claim.role === 'primary_answer' || claim.role === 'next_action'
      ? exactItems.filter((item) => Array.isArray(claim.answers) && claim.answers.includes(item))
      : [];
    if (claim.role === 'next_action') {
      if (
        (raw.actionSafety !== 'read_only' && raw.actionSafety !== 'requires_authorization') ||
        raw.executionStatus !== 'proposed' ||
        evidenceIds.length === 0 ||
        answers.length === 0
      ) {
        return [];
      }
      const text = raw.actionSafety === 'requires_authorization'
        ? `待人工授权：${claim.text}`
        : claim.text;
      return [{ ...claim, text, evidenceIds, answers }];
    }
    return [{ ...claim, evidenceIds, answers }];
  });
  return {
    ...result,
    missingInfo: Array.isArray(result.missingInfo) ? [...result.missingInfo] : [],
    evidence: [...result.evidence],
    claims,
  };
}
