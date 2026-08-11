import type { UserPersona } from '../domain.js';
import { redactInternalPaths, redactSecretText } from '../redaction.js';
import { redactCompatibilitySentinels } from './safe-answer-redaction.js';
import type {
  SafeAnswerSegment,
  SafeFrozenAnswerProjection,
  SafePresentationPlan,
  SafePresentationPlanValidation,
} from './safe-answer-projection.js';

export function renderSafeFrozenAnswer(input: {
  projection: SafeFrozenAnswerProjection;
  persona: UserPersona;
  plan?: SafePresentationPlan;
}): string {
  const projection = input.projection;
  const order = validateSafePresentationPlan(input.plan, projection).order;
  const primary = projection.primary;
  const actions = projection.actions;
  const supporting = orderedSegments(projection.supporting, order);
  const lines: string[] = [
    `**针对你的问题：** ${projection.answerTarget}`,
    '',
  ];

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

export function validateSafePresentationPlan(
  plan: SafePresentationPlan | undefined,
  projection: SafeFrozenAnswerProjection,
): SafePresentationPlanValidation {
  if (!plan) return { accepted: false, reason: 'presentation_plan_missing' };
  const claimIds = uniqueStrings(plan.claimIds);
  const directIds = uniqueStrings(plan.directAnswerClaimIds);
  const actionIds = uniqueStrings(plan.actionClaimIds);
  const evidenceIds = uniqueStrings(plan.evidenceIds);
  if (!claimIds || !directIds || !actionIds || !evidenceIds) {
    return { accepted: false, reason: 'presentation_plan_malformed' };
  }
  const requiredDirect = projection.primary.map((item) => item.id);
  const requiredActions = projection.actions.map((item) => item.id);
  if (!sameOrder(directIds, requiredDirect) || !sameOrder(actionIds, requiredActions)) {
    return { accepted: false, reason: 'presentation_required_set_mismatch' };
  }
  if ([...requiredDirect, ...requiredActions].some((id) => !claimIds.includes(id))) {
    return { accepted: false, reason: 'presentation_required_claim_incomplete' };
  }
  if (projection.requiredEvidenceIds.some((id) => !evidenceIds.includes(id))) {
    return { accepted: false, reason: 'presentation_required_evidence_incomplete' };
  }
  const known = new Set([
    ...projection.primary,
    ...projection.supporting,
    ...projection.actions,
  ].map((item) => item.id));
  return {
    accepted: true,
    order: claimIds.filter((id) => known.has(id)),
  };
}

function orderedSegments(items: SafeAnswerSegment[], order: string[] | undefined): SafeAnswerSegment[] {
  if (!order) return items;
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((left, right) => (
    (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function wholeReplySafetyScan(value: string): string {
  return redactCompatibilitySentinels(redactInternalPaths(redactSecretText(value)))
    .replace(/\b(?:stdout|stderr|provider[_ -]?payload|worker[_ -]?trace)\s*[:=][^\n]*/gi, '[内部诊断信息已隐藏]')
    .replace(/\b(?:worker[_ -]?trace|provider[_ -]?payload)\b/gi, '内部诊断信息');
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
  return Array.from(new Set(value));
}

function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
