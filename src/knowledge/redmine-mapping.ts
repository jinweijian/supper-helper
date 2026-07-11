import type { NormalizedRedmineIssue, RedmineCustomField, RedmineIssue, RedmineJournal, RedmineVerificationStatus } from './redmine-card.js';
import { extractKnowledgeTerms } from './documents/terms.js';

export function requireIssueId(issue: RedmineIssue): number {
  if (!Number.isInteger(issue.id)) {
    throw new Error('Redmine issue fixture missing numeric issue.id');
  }
  return Number(issue.id);
}

export function isClosedIssue(issue: RedmineIssue): boolean {
  const status = `${issue.status?.name ?? ''} ${issue.closed_on ?? ''}`.toLowerCase();
  return Boolean(issue.closed_on) || /closed|resolved|done|fixed|已关闭|已解决|已完成|已修复|关闭|解决/.test(status);
}

export function hasResolutionSignal(issue: RedmineIssue): boolean {
  const text = [
    issue.status?.name,
    issue.done_ratio,
    issue.closed_on,
    ...customFieldValues(issue),
    ...sortedJournals(issue).map((journal) => journal.notes ?? ''),
  ].join('\n').toLowerCase();
  return /fixed|resolved|done|恢复|修复|解决|已关闭|已解决|已恢复|客户确认|确认/.test(text);
}

export function inferVerificationStatus(issue: RedmineIssue, documentType: 'solved_case' | 'unresolved_case'): RedmineVerificationStatus {
  if (documentType !== 'solved_case') {
    return 'unverified';
  }
  const text = [
    ...customFieldValues(issue),
    ...sortedJournals(issue).map((journal) => journal.notes ?? ''),
  ].join('\n');
  return /客户确认|用户确认|已恢复|恢复|有效|解决/.test(text) ? 'partially_verified' : 'unverified';
}

export function inferModuleId(issue: RedmineIssue): string {
  const text = [
    issue.project?.name,
    issue.category?.name,
    issue.subject,
    issue.description,
    ...customFieldValues(issue),
  ].join('\n');
  if (/AI伴学|伴学助手|学习计划|督学提醒|题目答疑/i.test(text)) {
    return 'ai-companion';
  }
  if (/EduSoho|教培|课程|班级|学员|教师|网校/i.test(text)) {
    return 'edusoho-training';
  }
  return 'general';
}

export function relatedTerms(issue: RedmineIssue): string[] {
  return Array.from(new Set([
    issue.subject ?? '',
    issue.project?.name ?? '',
    issue.category?.name ?? '',
    issue.tracker?.name ?? '',
    issue.status?.name ?? '',
    ...customFieldValues(issue),
  ].flatMap((item) => extractKnowledgeTerms(item)))).slice(0, 14);
}

export function verifiedFactsFromIssue(input: NormalizedRedmineIssue): string[] {
  const issue = input.issue;
  const facts = [
    cleanText(issue.description) ? `工单描述记录：${cleanText(issue.description)}` : '',
    ...sortedJournals(issue)
      .filter((journal) => cleanText(journal.notes))
      .map((journal) => `journal ${journal.id ?? 'unknown'}：${cleanText(journal.notes)}`),
    isClosedIssue(issue) ? `Redmine 状态为「${issue.status?.name ?? '已关闭'}」，关闭时间为 ${issue.closed_on ?? '未知'}。` : '',
  ].filter(Boolean);
  return facts.slice(0, 8);
}

export function reusableJudgmentFromIssue(input: NormalizedRedmineIssue): string {
  if (input.documentType === 'unresolved_case') {
    return '该 Redmine 工单没有形成可复用解决结论，只能作为相似问题调查线索。';
  }
  return `历史工单显示「${input.subject}」与上述处理过程有关。该判断只覆盖 Redmine 中已记录的事实；当前问题是否同因仍需验证当前版本、租户配置和运行时证据。`;
}

export function missingItemsForIssue(input: NormalizedRedmineIssue): string[] {
  const base = [
    '当前产品版本是否仍符合该历史工单的处理逻辑',
    '当前租户、角色、配置和数据状态是否与历史工单一致',
    '当前代码或线上行为是否已发生变更',
  ];
  if (input.coverageLevel !== 'full') {
    base.push('历史工单未覆盖的其他可能原因');
  }
  return base;
}

export function sortedJournals(issue: RedmineIssue): RedmineJournal[] {
  return [...(issue.journals ?? [])].sort((left, right) => {
    const leftTime = Date.parse(left.created_on ?? '');
    const rightTime = Date.parse(right.created_on ?? '');
    return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
  });
}

export function customFieldValues(issue: RedmineIssue): string[] {
  return (issue.custom_fields ?? []).flatMap((field) => {
    if (Array.isArray(field.value)) {
      return field.value.map((item) => String(item));
    }
    return field.value === undefined || field.value === null ? [] : [String(field.value)];
  });
}

export function formatCustomFields(fields: RedmineCustomField[]): string {
  if (fields.length === 0) {
    return '- 未记录自定义字段。';
  }
  return fields.map((field) => `- ${field.name ?? field.id ?? 'field'}: ${formatUnknownValue(field.value)}`).join('\n');
}

export function formatJournals(journals: RedmineJournal[]): string {
  const entries = sortedJournals({ journals })
    .filter((journal) => cleanText(journal.notes) || (journal.details?.length ?? 0) > 0)
    .map((journal) => [
      `- journal ${journal.id ?? 'unknown'} / ${journal.created_on ?? 'unknown'} / ${journal.user?.name ?? 'unknown'}`,
      cleanText(journal.notes) ? `  - notes: ${cleanText(journal.notes)}` : '',
      ...(journal.details ?? []).map((detail) => `  - change: ${detail.name ?? detail.property ?? 'field'} ${formatUnknownValue(detail.old_value)} -> ${formatUnknownValue(detail.new_value)}`),
    ].filter(Boolean).join('\n'));
  return entries.length > 0 ? entries.join('\n') : '- 工单没有可用的 journal notes。';
}

export function formatList(items: string[], empty: string): string {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  return cleaned.length ? cleaned.map((item) => `- ${item}`).join('\n') : `- ${empty}`;
}

export function blockQuote(value: string): string {
  const text = value.trim();
  if (!text) {
    return '> 未记录。';
  }
  return text.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
}

export function yamlArray(values: string[]): string {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return '  []';
  }
  return cleaned.map((value) => `  - ${yamlScalar(value)}`).join('\n');
}

export function yamlScalar(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) {
    return '""';
  }
  return /[:#\[\]{},"']|\s$|^\s/.test(cleaned) ? JSON.stringify(cleaned) : cleaned;
}

export function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function formatUnknownValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ');
  }
  if (value === undefined || value === null || value === '') {
    return '空';
  }
  return String(value);
}
