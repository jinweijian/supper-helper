import type {
  AnswerGoal,
  ClaimType,
  DiagnosticClaim,
  DiagnosticResult,
  EvidenceKind,
  UserPersona,
} from '../domain.js';
import { redactSecretText } from '../redaction.js';

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
  visiblePromptReview?: VisiblePromptReview;
}): SafeFrozenAnswerProjection {
  const acceptedIds = new Set(input.acceptedClaimIds);
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
          (claim.type === 'fact' || claim.type === 'inference')
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
    if (claim.role !== 'next_action') continue;
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
      (claim.type !== 'fact' && claim.type !== 'inference')
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
    if (!text || codePointLength(text) > REQUIRED_SEGMENT_LIMIT) {
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

export function renderSafeFrozenAnswer(input: {
  projection: SafeFrozenAnswerProjection;
  persona: UserPersona;
  plan?: SafePresentationPlan;
}): string {
  const projection = input.projection;
  const order = validPlanOrder(input.plan, projection);
  const primary = orderedSegments(projection.primary, order);
  const actions = orderedSegments(projection.actions, order);
  const supporting = projection.supporting;
  const lines: string[] = [];

  if (primary.length > 0) {
    const label = projection.outcome === 'final' ? '**结论：**' : '**初步判断：**';
    lines.push(...labeledLines(label, primary.map(formatClaimType)));
  } else {
    lines.push('**当前状态：** 现有安全证据不足，暂不能形成最终结论。');
  }

  const supportingFacts = supporting.filter((item) => item.type === 'fact');
  const supportingInferences = supporting.filter((item) => item.type === 'inference');
  if (supportingFacts.length > 0) {
    lines.push('', ...labeledLines('**已确认线索：**', supportingFacts.map((item) => item.text)));
  }
  if (supportingInferences.length > 0) {
    lines.push('', ...labeledLines('**推断线索：**', supportingInferences.map((item) => item.text)));
  }

  if (actions.length > 0) {
    lines.push('', ...labeledLines('**下一步：**', actions.map((item) => item.text)));
  } else {
    lines.push('', '**通用只读建议：** 在不修改配置或数据的前提下，核对当前状态并保留可复核记录。');
  }

  if (projection.prompts.length > 0) {
    lines.push('', ...labeledLines('**仍需确认：**', projection.prompts.map((item) => item.text)));
  }
  if (projection.outcome !== 'final') {
    lines.push('', '**证据状态：当前判断不能作为最终结论。**');
  }

  return wholeReplySafetyScan(lines.join('\n'));
}

function validPlanOrder(
  plan: SafePresentationPlan | undefined,
  projection: SafeFrozenAnswerProjection,
): string[] | undefined {
  if (!plan) return undefined;
  const claimIds = uniqueStrings(plan.claimIds);
  const directIds = uniqueStrings(plan.directAnswerClaimIds);
  const actionIds = uniqueStrings(plan.actionClaimIds);
  const evidenceIds = uniqueStrings(plan.evidenceIds);
  if (!claimIds || !directIds || !actionIds || !evidenceIds) return undefined;
  const requiredDirect = projection.primary.map((item) => item.id);
  const requiredActions = projection.actions.map((item) => item.id);
  if (!sameSet(directIds, requiredDirect) || !sameSet(actionIds, requiredActions)) return undefined;
  if ([...requiredDirect, ...requiredActions].some((id) => !claimIds.includes(id))) return undefined;
  if (projection.requiredEvidenceIds.some((id) => !evidenceIds.includes(id))) return undefined;
  const known = new Set([
    ...projection.primary,
    ...projection.supporting,
    ...projection.actions,
  ].map((item) => item.id));
  return claimIds.filter((id) => known.has(id));
}

function orderedSegments(items: SafeAnswerSegment[], order: string[] | undefined): SafeAnswerSegment[] {
  if (!order) return items;
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((left, right) => (
    (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function materializeClaim(claim: DiagnosticClaim & { id?: string }, limit: number): SafeAnswerSegment | undefined {
  if (!claim.id || (claim.type !== 'fact' && claim.type !== 'inference')) return undefined;
  const text = safeVisibleText(claim.text);
  if (!text || codePointLength(text) > limit) return undefined;
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
  if (!text || codePointLength(text) > PROMPT_SEGMENT_LIMIT) return undefined;
  return { id, text, source };
}

function safeAnswerTarget(value: string): string {
  const safe = safeVisibleText(value);
  if (!safe) return '当前问题';
  return Array.from(safe).slice(0, 160).join('');
}

function safeVisibleText(value: string): string {
  return redactInternalPaths(redactSecretText(value))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function redactInternalPaths(value: string): string {
  return value
    .replace(/knowledge\/(?:_sources|faq|whitepapers)\/[^\s，。；)）\]]+/gi, '内部资料')
    .replace(/\/(?:Users|home)\/[^\s，。；)）\]]+/g, '内部路径')
    .replace(/[A-Za-z]:\\[^\s，。；)）\]]+/g, '内部路径');
}

function wholeReplySafetyScan(value: string): string {
  return redactInternalPaths(redactSecretText(value))
    .replace(/\b(?:stdout|stderr|provider[_ -]?payload|worker[_ -]?trace)\s*[:=][^\n]*/gi, '[内部诊断信息已隐藏]');
}

function outcomeFromResult(result: DiagnosticResult): FrozenAnswerOutcome {
  if (result.recommendedNextAction === 'escalate_to_human') return 'escalate';
  if (result.status === 'need_input' || result.recommendedNextAction === 'ask_user') return 'ask_user';
  if (result.status === 'concluded' && result.recommendedNextAction === 'final_answer') return 'final';
  return 'partial';
}

function formatClaimType(segment: SafeAnswerSegment): string {
  return segment.type === 'inference' ? `（推断）${segment.text}` : segment.text;
}

function labeledLines(label: string, texts: string[]): string[] {
  if (texts.length === 1) return [`${label} ${texts[0]}`];
  return [label, ...texts.map((text) => `- ${text}`)];
}

function uniqueStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined;
  return stableUnique(value);
}

function stableUnique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}
