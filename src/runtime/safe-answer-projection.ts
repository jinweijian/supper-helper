import type {
  AnswerGoal,
  ClaimType,
  DiagnosticClaim,
  DiagnosticResult,
  EvidenceKind,
} from '../domain.js';
import { redactInternalPaths, redactSecretText } from '../redaction.js';
import { redactCompatibilitySentinels } from './safe-answer-redaction.js';

const REQUIRED_SEGMENT_LIMIT = 1000;
const SUPPORTING_SEGMENT_LIMIT = 600;
const PROMPT_SEGMENT_LIMIT = 300;
const PROMPT_ITEM_LIMIT = 5;

export type FrozenAnswerOutcome = 'final' | 'partial' | 'ask_user' | 'escalate';

export interface SafeAnswerSegment {
  id: string;
  text: string;
  type: ClaimType;
  evidenceIds: string[];
}

export interface SafeEvidenceSegment {
  id: string;
  kind: EvidenceKind;
  text: string;
  claimIds: string[];
}

export interface SafePromptSegment {
  id: string;
  text: string;
  source: 'unknown_claim' | 'missing_info';
}

export interface SafeFrozenAnswerProjection {
  answerTarget: string;
  outcome: FrozenAnswerOutcome;
  primary: SafeAnswerSegment[];
  supporting: SafeAnswerSegment[];
  actions: SafeAnswerSegment[];
  prompts: SafePromptSegment[];
  evidence: SafeEvidenceSegment[];
  requiredClaimIds: string[];
  requiredEvidenceIds: string[];
  omittedOptionalCount: number;
  blockerCodes: string[];
}

export interface VisiblePromptReview {
  status: 'accepted' | 'unknown';
  acceptedIds: string[];
}

export interface SafePresentationPlan {
  answerTarget?: unknown;
  claimIds?: unknown;
  directAnswerClaimIds?: unknown;
  actionClaimIds?: unknown;
  evidenceIds?: unknown;
}

export interface SafePresentationPlanValidation {
  accepted: boolean;
  order?: string[];
  reason?: string;
}

export {
  renderSafeFrozenAnswer,
  validateSafePresentationPlan,
} from './safe-answer-renderer.js';

export function collectVisiblePromptCandidates(input: {
  result: DiagnosticResult;
  acceptedClaimIds: string[];
}): SafePromptSegment[] {
  const acceptedIds = new Set(input.acceptedClaimIds);
  const prompts: SafePromptSegment[] = [];
  for (const claim of input.result.claims) {
    if (!claim.id || !acceptedIds.has(claim.id)) continue;
    if (claim.role !== 'unknown' && claim.type !== 'unknown') continue;
    const prompt = materializePrompt(`unknown:${claim.id}`, claim.text, 'unknown_claim');
    if (prompt) prompts.push(prompt);
  }
  input.result.missingInfo.forEach((text, index) => {
    const prompt = materializePrompt(`missing:${index + 1}`, text, 'missing_info');
    if (prompt) prompts.push(prompt);
  });
  return prompts.slice(0, 10);
}

export function buildSafeFrozenAnswerProjection(input: {
  result: DiagnosticResult;
  answerGoal: AnswerGoal;
  frozenPrimaryClaimIds: string[];
  acceptedClaimIds: string[];
  reviewedBindingClaimIds?: string[];
  visiblePromptReview?: VisiblePromptReview;
}): SafeFrozenAnswerProjection {
  const acceptedIds = new Set(input.acceptedClaimIds);
  const reviewedBindingIds = new Set(input.reviewedBindingClaimIds ?? []);
  const claimById = new Map(
    input.result.claims
      .filter((claim): claim is DiagnosticClaim & { id: string } => Boolean(claim.id) && acceptedIds.has(claim.id!))
      .map((claim) => [claim.id, claim]),
  );
  const blockerCodes: string[] = [];
  let omittedOptionalCount = 0;

  const frozenPrimaryIds = stableUnique(input.frozenPrimaryClaimIds);
  const preliminaryPrimaryIds = frozenPrimaryIds.length === 0 &&
    !(input.result.status === 'concluded' && input.result.recommendedNextAction === 'final_answer')
    ? [...claimById.values()]
        .filter((claim) => (
          claim.role === 'primary_answer' &&
          (claim.type === 'fact' || claim.type === 'inference') &&
          reviewedBindingIds.has(claim.id)
        ))
        .map((claim) => claim.id)
    : [];
  const primarySourceIds = frozenPrimaryIds.length > 0 ? frozenPrimaryIds : preliminaryPrimaryIds;
  const primary: SafeAnswerSegment[] = [];
  for (const id of primarySourceIds) {
    const claim = claimById.get(id);
    const segment = claim && materializeClaim(claim, REQUIRED_SEGMENT_LIMIT);
    if (!segment || claim?.role !== 'primary_answer') {
      blockerCodes.push('required_primary_materialization_failed');
      continue;
    }
    primary.push(segment);
  }

  const actions: SafeAnswerSegment[] = [];
  for (const claim of claimById.values()) {
    if (claim.role !== 'next_action' || !reviewedBindingIds.has(claim.id)) continue;
    const segment = materializeClaim(claim, REQUIRED_SEGMENT_LIMIT);
    if (!segment) {
      blockerCodes.push('required_action_materialization_failed');
      continue;
    }
    actions.push(segment);
  }

  const supporting: SafeAnswerSegment[] = [];
  for (const claim of claimById.values()) {
    if (
      claim.role !== 'supporting_context' ||
      (claim.type !== 'fact' && claim.type !== 'inference') ||
      !reviewedBindingIds.has(claim.id)
    ) {
      continue;
    }
    const segment = materializeClaim(claim, SUPPORTING_SEGMENT_LIMIT);
    if (!segment) {
      omittedOptionalCount += 1;
      continue;
    }
    supporting.push(segment);
  }

  const promptCandidates = collectVisiblePromptCandidates({
    result: input.result,
    acceptedClaimIds: input.acceptedClaimIds,
  });
  const promptReview = input.visiblePromptReview;
  const acceptedPromptIds = new Set(
    promptReview?.status === 'accepted' ? promptReview.acceptedIds : [],
  );
  const prompts = promptCandidates
    .filter((item) => acceptedPromptIds.has(item.id))
    .slice(0, PROMPT_ITEM_LIMIT);
  omittedOptionalCount += Math.max(0, promptCandidates.length - prompts.length);

  const requiredClaimIds = [...primary.map((item) => item.id), ...actions.map((item) => item.id)];
  const requiredEvidenceIds = stableUnique([
    ...primary.flatMap((item) => item.evidenceIds),
    ...actions.flatMap((item) => item.evidenceIds),
  ]);
  const evidenceById = new Map(input.result.evidence.map((item) => [item.id, item]));
  const visibleClaimByEvidence = new Map<string, SafeAnswerSegment[]>();
  for (const segment of [...primary, ...supporting, ...actions]) {
    for (const evidenceId of segment.evidenceIds) {
      const current = visibleClaimByEvidence.get(evidenceId) ?? [];
      current.push(segment);
      visibleClaimByEvidence.set(evidenceId, current);
    }
  }
  const evidence = [...visibleClaimByEvidence.entries()].flatMap(([id, claims]) => {
    const raw = evidenceById.get(id);
    if (!raw) {
      if (requiredEvidenceIds.includes(id)) blockerCodes.push('required_evidence_materialization_failed');
      return [];
    }
    const text = safeVisibleText(claims.map((item) => item.text).join('；'));
    if (!hasSubstantiveVisibleText(text) || codePointLength(text) > REQUIRED_SEGMENT_LIMIT) {
      if (requiredEvidenceIds.includes(id)) blockerCodes.push('required_evidence_materialization_failed');
      return [];
    }
    return [{
      id,
      kind: raw.kind,
      text,
      claimIds: claims.map((item) => item.id),
    }];
  });
  if (requiredEvidenceIds.some((id) => !evidence.some((item) => item.id === id))) {
    blockerCodes.push('required_evidence_materialization_failed');
  }

  let outcome = outcomeFromResult(input.result);
  if (blockerCodes.length > 0 || primary.length !== primarySourceIds.length) {
    outcome = input.result.recommendedNextAction === 'escalate_to_human' ? 'escalate' : 'partial';
  }
  if (outcome === 'ask_user' && prompts.length === 0) {
    outcome = 'partial';
    blockerCodes.push('visible_prompt_review_unavailable');
  }

  return {
    answerTarget: safeAnswerTarget(input.answerGoal.resolvedQuestion),
    outcome,
    primary,
    supporting,
    actions,
    prompts,
    evidence,
    requiredClaimIds,
    requiredEvidenceIds,
    omittedOptionalCount,
    blockerCodes: stableUnique(blockerCodes),
  };
}

function materializeClaim(claim: DiagnosticClaim & { id?: string }, limit: number): SafeAnswerSegment | undefined {
  if (!claim.id || (claim.type !== 'fact' && claim.type !== 'inference')) return undefined;
  const text = safeVisibleText(claim.text);
  if (!hasSubstantiveVisibleText(text) || codePointLength(text) > limit) return undefined;
  return {
    id: claim.id,
    text,
    type: claim.type,
    evidenceIds: stableUnique(claim.evidenceIds),
  };
}

function materializePrompt(
  id: string,
  value: string,
  source: SafePromptSegment['source'],
): SafePromptSegment | undefined {
  const text = safeVisibleText(value);
  if (!hasSubstantiveVisibleText(text) || codePointLength(text) > PROMPT_SEGMENT_LIMIT) return undefined;
  return { id, text, source };
}

function safeAnswerTarget(value: string): string {
  const safe = safeVisibleText(value);
  if (!hasSubstantiveVisibleText(safe)) return '当前问题';
  return Array.from(safe).slice(0, 160).join('');
}

function hasSubstantiveVisibleText(value: string): boolean {
  const withoutPlaceholders = value
    .replace(/\[(?:REDACTED|内部诊断信息已隐藏)\]/gi, '')
    .replace(/[\s，。；、,:：;.!！?？()（）\[\]{}]+/g, '');
  return /[\p{L}\p{N}]/u.test(withoutPlaceholders);
}

function safeVisibleText(value: string): string {
  return redactCompatibilitySentinels(redactInternalPaths(redactSecretText(value)))
    .replace(/\b(?:stdout|stderr|provider[_ -]?payload|worker[_ -]?trace)\s*[:=][^\n]*/gi, '[内部诊断信息已隐藏]')
    .replace(/\b(?:worker[_ -]?trace|provider[_ -]?payload)\b/gi, '内部诊断信息')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function outcomeFromResult(result: DiagnosticResult): FrozenAnswerOutcome {
  if (result.recommendedNextAction === 'escalate_to_human') return 'escalate';
  if (result.status === 'need_input' || result.recommendedNextAction === 'ask_user') return 'ask_user';
  if (result.status === 'concluded' && result.recommendedNextAction === 'final_answer') return 'final';
  return 'partial';
}

function stableUnique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}
