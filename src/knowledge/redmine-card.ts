import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { dirtyFlagPath, knowledgeRoot } from './paths.js';
import { extractKnowledgeTerms } from './documents/terms.js';

export interface ImportRedmineIssueFixtureInput {
  workspaceRoot: string;
  issuePath: string;
}

export interface ImportRedmineIssueFixtureResult {
  issueId: number;
  documentId: string;
  sourceDocumentId: string;
  sourcePath: string;
  cardPath: string;
  status: 'review_required';
  coverageLevel: RedmineCoverageLevel;
  verificationStatus: RedmineVerificationStatus;
}

export type RedmineVerificationStatus = 'verified' | 'partially_verified' | 'unverified';
export type RedmineCoverageLevel = 'full' | 'partial' | 'context_only';

export interface RedmineNamedRef {
  id?: number;
  name?: string;
}

export interface RedmineCustomField {
  id?: number;
  name?: string;
  value?: unknown;
}

export interface RedmineJournalDetail {
  property?: string;
  name?: string;
  old_value?: unknown;
  new_value?: unknown;
}

export interface RedmineJournal {
  id?: number;
  user?: RedmineNamedRef;
  notes?: string;
  created_on?: string;
  details?: RedmineJournalDetail[];
}

export interface RedmineAttachment {
  id?: number;
  filename?: string;
  filesize?: number;
  content_type?: string;
  content_url?: string;
}

export interface RedmineIssue {
  id?: number;
  project?: RedmineNamedRef;
  tracker?: RedmineNamedRef;
  status?: RedmineNamedRef;
  priority?: RedmineNamedRef;
  author?: RedmineNamedRef;
  assigned_to?: RedmineNamedRef;
  category?: RedmineNamedRef;
  subject?: string;
  description?: string;
  start_date?: string | null;
  due_date?: string | null;
  done_ratio?: number;
  estimated_hours?: number | null;
  custom_fields?: RedmineCustomField[];
  created_on?: string;
  updated_on?: string;
  closed_on?: string;
  journals?: RedmineJournal[];
  attachments?: RedmineAttachment[];
  relations?: unknown[];
}

export interface RedmineIssuePayload {
  issue?: RedmineIssue;
}

export interface NormalizedRedmineIssue {
  issue: RedmineIssue;
  issueId: number;
  subject: string;
  moduleId: string;
  documentType: 'solved_case' | 'unresolved_case';
  verificationStatus: RedmineVerificationStatus;
  coverageLevel: RedmineCoverageLevel;
  relatedTerms: string[];
  sourceBlockIds: string[];
  evidenceJournalIds: number[];
}

import { blockQuote, cleanText, formatCustomFields, formatJournals, formatList, hasResolutionSignal, inferModuleId, inferVerificationStatus, isClosedIssue, missingItemsForIssue, relatedTerms, requireIssueId, reusableJudgmentFromIssue, sortedJournals, verifiedFactsFromIssue, yamlArray, yamlScalar } from './redmine-mapping.js';
export function importRedmineIssueFixture(input: ImportRedmineIssueFixtureInput): ImportRedmineIssueFixtureResult {
  const payload = JSON.parse(readFileSync(input.issuePath, 'utf8')) as RedmineIssuePayload | RedmineIssue;
  const issue = 'issue' in payload && payload.issue ? payload.issue : payload as RedmineIssue;
  const normalized = normalizeRedmineIssue(issue);
  const root = knowledgeRoot(input.workspaceRoot);
  const sourcePath = writeRedmineSource({
    knowledgeRoot: root,
    issuePath: input.issuePath,
    issue: normalized.issue,
    issueId: normalized.issueId,
  });
  const sourceDocumentId = `redmine_issue_${normalized.issueId}`;
  const documentId = `kb_redmine_${normalized.issueId}`;
  const targetRoot = normalized.documentType === 'solved_case' ? 'tickets/solved-cases' : 'tickets/unresolved-cases';
  const targetDir = join(root, targetRoot, normalized.moduleId);
  const cardPath = join(targetDir, `${documentId}.md`);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(
    cardPath,
    renderRedmineExperienceCard({
      documentId,
      sourceDocumentId,
      relativeSourcePath: `knowledge/_sources/redmine/issues/${normalized.issueId}.json`,
      normalized,
    }),
    'utf8',
  );
  mkdirSync(join(root, 'indexes'), { recursive: true });
  writeFileSync(dirtyFlagPath(input.workspaceRoot), `Redmine issue ${normalized.issueId} imported; rebuild knowledge index.\n`, 'utf8');
  return {
    issueId: normalized.issueId,
    documentId,
    sourceDocumentId,
    sourcePath,
    cardPath,
    status: 'review_required',
    coverageLevel: normalized.coverageLevel,
    verificationStatus: normalized.verificationStatus,
  };
}

function normalizeRedmineIssue(issue: RedmineIssue): NormalizedRedmineIssue {
  const issueId = requireIssueId(issue);
  const subject = cleanText(issue.subject) || `Redmine issue ${issueId}`;
  const evidenceJournals = sortedJournals(issue).filter((journal) => cleanText(journal.notes));
  const documentType = isClosedIssue(issue) && hasResolutionSignal(issue) ? 'solved_case' : 'unresolved_case';
  return {
    issue,
    issueId,
    subject,
    moduleId: inferModuleId(issue),
    documentType,
    verificationStatus: inferVerificationStatus(issue, documentType),
    coverageLevel: documentType === 'solved_case' ? 'partial' : 'context_only',
    relatedTerms: relatedTerms(issue),
    sourceBlockIds: [
      ...(cleanText(issue.description) ? [`redmine_${issueId}_description`] : []),
      ...evidenceJournals.flatMap((journal) => journal.id ? [`redmine_${issueId}_journal_${journal.id}`] : []),
    ],
    evidenceJournalIds: evidenceJournals.flatMap((journal) => journal.id ? [journal.id] : []),
  };
}

function writeRedmineSource(input: {
  knowledgeRoot: string;
  issuePath: string;
  issue: RedmineIssue;
  issueId: number;
}): string {
  const sourceDir = join(input.knowledgeRoot, '_sources', 'redmine', 'issues');
  mkdirSync(sourceDir, { recursive: true });
  const sourcePath = join(sourceDir, `${input.issueId}.json`);
  const payload = {
    source_type: 'redmine_issue',
    imported_from: basename(input.issuePath),
    imported_at: new Date().toISOString(),
    issue: input.issue,
  };
  writeFileSync(sourcePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return sourcePath;
}

function renderRedmineExperienceCard(input: {
  documentId: string;
  sourceDocumentId: string;
  relativeSourcePath: string;
  normalized: NormalizedRedmineIssue;
}): string {
  const issue = input.normalized.issue;
  const today = new Date().toISOString().slice(0, 10);
  const documentType = input.normalized.documentType;
  const sourceType = documentType;
  const description = cleanText(issue.description);
  const verifiedFacts = verifiedFactsFromIssue(input.normalized);
  const reusableJudgment = reusableJudgmentFromIssue(input.normalized);
  const missingItems = missingItemsForIssue(input.normalized);
  return `---
id: ${input.documentId}
title: ${yamlScalar(input.normalized.subject)}
type: ${documentType}
module: ${input.normalized.moduleId}
intent: troubleshooting
source_type: ${sourceType}
confidence: medium
status: review_required
visibility: internal
product_versions: []
related_terms:
${yamlArray(input.normalized.relatedTerms)}
related_repos: []
last_verified_at: ${today}
owner: knowledge-admin
source_document: ${input.relativeSourcePath}
source_document_id: ${input.sourceDocumentId}
source_block_ids:
${yamlArray(input.normalized.sourceBlockIds)}
section_path:
  - Redmine
  - ${yamlScalar(input.normalized.subject)}
quality_status: unchecked
external_source: redmine
redmine_issue_id: ${input.normalized.issueId}
redmine_project: ${yamlScalar(issue.project?.name ?? '')}
redmine_tracker: ${yamlScalar(issue.tracker?.name ?? '')}
redmine_status: ${yamlScalar(issue.status?.name ?? '')}
redmine_priority: ${yamlScalar(issue.priority?.name ?? '')}
verification_status: ${input.normalized.verificationStatus}
coverage_level: ${input.normalized.coverageLevel}
missing_items:
${yamlArray(missingItems)}
---

# ${input.normalized.subject}

## 用户原始问题

${blockQuote([input.normalized.subject, description].filter(Boolean).join('\n\n'))}

## 工单上下文

- redmine_issue_id: ${input.normalized.issueId}
- project: ${issue.project?.name ?? '未知'}
- tracker: ${issue.tracker?.name ?? '未知'}
- status: ${issue.status?.name ?? '未知'}
- priority: ${issue.priority?.name ?? '未知'}
- author: ${issue.author?.name ?? '未知'}
- assigned_to: ${issue.assigned_to?.name ?? '未知'}
- category: ${issue.category?.name ?? '未知'}
- created_on: ${issue.created_on ?? '未知'}
- updated_on: ${issue.updated_on ?? '未知'}
- closed_on: ${issue.closed_on ?? '未知'}

## 自定义字段

${formatCustomFields(issue.custom_fields ?? [])}

## 处理过程

${formatJournals(issue.journals ?? [])}

## 已验证事实

${formatList(verifiedFacts, '工单没有留下足够明确的已验证事实，需要人工复核。')}

## 可复用判断

${blockQuote(reusableJudgment)}

## 仍需验证

${formatList(missingItems, '暂无额外待验证事项。')}

## 适用范围

- 仅适用于与该 Redmine 工单现象、模块、配置条件一致的问题。
- 仅能作为历史经验线索，复用前需要确认当前产品版本和租户配置一致。

## 不适用范围

- 不适用于当前代码、权限、数据修复、支付或安全状态尚未验证的场景。
- 不适用于只有相似表述但缺少相同触发条件的问题。

## 原始来源

- source_document: ${input.relativeSourcePath}
- source_document_id: ${input.sourceDocumentId}
- source_block_ids: ${input.normalized.sourceBlockIds.join(', ')}
- evidence_journal_ids: ${input.normalized.evidenceJournalIds.join(', ') || '无'}
`;
}
