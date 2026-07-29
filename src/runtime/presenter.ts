import type { AnswerGoal, DiagnosticClaim, DiagnosticRequest, DiagnosticResult, UserPersona, WorkerTrace } from '../domain.js';
import { validateDiagnosticResult } from './result-validator.js';

export interface ReviewFormatContext {
  answerGoal?: AnswerGoal;
  ragAnswerability?: NonNullable<NonNullable<DiagnosticRequest['context']>['knowledge']>['answerability'];
}

export function formatPreflightQuestion(question: string, missingInfo: string[]): string {
  return `我现在还不能判断原因，缺少关键信息：${missingInfo.join('、')}。\n\n${question}`;
}

export interface PresentationPlan {
  claimIds: string[];
  evidenceIds: string[];
  directAnswerClaimIds: string[];
}

export function renderPresentationPlan(input: {
  plan: PresentationPlan;
  result: DiagnosticResult;
  persona: UserPersona;
}): string {
  const { plan, result, persona } = input;
  const claimsById = new Map(result.claims.map((claim) => [claim.id!, claim]));
  const selectedClaims = plan.claimIds
    .map((id) => claimsById.get(id))
    .filter((claim): claim is DiagnosticClaim => Boolean(claim))
    .filter((claim) => claim.role !== 'process_note');

  const primaryClaims = selectedClaims.filter(isPrimaryAnswerClaim);
  const supportingClaims = selectedClaims.filter(
    (claim) => !isPrimaryAnswerClaim(claim) && (claim.type === 'fact' || claim.type === 'inference'),
  );
  const nextActionClaims = selectedClaims.filter((claim) => claim.role === 'next_action');
  const unknownClaims = selectedClaims.filter((claim) => claim.type === 'unknown');

  const lines: string[] = [];
  const conclusionClaims = primaryClaims.length > 0 ? primaryClaims : supportingClaims;

  const isPartial = result.recommendedNextAction !== 'final_answer' || result.status !== 'concluded' || primaryClaims.length === 0;
  const conclusionLabel = isPartial ? '初步判断' : '结论';
  lines.push(...renderLabeledClaims(`**${conclusionLabel}：**`, conclusionClaims.map((claim) => sanitizeForPersona(claim.text, persona)), '当前没有通过审核的事实结论。'));

  if (supportingClaims.length > 0 && primaryClaims.length > 0) {
    lines.push('', ...renderLabeledClaims('**定位依据：**', supportingClaims.map((claim) => sanitizeForPersona(claim.text, persona)), ''));
  }

  if (nextActionClaims.length > 0) {
    lines.push('', ...renderLabeledClaims('**下一步：**', nextActionClaims.map((claim) => claim.text), ''));
  }

  if (unknownClaims.length > 0) {
    lines.push('', ...renderLabeledClaims('**未知项：**', unknownClaims.map((claim) => claim.text), ''));
  }

  if (result.missingInfo.length > 0) {
    lines.push('', `**仍需确认：** ${result.missingInfo.join('、')}`);
  }

  return lines.join('\n');
}

function renderLabeledClaims(label: string, texts: string[], emptyText: string): string[] {
  const items = texts.filter(Boolean);
  if (items.length === 0) return emptyText ? [`${label} ${emptyText}`] : [];
  if (items.length === 1) return [`${label} ${items[0]}`];
  return [label, ...items.map((text) => `- ${text}`)];
}

function sanitizeForPersona(text: string, persona: UserPersona): string {
  if (persona === 'developer') return text;
  return redactInternalKnowledgePath(text)
    .replace(/\bsrc\/[^\s，。；)）]+/g, '相关系统位置')
    .replace(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g, '相关系统配置');
}

export function ruleBasedReviewAndFormat(
  result: DiagnosticResult,
  persona: UserPersona,
  userGoal?: string,
  context?: ReviewFormatContext,
): string {
  result = validateDiagnosticResult(result, context?.answerGoal).result;
  const unsupportedFacts = result.claims.filter((claim) => claim.type === 'fact' && claim.evidenceIds.length === 0);
  const supportedClaims = result.claims.filter((claim) => claim.type !== 'fact' || claim.evidenceIds.length > 0);
  const primaryClaims = selectGroundedPrimaryClaims(supportedClaims);
  if (unsupportedFacts.length > 0 && supportedClaims.length === 0) {
    return '目前证据不足，暂不能形成结论。\n\n**仍需确认：** 缺少可验证的 medium/high confidence 证据。\n\n**下一步：** 请补充更多可验证信息，或查看诊断日志让技术支持复核。';
  }

  if (result.recommendedNextAction === 'ask_user' || result.status === 'need_input') {
    const missing = result.missingInfo.length > 0 ? result.missingInfo.join('、') : '可验证证据';
    if (result.status !== 'need_input' && (result.evidence.length > 0 || supportedClaims.length > 0)) {
      return formatPersonaReply({
        persona,
        conclusions: primaryClaims.length > 0 ? primaryClaims : ['现有证据仍不足以形成事实结论'],
        result,
        mode: 'partial',
        missing,
      });
    }
    return formatPersonaReply({
      persona,
      conclusions: ['目前证据不足，还不能最终定位'],
      result,
      mode: 'need_input',
      missing,
    });
  }

  const groundedConclusions = primaryClaims.length > 0 ? primaryClaims : ['当前没有通过审核的事实结论'];
  const mode = isFinalReviewedAnswer(result, supportedClaims) ? 'final' : 'partial';
  return formatPersonaReply({
    persona,
    conclusions: groundedConclusions,
    result,
    mode,
    missing: result.missingInfo.join('、'),
    unsupportedFacts,
  });
}

function isFinalReviewedAnswer(result: DiagnosticResult, supportedClaims: DiagnosticClaim[]): boolean {
  if (result.status !== 'concluded' || result.recommendedNextAction !== 'final_answer') {
    return false;
  }
  return supportedClaims.some(isPrimaryAnswerClaim);
}

function isPrimaryAnswerClaim(claim: DiagnosticClaim): boolean {
  return claim.role === 'primary_answer' && Array.isArray(claim.answers) && claim.answers.length > 0;
}

function selectGroundedPrimaryClaims(supportedClaims: DiagnosticClaim[]): string[] {
  const eligible = supportedClaims.filter((claim) => claim.role !== 'process_note');
  const primaryClaims = eligible
    .filter(isPrimaryAnswerClaim)
    .map((claim) => claim.text)
    .filter(Boolean);
  if (primaryClaims.length > 0) {
    const supportingClaims = eligible
      .filter((claim) => !isPrimaryAnswerClaim(claim) && (claim.type === 'fact' || claim.type === 'inference'))
      .map((claim) => claim.text)
      .filter(Boolean);
    return [...primaryClaims, ...supportingClaims];
  }
  const fallback = eligible.find((claim) => claim.type === 'fact' || claim.type === 'inference')?.text;
  return fallback ? [fallback] : [];
}

export function formatReviewFailureFallback(
  result: DiagnosticResult,
  persona: UserPersona,
  userGoal: string | undefined,
  trace: WorkerTrace | undefined,
  _reviewError: string,
  identity?: { caseId: string; runId: string },
): string {
  if (trace && workerFailedBeforeResult(trace)) {
    return formatWorkerFailureResult(result, trace, identity);
  }

  return ruleBasedReviewAndFormat(result, persona, userGoal);
}

export function personaName(persona: UserPersona): string {
  const names: Record<UserPersona, string> = {
    operations: '运营人员',
    support: '技术支持',
    customer: '客户',
    developer: '开发人员',
  };
  return names[persona] ?? names.operations;
}

export function personaGuide(persona: UserPersona): Record<string, string> {
  const guides: Record<UserPersona, Record<string, string>> = {
    operations: {
      focus: '配置入口、业务影响、可执行下一步',
      avoid: '避免把代码路径作为主叙事，必要时只放在证据里',
      askFor: '页面、课程/订单/用户等业务对象、现象截图或时间范围',
    },
    support: {
      focus: '复现信息、影响范围、排查路径、需要转交给研发的证据',
      avoid: '避免无证据定责',
      askFor: '账号角色、环境、URL、报错信息、复现步骤',
    },
    customer: {
      focus: '发生了什么、能做什么、什么时候需要人工介入',
      avoid: '避免内部系统名和代码细节',
      askFor: '页面、操作步骤、看到的提示',
    },
    developer: {
      focus: '代码路径、调用链、状态变化、证据置信度',
      avoid: '避免省略关键技术证据',
      askFor: '接口、日志、文件路径、复现条件',
    },
  };
  return guides[persona] ?? guides.operations;
}

type ReplyMode = 'final' | 'partial' | 'need_input';

function formatPersonaReply(input: {
  persona: UserPersona;
  conclusions: string[];
  result: DiagnosticResult;
  mode: ReplyMode;
  missing?: string;
  unsupportedFacts?: DiagnosticClaim[];
}): string {
  const missing = missingForMode(input.result, input.missing, input.mode);
  const conclusions = input.conclusions.map((text) => stripPreliminaryPrefix(text));
  switch (input.persona) {
    case 'developer':
      return developerReply(conclusions, input.result, input.mode, missing, input.unsupportedFacts ?? []);
    case 'support':
      return supportReply(conclusions, input.result, input.mode, missing, input.unsupportedFacts ?? []);
    case 'customer':
      return customerReply(conclusions, input.result, input.mode, missing);
    case 'operations':
    default:
      return operationsReply(conclusions, input.result, input.mode, missing, input.unsupportedFacts ?? []);
  }
}

function conclusionLines(label: string, items: string[]): string[] {
  const texts = items.filter(Boolean);
  if (texts.length === 0) return [];
  if (texts.length === 1) return [`${label} ${texts[0]}`];
  return [label, ...texts.map((text) => `- ${text}`)];
}

function operationsReply(
  conclusions: string[],
  result: DiagnosticResult,
  mode: ReplyMode,
  missing: string,
  unsupportedFacts: DiagnosticClaim[],
): string {
  const safeConclusions = conclusions.map(redactInternalKnowledgePath);
  const category = mode === 'need_input' ? '目前不能确认' : operationsCategory(safeConclusions.join('；'), result);
  const lines = conclusionLines(`**${mode === 'partial' ? '初步判断' : '结论'}：**`, safeConclusions);
  appendEvidenceStatus(lines, mode);
  if (mode !== 'final') {
    lines.push(
      '',
      `**对业务的影响：** ${operationsImpact(category, mode)}`,
      '',
      '**你可以怎么处理：**',
      '1. 先按上面的结论回复或处理当前业务问题。',
      '2. 如果现场现象和这个判断不一致，带上页面、角色、时间范围和现象截图升级给技术支持。',
    );
  }
  appendMissing(lines, missing, mode);
  appendUnsupported(lines, unsupportedFacts, redactInternalKnowledgePath);
  return lines.join('\n');
}

function developerReply(
  conclusions: string[],
  result: DiagnosticResult,
  mode: ReplyMode,
  missing: string,
  unsupportedFacts: DiagnosticClaim[],
): string {
  const evidence = result.evidence[0];
  const source = evidence?.source ? `先查 ${redactInternalKnowledgePath(evidence.source)}` : '先查与问题直接相关的入口、接口、日志或配置';
  const basis = evidence?.summary ?? result.summary;
  const lines = conclusionLines(`**${mode === 'partial' ? '初步判断' : '结论'}：**`, conclusions);
  appendEvidenceStatus(lines, mode);
  lines.push('', `**定位依据：** ${basis || '当前还没有足够证据形成定位依据。'}`);
  if (mode !== 'final') {
    lines.push(
      '',
      '**下一步排查：**',
      `1. ${source}。`,
      '2. 用同一复现条件确认代码路径、配置值或日志是否一致。',
      `3. ${missing ? `补充 ${missing} 后再确认边界。` : '如果仍不一致，再补充 trace、请求参数、环境和版本信息。'}`,
    );
  }
  appendRisk(lines, missing, mode);
  appendUnsupported(lines, unsupportedFacts);
  return lines.join('\n');
}

function supportReply(
  conclusions: string[],
  result: DiagnosticResult,
  mode: ReplyMode,
  missing: string,
  unsupportedFacts: DiagnosticClaim[],
): string {
  const lines = conclusionLines(`**${mode === 'partial' ? '初步判断' : '结论'}：**`, conclusions);
  appendEvidenceStatus(lines, mode);
  lines.push(
    '',
    '**建议处理：**',
    '1. 先把结论转成客户能理解的话回复，避免直接贴代码路径。',
    '2. 需要研发确认时，附上诊断记录、用户最后一句话和下方折叠证据。',
    '3. 如果影响范围扩大或结论与现场不一致，按升级工单处理。',
  );
  appendMissing(lines, missing, mode, '**需要补充：**');
  appendUnsupported(lines, unsupportedFacts);
  return lines.join('\n');
}

function customerReply(
  conclusions: string[],
  result: DiagnosticResult,
  mode: ReplyMode,
  missing: string,
): string {
  const safeConclusions = conclusions.map((text) => customerSafeConclusion(`${text}\n${result.summary}`));
  const actions = customerActionItems(safeConclusions.join('；'), mode);
  const lines = conclusionLines(`**${mode === 'partial' ? '初步判断' : '结论'}：**`, safeConclusions);
  appendEvidenceStatus(lines, mode);
  lines.push(
    '',
    '**你现在可以这样做：**',
    ...actions.map((action, index) => `${index + 1}. ${action}`),
  );
  const note = mode === 'need_input'
    ? `还需要确认：${missing || '具体页面和提示'}。`
    : '证据细节已保留在诊断记录中，人工支持可以继续查看。';
  lines.push('', `**说明：** ${note}`);
  return lines.join('\n');
}

function operationsCategory(conclusion: string, result: DiagnosticResult): string {
  const text = `${conclusion}\n${result.summary}`.toLowerCase();
  if (/bug|缺陷|异常|报错|错误|失败|\b5\d\d\b|exception|error/.test(text)) {
    return '系统 bug';
  }
  if (result.evidence.some((item) => item.kind === 'knowledge')) {
    return '设计使然';
  }
  if (/设计|规则|预期|限制|不支持|使然|产品行为/.test(text)) {
    return '设计使然';
  }
  if (/配置|设置|开关|开启|启用|参数|后台|入口|权限|角色|控制/.test(text)) {
    return '配置或使用问题';
  }
  return result.status === 'concluded' || result.recommendedNextAction === 'final_answer'
    ? '目前不能确认归类'
    : '目前不能确认';
}

function operationsImpact(category: string, mode: ReplyMode): string {
  if (mode === 'need_input') {
    return '现在还不能判断影响范围，先补齐关键信息再对外给确定说法。';
  }
  if (category === '系统 bug') {
    return '可能影响用户正常操作，建议先记录影响范围并升级确认。';
  }
  if (category === '设计使然') {
    return '更适合按产品规则解释，除非现场表现和规则不一致。';
  }
  if (category === '配置或使用问题') {
    return '优先检查后台配置、角色权限或使用路径，通常不需要直接定性为缺陷。';
  }
  return '当前只能作为低置信度判断，不建议直接对外定责。';
}

function appendMissing(lines: string[], missing: string, mode: ReplyMode, label = '**仍需确认：**'): void {
  if (missing || mode !== 'final') {
    lines.push('', `${label} ${missing || '暂无阻塞项；如现场不一致，再补充页面、账号角色和时间范围。'}`);
  }
}

function appendEvidenceStatus(lines: string[], mode: ReplyMode): void {
  if (mode === 'partial') {
    lines.push('', '**证据状态：当前证据不足，不能作为最终结论。**');
  }
}

function missingForMode(result: DiagnosticResult, explicitMissing: string | undefined, mode: ReplyMode): string {
  const raw = explicitMissing || result.missingInfo.join('、');
  if (mode !== 'partial') {
    return raw;
  }
  const parts = raw
    .split('、')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.some((part) => /可验证|最终结论|medium\/high/i.test(part))) {
    parts.push('可验证的最终结论证据');
  }
  return Array.from(new Set(parts)).join('、');
}

function stripPreliminaryPrefix(text: string): string {
  return text.replace(/^初步判断[:：]\s*/, '');
}

function appendRisk(lines: string[], missing: string, mode: ReplyMode): void {
  if (missing || mode !== 'final') {
    lines.push('', `**风险或未知：** ${missing || '暂无阻塞项；仍需用实际环境复现确认。'}`);
  }
}

function appendUnsupported(
  lines: string[],
  unsupportedFacts: DiagnosticClaim[],
  sanitize: (text: string) => string = (text) => text,
): void {
  if (unsupportedFacts.length > 0) {
    lines.push('', `**未采纳：** ${unsupportedFacts.map((claim) => sanitize(claim.text)).join('；')}`);
  }
}

function customerSafeConclusion(conclusion: string): string {
  const redacted = conclusion
    .replace(/\b(src|app|packages?|node_modules|vendor)\/[^\s，。；)）]+/g, '相关系统位置')
    .replace(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g, '相关系统配置')
    .replace(/TypeError|ReferenceError|SyntaxError|Cannot read properties of undefined|undefined|null|判空/g, '系统处理异常')
    .replace(/\s+/g, ' ')
    .trim();
  if (/学习计划/.test(redacted) && /500|报错|异常|错误|失败|系统处理异常/.test(redacted)) {
    return 'AI伴学助手生成学习计划时遇到了系统处理异常，所以当前可能无法正常生成学习计划。';
  }
  if (/500|报错|异常|错误|失败|系统处理异常|exception|error/i.test(redacted)) {
    return '当前操作遇到了系统处理异常，可能会导致操作无法完成。';
  }
  return redacted;
}

function customerActionItems(conclusion: string, mode: ReplyMode): string[] {
  if (mode === 'need_input') {
    return [
      '请补充当前页面、操作步骤和看到的提示。',
      '如果不确定具体信息，可以先把截图或提示内容发给人工支持。',
    ];
  }
  if (/系统处理异常|无法正常|无法完成/.test(conclusion)) {
    return [
      '请把页面提示、操作时间、课程或账号信息发给人工支持继续处理。',
      '在处理完成前，可以稍后重试；如果影响学习安排，请让人工支持协助确认课程设置和处理进度。',
    ];
  }
  return [
    '先按上面的说明检查当前页面或操作步骤。',
    '如果仍然无法完成，请把页面、操作步骤和看到的提示发给人工支持。',
  ];
}

function redactInternalKnowledgePath(text: string): string {
  return text.replace(/knowledge\/(?:_sources|faq|whitepapers)\/[^\s，。；)）\]]+/g, '业务资料');
}

function workerFailedBeforeResult(trace: WorkerTrace): boolean {
  return Boolean(trace.error || trace.signal || (trace.exitCode !== undefined && trace.exitCode !== 0));
}

function formatWorkerFailureResult(
  result: DiagnosticResult,
  trace: WorkerTrace,
  identity?: { caseId: string; runId: string },
): string {
  const category = trace.signal
    ? 'worker_interrupted'
    : trace.error && /timed?\s*out|timeout/i.test(trace.error)
      ? 'worker_timeout'
      : 'worker_execution_failed';
  const nextAction = result.recommendedNextAction === 'ask_user'
    ? '请补充缺失信息后重试。'
    : '请稍后重试；若持续失败，请让技术支持查看诊断日志。';
  return [
    `诊断未完成（${category}）。`,
    `当前状态：${result.status === 'need_input' ? '等待补充信息' : '未形成可验证结论'}。`,
    `下一步：${nextAction}`,
    identity ? `诊断标识：case=${identity.caseId}，run=${identity.runId}。` : '',
  ].filter(Boolean).join('\n\n');
}
