import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  parseMarkdownDocument,
  readDraftSlices,
  readKnowledgeQualityReport,
} from '../knowledge/index.js';
import type { KnowledgeFrontmatter, KnowledgeQualityIssue, KnowledgeQualityReport } from '../knowledge/index.js';
import { explainReviewIssue } from './review-issue-explanations.js';
import type {
  OnboardingReviewItem,
  OnboardingReviewQuery,
  OnboardingReviewSeverityFilter,
  OnboardingReviewState,
} from './types.js';

interface NormalizedReviewQuery {
  offset: number;
  limit?: number;
  severity: OnboardingReviewSeverityFilter;
  search: string;
}

export function emptyReviewState(query?: OnboardingReviewQuery): OnboardingReviewState {
  const normalized = normalizeReviewQuery(query);
  return {
    required: false,
    pendingCount: 0,
    blockedCount: 0,
    totalCount: 0,
    page: {
      offset: normalized.offset,
      limit: normalized.limit ?? 0,
      total: 0,
      returned: 0,
      hasMore: false,
      severity: normalized.severity,
      search: normalized.search,
    },
    items: [],
  };
}

export function buildReviewState(input: { workspaceRoot: string; query?: OnboardingReviewQuery }): OnboardingReviewState {
  const query = normalizeReviewQuery(input.query);
  const draftsRoot = join(input.workspaceRoot, 'knowledge', '_pipeline', 'drafts');
  if (!existsSync(draftsRoot)) return emptyReviewState(input.query);
  const quality = readKnowledgeQualityReport(input.workspaceRoot);
  const items: OnboardingReviewItem[] = [];
  const sourceDocumentIds = readdirSync(draftsRoot)
    .filter((name) => statSync(join(draftsRoot, name)).isDirectory())
    .sort();

  for (const sourceDocumentId of sourceDocumentIds) {
    for (const slice of readDraftSlices(input.workspaceRoot, sourceDocumentId)) {
      const parsed = parseMarkdownDocument(readFileSync(slice.path, 'utf8'), slice.path);
      if (isReviewFinished(parsed.frontmatter.pipeline_status)) continue;
      const issues = qualityIssuesForSlice(quality, parsed.frontmatter, sourceDocumentId);
      const severity = reviewSeverity(parsed.frontmatter, issues);
      if (severity === 'ok') continue;
      items.push({
        id: parsed.frontmatter.id,
        sourceDocumentId,
        title: parsed.frontmatter.title,
        module: parsed.frontmatter.module,
        path: relative(input.workspaceRoot, slice.path).replaceAll('\\', '/'),
        qualitySeverity: severity,
        qualityStatus: parsed.frontmatter.quality_status,
        pipelineStatus: parsed.frontmatter.pipeline_status,
        issues: issues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          message: issue.message,
          source: issue.source,
          details: issue.details,
          explanation: explainReviewIssue(issue),
        })),
        excerptPreview: parsed.body.replace(/\s+/g, ' ').trim().slice(0, 240),
      });
    }
  }

  const pendingCount = items.filter((item) => item.qualitySeverity === 'warn').length;
  const blockedCount = items.filter((item) => item.qualitySeverity === 'error').length;
  const filteredItems = filterReviewItems(items, query);
  const limit = query.limit ?? filteredItems.length;
  const pageItems = filteredItems.slice(query.offset, query.offset + limit);
  return {
    required: items.length > 0,
    pendingCount,
    blockedCount,
    totalCount: items.length,
    page: {
      offset: query.offset,
      limit,
      total: filteredItems.length,
      returned: pageItems.length,
      hasMore: query.offset + pageItems.length < filteredItems.length,
      severity: query.severity,
      search: query.search,
    },
    items: pageItems,
  };
}

function normalizeReviewQuery(query?: OnboardingReviewQuery): NormalizedReviewQuery {
  const rawOffset = Number(query?.offset ?? 0);
  const rawLimit = query?.limit === undefined ? undefined : Number(query.limit);
  return {
    offset: Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0,
    limit: rawLimit === undefined ? undefined : Math.max(1, Math.min(100, Math.floor(Number.isFinite(rawLimit) ? rawLimit : 20))),
    severity: query?.severity === 'warn' || query?.severity === 'error' ? query.severity : 'all',
    search: query?.search?.trim() ?? '',
  };
}

function filterReviewItems(items: OnboardingReviewItem[], query: NormalizedReviewQuery): OnboardingReviewItem[] {
  const bySeverity = query.severity === 'all' ? items : items.filter((item) => item.qualitySeverity === query.severity);
  if (!query.search) return bySeverity;
  const needle = query.search.toLocaleLowerCase();
  return bySeverity.filter((item) => reviewSearchText(item).toLocaleLowerCase().includes(needle));
}

function reviewSearchText(item: OnboardingReviewItem): string {
  return [
    item.id, item.sourceDocumentId, item.title, item.module, item.path, item.qualitySeverity,
    item.qualityStatus, item.pipelineStatus, item.excerptPreview,
    ...item.issues.flatMap((issue) => [
      issue.code, issue.message, issue.explanation.reason, issue.explanation.impact,
      issue.explanation.suggestion, ...issue.explanation.missingInfo,
    ]),
  ].filter(Boolean).join('\n');
}

function isReviewFinished(status: KnowledgeFrontmatter['pipeline_status']): boolean {
  return status === 'approved' || status === 'published' || status === 'rejected';
}

function qualityIssuesForSlice(
  quality: KnowledgeQualityReport | undefined,
  frontmatter: KnowledgeFrontmatter,
  sourceDocumentId: string,
): KnowledgeQualityIssue[] {
  if (!quality) return [];
  return quality.issues.filter((issue) => issue.documentId === frontmatter.id
    || issue.sourceDocument === sourceDocumentId
    || issue.sourceDocument === frontmatter.source_document_id
    || issue.source === frontmatter.source_document);
}

function reviewSeverity(frontmatter: KnowledgeFrontmatter, issues: KnowledgeQualityIssue[]): 'ok' | 'warn' | 'error' {
  if (frontmatter.quality_status === 'error' || frontmatter.pipeline_status === 'quality_error'
    || issues.some((issue) => issue.severity === 'error')) return 'error';
  if (frontmatter.quality_status === 'warn' || frontmatter.pipeline_status === 'quality_warn'
    || frontmatter.pipeline_status === 'review_required' || issues.some((issue) => issue.severity === 'warn')) return 'warn';
  return 'ok';
}
