import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dirtyFlagPath,
  pipelinePublishRoot,
  pipelineReviewRoot,
  publishReportPath,
  qualityReportPath,
  sourceReviewRecordPath,
  knowledgeRoot,
} from './paths.js';
import { parseMarkdownDocument } from './frontmatter.js';
import { serializeFrontmatter, toYaml } from './frontmatter-serializer.js';
import { readKnowledgeQualityReport, type KnowledgeQualityGate } from './quality.js';
import { readDraftSlices } from './slicer.js';
import type {
  KnowledgeFrontmatter,
  KnowledgePipelineStatus,
  KnowledgePublishReport,
  KnowledgeSliceReviewRecord,
  KnowledgeStatus,
} from './types.js';

import { computeNextStatus, reviewDraftSlices } from './publish-review.js';
export { reviewDraftSlices } from './publish-review.js';
export type { ReviewDraftSlicesInput } from './publish-review.js';

export interface PublishApprovedDraftSlicesInput {
  workspaceRoot: string;
  sourceDocumentId?: string;
  qualityGate?: KnowledgeQualityGate;
}

export interface QualityAutoApprovalResult {
  approvedIds: string[];
  pendingReviewIds: string[];
  blockedIds: string[];
}

export function approveQualityCleanDraftSlices(input: {
  workspaceRoot: string;
  reviewer: string;
}): QualityAutoApprovalResult {
  const quality = readKnowledgeQualityReport(input.workspaceRoot);
  const approvedIds: string[] = [];
  const pendingReviewIds: string[] = [];
  const blockedIds: string[] = [];
  const approveBySource = new Map<string, string[]>();

  const draftsRoot = join(input.workspaceRoot, 'knowledge', '_pipeline', 'drafts');
  if (!existsSync(draftsRoot)) {
    return { approvedIds, pendingReviewIds, blockedIds };
  }

  const sourceDirs = readdirSync(draftsRoot).filter((name: string) => {
    const fullPath = join(draftsRoot, name);
    return statSync(fullPath).isDirectory();
  });

  for (const sourceDir of sourceDirs) {
    const slices = readDraftSlices(input.workspaceRoot, sourceDir);
    for (const slice of slices) {
      const parsed = parseMarkdownDocument(slice.content, slice.path);
      if (!isAutoApprovableStatus(parsed.frontmatter.pipeline_status)) {
        continue;
      }
      const severity = highestQualitySeverity(parsed.frontmatter, sourceDir, quality);
      if (severity === 'error') {
        blockedIds.push(parsed.frontmatter.id);
        continue;
      }
      if (severity === 'warn') {
        pendingReviewIds.push(parsed.frontmatter.id);
        continue;
      }
      approvedIds.push(parsed.frontmatter.id);
      approveBySource.set(sourceDir, [...(approveBySource.get(sourceDir) ?? []), parsed.frontmatter.id]);
    }
  }

  for (const [sourceDocumentId, ids] of approveBySource.entries()) {
    reviewDraftSlices({
      workspaceRoot: input.workspaceRoot,
      sourceDocumentId,
      action: 'approve',
      reviewer: input.reviewer,
      notes: 'quality-clean auto approval',
      ids,
    });
  }

  return { approvedIds, pendingReviewIds, blockedIds };
}

export function publishApprovedDraftSlices(input: PublishApprovedDraftSlicesInput): KnowledgePublishReport {
  const gate: KnowledgeQualityGate = input.qualityGate ?? 'warn';
  const quality = readKnowledgeQualityReport(input.workspaceRoot);
  const publishId = `pub_${Date.now()}`;
  const publishedIds: string[] = [];
  const rejectedIds: string[] = [];
  const warningOverrides: KnowledgePublishReport['warningOverrides'] = [];
  const sourceDocumentIds: string[] = [];
  const outputPaths: string[] = [];

  const draftsRoot = join(input.workspaceRoot, 'knowledge', '_pipeline', 'drafts');
  if (!existsSync(draftsRoot)) {
    return writePublishReport(input.workspaceRoot, {
      version: 1,
      generatedAt: new Date().toISOString(),
      publishId,
      publishedIds,
      rejectedIds,
      warningOverrides,
      sourceDocumentIds,
      outputPaths,
      indexDirty: false,
      qualityReportPath: quality ? qualityReportPath(input.workspaceRoot) : undefined,
      qualityReportGeneratedAt: quality?.generatedAt,
    });
  }

  const sourceDirs = readdirSync(draftsRoot).filter((name: string) => {
    const fullPath = join(draftsRoot, name);
    return statSync(fullPath).isDirectory();
  });

  for (const sourceDir of sourceDirs) {
    if (input.sourceDocumentId && sourceDir !== input.sourceDocumentId) continue;
    sourceDocumentIds.push(sourceDir);
    const slices = readDraftSlices(input.workspaceRoot, sourceDir);
    for (const slice of slices) {
      const parsed = parseMarkdownDocument(slice.content, slice.path);
      if (parsed.frontmatter.pipeline_status === 'approved') {
        const blockReason = publishBlockReason(parsed.frontmatter, quality, gate);
        if (blockReason) {
          rejectedIds.push(parsed.frontmatter.id);
          warningOverrides.push({ documentId: parsed.frontmatter.id, issueId: 'quality_gate', reason: blockReason });
          continue;
        }
        const published = publishOneDraft(input.workspaceRoot, sourceDir, parsed.frontmatter, parsed.body, publishId, Boolean(quality));
        if (published) {
          publishedIds.push(parsed.frontmatter.id);
          outputPaths.push(published.outputPath);
        }
      } else {
        // Not approved: not yet publishable
      }
    }
  }

  const indexDirty = publishedIds.length > 0;
  if (indexDirty) {
    // Mark dirty so next update rebuilds indexes
    mkdirSync(join(input.workspaceRoot, 'knowledge', 'indexes'), { recursive: true });
    writeFileSync(dirtyFlagPath(input.workspaceRoot), new Date().toISOString(), 'utf8');
  }

  return writePublishReport(input.workspaceRoot, {
    version: 1,
    generatedAt: new Date().toISOString(),
    publishId,
    publishedIds,
    rejectedIds,
    warningOverrides,
    sourceDocumentIds,
    outputPaths,
    indexDirty,
    qualityReportPath: quality ? qualityReportPath(input.workspaceRoot) : undefined,
    qualityReportGeneratedAt: quality?.generatedAt,
  });
}

function isAutoApprovableStatus(status: KnowledgePipelineStatus | undefined): boolean {
  return status === undefined || status === 'draft' || status === 'quality_warn' || status === 'quality_error' || status === 'review_required';
}

function highestQualitySeverity(
  frontmatter: KnowledgeFrontmatter,
  sourceDocumentId: string,
  quality: ReturnType<typeof readKnowledgeQualityReport>,
): 'ok' | 'warn' | 'error' {
  if (frontmatter.quality_status === 'error') return 'error';
  if (frontmatter.quality_status === 'warn') return 'warn';
  if (!quality) return 'ok';
  const issueMatches = quality.issues.filter((issue) => {
    if (issue.documentId === frontmatter.id) return true;
    if (issue.sourceDocument === sourceDocumentId) return true;
    if (issue.sourceDocument === frontmatter.source_document_id) return true;
    if (issue.sourceDocument === frontmatter.source_document) return true;
    if (issue.source === frontmatter.source_document) return true;
    return false;
  });
  if (issueMatches.some((issue) => issue.severity === 'error')) return 'error';
  if (issueMatches.some((issue) => issue.severity === 'warn')) return 'warn';
  return 'ok';
}

function publishBlockReason(
  frontmatter: KnowledgeFrontmatter,
  quality: ReturnType<typeof readKnowledgeQualityReport>,
  gate: KnowledgeQualityGate,
): string | undefined {
  if (frontmatter.quality_status === 'error') return 'quality_status=error blocks publish';
  if (!quality && gate !== 'off') return 'quality audit report is required before publish';
  if (!quality || gate === 'off') return undefined;
  const issues = quality.issues.filter((i) => i.documentId === frontmatter.id);
  const hasError = issues.some((i) => i.severity === 'error');
  if (hasError) return 'error severity quality issue blocks publish';
  const hasWarn = issues.some((i) => i.severity === 'warn');
  if (gate === 'strict' && (frontmatter.quality_status === 'warn' || hasWarn)) {
    return 'strict quality gate blocks warning quality issues';
  }
  return undefined;
}

interface PublishedSliceResult {
  outputPath: string;
}

function publishOneDraft(
  workspaceRoot: string,
  sourceDocumentId: string,
  frontmatter: KnowledgeFrontmatter,
  body: string,
  publishId: string,
  auditWasAvailable: boolean,
): PublishedSliceResult | null {
  const moduleName = String(frontmatter.module ?? 'general');
  const sourceTitle = String(frontmatter.title ?? 'slice');
  const slug = safeSlug(sourceTitle);
  const targetDir = join(knowledgeRoot(workspaceRoot), 'whitepapers', moduleName, sourceDocumentId);
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, `${slug}.md`);
  const updated: KnowledgeFrontmatter = {
    ...frontmatter,
    status: 'active',
    pipeline_status: 'published',
    publish_id: publishId,
    quality_status: frontmatter.quality_status === 'unchecked' && auditWasAvailable ? 'ok' : frontmatter.quality_status ?? 'unchecked',
  };
  const serialized = serializeFrontmatter(updated as unknown as Record<string, unknown>, body);
  writeFileSync(targetPath, serialized, 'utf8');
  return { outputPath: targetPath.replace(`${workspaceRoot}/`, '') };
}

function writePublishReport(workspaceRoot: string, report: KnowledgePublishReport): KnowledgePublishReport {
  mkdirSync(pipelinePublishRoot(workspaceRoot), { recursive: true });
  writeFileSync(publishReportPath(workspaceRoot), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function safeSlug(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || createHash('sha1').update(value).digest('hex').slice(0, 12);
}

// Re-export helper for tests
export const __testing = { computeNextStatus, serializeFrontmatter, toYaml };
