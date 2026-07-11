import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiagnosticClaim, DiagnosticResult, DiagnosticRun, Evidence } from '../domain.js';
import { dirtyFlagPath } from '../knowledge/paths.js';
import { routeKnowledgeQuestion } from '../knowledge/taxonomy.js';
import type { StoredCase } from '../sessions/case-repository.js';
import { turnMessages, turnRuns } from '../sessions/turn-context-snapshot.js';

export interface SolvedCaseDraft {
  documentId: string;
  moduleId: string;
  path: string;
  status: 'review_required';
  confidence: 'medium';
}

export function isResolutionConfirmation(message: string): boolean {
  const text = message.replace(/\s+/g, '').toLowerCase();
  if (!text) {
    return false;
  }
  if (/未解决|没有解决|没解决|还没解决|不生效|无效|不行|失败|仍然|还是/.test(text)) {
    return false;
  }
  return /已解决|解决了|问题解决|好了|可以了|搞定|修好了|恢复了|方案有效|有效/.test(text);
}

export function hasCuratableDiagnosticResult(caseSession: StoredCase): boolean {
  const run = latestRunWithResult(caseSession);
  return Boolean(
    run?.result &&
    run.status === 'concluded' &&
    run.result.status === 'concluded' &&
    hasEvidenceBackedClaim(run.result),
  );
}

export function curateSolvedCase(input: {
  workspaceRoot: string;
  caseSession: StoredCase;
  confirmationMessage: string;
}): SolvedCaseDraft {
  const run = latestRunWithResult(input.caseSession);
  if (!run?.result || !hasCuratableDiagnosticResult(input.caseSession)) {
    throw new Error('当前 case 没有可沉淀的已结论证据结果');
  }

  const originalQuestion = originalUserQuestion(input.caseSession) ?? run.request?.userGoal ?? input.caseSession.title;
  const moduleId = inferModuleId(input.workspaceRoot, input.caseSession, run, originalQuestion);
  const intent = inferIntent(run);
  const today = new Date().toISOString().slice(0, 10);
  const compactDate = today.replaceAll('-', '');
  const documentId = `kb_case_solved_${slug(moduleId)}_${compactDate}_${slug(input.caseSession.id)}`;
  const targetDir = join(input.workspaceRoot, 'knowledge', 'tickets', 'solved-cases', moduleId);
  const targetPath = join(targetDir, `${documentId}.md`);

  mkdirSync(targetDir, { recursive: true });
  mkdirSync(join(input.workspaceRoot, 'knowledge', 'indexes'), { recursive: true });
  writeFileSync(
    targetPath,
    buildSolvedCaseMarkdown({
      documentId,
      title: input.caseSession.title,
      moduleId,
      intent,
      today,
      caseSession: input.caseSession,
      run,
      result: run.result,
      originalQuestion,
      confirmationMessage: input.confirmationMessage,
    }),
    'utf8',
  );
  writeFileSync(dirtyFlagPath(input.workspaceRoot), `Solved case ${documentId} needs indexing.\n`, 'utf8');

  return {
    documentId,
    moduleId,
    path: targetPath,
    status: 'review_required',
    confidence: 'medium',
  };
}

function buildSolvedCaseMarkdown(input: {
  documentId: string;
  title: string;
  moduleId: string;
  intent: string;
  today: string;
  caseSession: StoredCase;
  run: DiagnosticRun;
  result: DiagnosticResult;
  originalQuestion: string;
  confirmationMessage: string;
}): string {
  const safeTitle = input.title || input.originalQuestion || '已解决 Case';
  const visibility = restrictedCase(input.caseSession, input.result) ? 'restricted' : 'internal';
  const finalReply = latestHelperReply(input.caseSession) ?? '';
  const evidenceIds = new Set(input.result.evidence.map((item) => item.id));
  const facts = supportedClaims(input.result.claims, evidenceIds, 'fact');
  const inferences = supportedClaims(input.result.claims, evidenceIds, 'inference');
  const assumptions = supportedClaims(input.result.claims, evidenceIds, 'assumption');
  const unknowns = [
    ...input.result.missingInfo,
    ...input.result.claims
      .filter((claim) => claim.type === 'unknown')
      .map((claim) => claim.text),
  ];
  const relatedTerms = Array.from(new Set([
    input.moduleId,
    input.intent,
    ...keywordsFromText(input.originalQuestion),
    ...input.result.evidence.flatMap((item) => keywordsFromText(item.summary)),
  ])).slice(0, 12);
  const codePaths = Array.from(new Set(
    input.result.evidence
      .map((item) => item.source)
      .filter((source) => /(?:^|\/)(src|app|lib|packages|services|routes|controllers)\//.test(source)),
  ));

  return `---
id: ${yamlString(input.documentId)}
title: ${yamlString(safeTitle)}
type: solved_case
module: ${yamlString(input.moduleId)}
intent: ${yamlString(input.intent)}
source_type: solved_case
confidence: medium
status: review_required
visibility: ${visibility}
product_versions: []
related_terms:
${yamlArrayItems(relatedTerms)}
related_repos: []
last_verified_at: ${input.today}
owner: knowledge-admin
---

# ${safeTitle}

## 用户原始问题

${blockQuote(input.originalQuestion)}

## 归一化问题

${blockQuote(input.run.request?.userGoal ?? input.originalQuestion)}

## 模块与意图

- module: ${input.moduleId}
- intent: ${input.intent}
- case_id: ${input.caseSession.id}
- run_id: ${input.run.id}

## 环境信息

- workspace_id: ${input.caseSession.workspaceId}
- user_persona: ${input.caseSession.userPersona}
- status_when_curated: ${input.caseSession.status}

## 使用过的证据

${formatEvidence(input.result.evidence)}

## 排查过程

${formatRuns(input.caseSession.runs)}

## 根因

### 事实

${formatList(facts, '没有足够 evidenceIds 支撑的事实，待人工复核。')}

### 推断

${formatList(inferences, '暂无可沉淀推断。')}

### 假设

${formatList(assumptions, '暂无假设。')}

### 未知

${formatList(unknowns, '暂无未解决未知项。')}

## 解决方案

${blockQuote(input.result.summary)}

${finalReply ? `### 最终回复\n\n${blockQuote(finalReply)}\n` : ''}
## 适用范围

- 适用于本 case 中 evidence 明确覆盖的模块、版本和配置范围。
- 复用前必须确认当前问题与原问题的模块、意图和上下文一致。

## 不适用范围

- 不适用于 evidence 未覆盖的租户差异、权限变更、数据修复、支付或安全场景。
- 不适用于当前实现已变更但尚未重新验证的场景。

## 相关代码路径

${formatList(codePaths, '本次沉淀主要来自知识库或结构化诊断证据，未记录可复用代码路径。')}

## 用户最终确认

${blockQuote(input.confirmationMessage)}

## 后续复核

- 默认状态为 review_required，需要知识库维护者复核后才能改为 active。
- 默认 confidence 为 medium，复核前不能作为 high confidence 结论使用。
- 复核时请检查事实、推断、假设、未知是否仍与当前产品版本一致。
`;
}

function latestRunWithResult(caseSession: StoredCase): DiagnosticRun | undefined {
  return [...turnRuns(caseSession)].reverse().find((run) => Boolean(run.result));
}

function originalUserQuestion(caseSession: StoredCase): string | undefined {
  return turnMessages(caseSession).find((message) => (
    message.role === 'user' &&
    !isResolutionConfirmation(message.body)
  ))?.body;
}

function latestHelperReply(caseSession: StoredCase): string | undefined {
  return [...turnMessages(caseSession)].reverse().find((message) => message.role === 'helper')?.body;
}

function inferModuleId(
  workspaceRoot: string,
  caseSession: StoredCase,
  run: DiagnosticRun,
  originalQuestion: string,
): string {
  const contextModule = run.request?.context?.knowledge?.route?.moduleCandidates?.[0];
  if (contextModule) {
    return contextModule;
  }

  const claimModule = run.result?.claims
    .map((claim) => claim.text.match(/模块候选：([^，\n]+)/)?.[1]?.trim())
    .find((value) => value && value !== '未限定');
  if (claimModule) {
    return claimModule;
  }

  const sourceModule = run.result?.evidence
    .map((item) => moduleFromKnowledgeSource(item.source))
    .find(Boolean);
  if (sourceModule) {
    return sourceModule;
  }

  if (existsSync(join(workspaceRoot, 'knowledge'))) {
    const route = routeKnowledgeQuestion({ workspaceRoot, question: originalQuestion });
    if (route.moduleCandidates[0]) {
      return route.moduleCandidates[0];
    }
  }

  return 'general';
}

function inferIntent(run: DiagnosticRun): string {
  return run.request?.context?.knowledge?.route?.intentCandidates?.[0] ?? 'troubleshooting';
}

function moduleFromKnowledgeSource(source: string): string | undefined {
  const normalized = source.replaceAll('\\', '/');
  const match = normalized.match(/knowledge\/(?:faq|runbooks|whitepapers|modules)\/([^/\s]+)/) ??
    normalized.match(/knowledge\/tickets\/(?:solved-cases|unresolved-cases)\/([^/\s]+)/) ??
    normalized.match(/(?:^|[\s(])(?:faq|runbooks|whitepapers|modules)\/([^/\s]+)/) ??
    normalized.match(/(?:^|[\s(])tickets\/(?:solved-cases|unresolved-cases)\/([^/\s]+)/);
  return match?.[1];
}

function restrictedCase(caseSession: StoredCase, result: DiagnosticResult): boolean {
  const text = [
    ...turnMessages(caseSession).map((message) => message.body),
    result.summary,
    ...result.claims.map((claim) => claim.text),
  ].join('\n');
  return /安全|权限|支付|退款|数据修复|生产事故|泄露|security|permission|payment|refund/i.test(text);
}

function supportedClaims(
  claims: DiagnosticClaim[],
  evidenceIds: Set<string>,
  type: DiagnosticClaim['type'],
): string[] {
  return claims
    .filter((claim) => claim.type === type)
    .filter((claim) => claim.evidenceIds.length > 0 && claim.evidenceIds.every((id) => evidenceIds.has(id)))
    .map((claim) => `${claim.text}（证据：${claim.evidenceIds.join('、')}）`);
}

function hasEvidenceBackedClaim(result: DiagnosticResult): boolean {
  const evidenceIds = new Set(result.evidence.map((item) => item.id));
  return result.claims.some((claim) => (
    claim.type !== 'unknown' &&
    claim.evidenceIds.length > 0 &&
    claim.evidenceIds.every((id) => evidenceIds.has(id))
  ));
}

function formatEvidence(evidence: Evidence[]): string {
  if (!evidence.length) {
    return '- 暂无证据，不能作为 solved case 直接复用。';
  }
  return evidence.map((item) => [
    `- ${item.id} (${item.kind}, ${item.confidence})`,
    `  - source: ${item.source}`,
    `  - summary: ${item.summary}`,
  ].join('\n')).join('\n');
}

function formatRuns(runs: DiagnosticRun[]): string {
  if (!runs.length) {
    return '- 暂无诊断 run。';
  }
  return runs.map((run) => {
    const goal = run.request?.userGoal ? ` - ${run.request.userGoal}` : '';
    const summary = run.result?.summary ? `\n  - summary: ${run.result.summary}` : '';
    return `- ${run.id} (${run.status})${goal}${summary}`;
  }).join('\n');
}

function formatList(items: string[], emptyText: string): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : `- ${emptyText}`;
}

function blockQuote(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '> 暂无';
  }
  return trimmed.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
}

function yamlArrayItems(items: string[]): string {
  return items.length ? items.map((item) => `  - ${yamlString(item)}`).join('\n') : '  []';
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, ' ').trim());
}

function keywordsFromText(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}_\-]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 40)
    .slice(0, 10);
}

function slug(value: string): string {
  const slugged = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slugged || 'general';
}
