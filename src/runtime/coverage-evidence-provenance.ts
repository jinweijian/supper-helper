import type { Evidence, EvidenceKind } from '../domain.js';
import { redactSecretText } from '../redaction.js';
import type {
  CoverageEvidenceProvenance,
  CoverageFreshness,
} from './answer-coverage.js';

export interface CoverageEvidenceEnvelope {
  evidenceId: string;
  kind: EvidenceKind;
  safeText: string;
  freshness: CoverageFreshness;
  validated: boolean;
  runId?: string;
  sourceMessageId?: string;
  generationId?: string;
  currentGenerationId?: string;
  strictEligible?: boolean;
  readOnly?: boolean;
  allowlisted?: boolean;
  completed?: boolean;
}

export function resolveCoverageEvidenceProvenance(input: {
  evidence: Evidence[];
  envelopes: CoverageEvidenceEnvelope[];
  currentRunId: string;
  currentSourceMessageIds: string[];
}): Record<string, CoverageEvidenceProvenance | undefined> {
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const currentMessageIds = new Set(input.currentSourceMessageIds);
  const resolved: Record<string, CoverageEvidenceProvenance | undefined> = Object.fromEntries(
    input.evidence.map((item) => [item.id, undefined]),
  );

  for (const envelope of input.envelopes) {
    const item = evidenceById.get(envelope.evidenceId);
    if (
      !item ||
      item.kind !== envelope.kind ||
      !envelope.validated ||
      !eligibleEnvelope(envelope, input.currentRunId, currentMessageIds)
    ) {
      continue;
    }
    const safeText = normalizeCoverageSafeText(envelope.safeText);
    if (!safeText) continue;
    resolved[item.id] = {
      freshness: envelope.freshness,
      safeText,
    };
  }
  return resolved;
}

export function normalizeCoverageSafeText(value: string): string {
  return redactSecretText(value)
    .replace(/knowledge\/(?:_sources|faq|whitepapers)\/[^\s，。；)）\]]+/gi, '内部资料')
    .replace(/\/(?:Users|home)\/[^\s，。；)）\]]+/g, '内部路径')
    .replace(/[A-Za-z]:\\[^\s，。；)）\]]+/g, '内部路径')
    .replace(/\b(?:stdout|stderr|provider[_ -]?payload|worker[_ -]?trace)\s*[:=][^\n]*/gi, '[内部诊断信息已隐藏]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function eligibleEnvelope(
  envelope: CoverageEvidenceEnvelope,
  currentRunId: string,
  currentMessageIds: Set<string>,
): boolean {
  if (envelope.kind === 'workspace') {
    return envelope.freshness === 'current_worker_run' &&
      envelope.runId === currentRunId;
  }
  if (envelope.kind === 'log') {
    return envelope.freshness === 'current_log_excerpt' &&
      envelope.runId === currentRunId;
  }
  if (envelope.kind === 'mcp') {
    return envelope.freshness === 'current_mcp_call' &&
      envelope.runId === currentRunId &&
      envelope.readOnly === true &&
      envelope.allowlisted === true &&
      envelope.completed === true;
  }
  if (envelope.kind === 'manual') {
    return envelope.freshness === 'current_user_message' &&
      typeof envelope.sourceMessageId === 'string' &&
      currentMessageIds.has(envelope.sourceMessageId);
  }
  if (envelope.kind === 'knowledge') {
    return envelope.freshness === 'current_knowledge_v4' &&
      envelope.strictEligible === true &&
      Boolean(envelope.generationId) &&
      envelope.generationId === envelope.currentGenerationId;
  }
  return false;
}
