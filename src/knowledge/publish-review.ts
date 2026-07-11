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

export interface ReviewDraftSlicesInput {
  workspaceRoot: string;
  sourceDocumentId: string;
  action: 'approve' | 'reject' | 'request_edits' | 'accept_warnings';
  reviewer: string;
  notes: string;
  ids?: string[];
}

export function reviewDraftSlices(input: ReviewDraftSlicesInput): KnowledgeSliceReviewRecord {
  if (!input.reviewer || input.reviewer.trim() === '') {
    throw new Error('reviewer is required');
  }
  if (!['approve', 'reject', 'request_edits', 'accept_warnings'].includes(input.action)) {
    throw new Error(`invalid review action: ${input.action}`);
  }
  if (input.action === 'accept_warnings' && input.notes.trim() === '') {
    throw new Error('accept_warnings requires explicit notes or quality issue id');
  }

  const draftRoot = join(input.workspaceRoot, 'knowledge', '_pipeline', 'drafts', input.sourceDocumentId);
  if (!existsSync(draftRoot)) {
    throw new Error(`No draft slices found for source ${input.sourceDocumentId}`);
  }

  const slices = readDraftSlices(input.workspaceRoot, input.sourceDocumentId);
  const targetSlices = input.ids?.length
    ? slices.filter((s) => input.ids?.some((id) => s.content.includes(`id: ${id}`)))
    : slices;

  const reviewedIds: string[] = [];
  const previousStatuses: string[] = [];
  const nextStatuses: string[] = [];
  const reviewId = `rev_${Date.now()}`;

  for (const slice of targetSlices) {
    const parsed = parseMarkdownDocument(slice.content, slice.path);
    const previousStatus = parsed.frontmatter.pipeline_status ?? 'draft';
    const nextStatus = computeNextStatus(previousStatus, input.action);
    parsed.frontmatter.pipeline_status = nextStatus as KnowledgePipelineStatus;
    if (input.action === 'reject') {
      parsed.frontmatter.quality_status = 'error';
    } else if (input.action === 'accept_warnings') {
      parsed.frontmatter.quality_status = 'warn';
    }
    if (input.action === 'approve' || input.action === 'accept_warnings') {
      parsed.frontmatter.status = 'draft' as KnowledgeStatus;
    } else if (input.action === 'reject') {
      parsed.frontmatter.status = 'review_required' as KnowledgeStatus;
    } else {
      parsed.frontmatter.status = 'review_required' as KnowledgeStatus;
    }
    parsed.frontmatter.review_id = reviewId;
    parsed.frontmatter.reviewer = input.reviewer;
    parsed.frontmatter.reviewed_at = new Date().toISOString().slice(0, 10);
    parsed.frontmatter.review_notes = input.notes;
    parsed.frontmatter.review_status = input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'pending';
    parsed.frontmatter.review_action = input.action;
    parsed.frontmatter.review_source = 'runtime';
    const serialized = serializeFrontmatter(parsed.frontmatter as unknown as Record<string, unknown>, parsed.body);
    writeFileSync(slice.path, serialized, 'utf8');
    reviewedIds.push(parsed.frontmatter.id);
    previousStatuses.push(previousStatus);
    nextStatuses.push(nextStatus);
  }

  const record: KnowledgeSliceReviewRecord = {
    reviewId,
    sourceDocumentId: input.sourceDocumentId,
    reviewer: input.reviewer,
    action: input.action,
    notes: input.notes,
    reviewedIds,
    previousStatuses,
    nextStatuses,
    qualityIssueIds: input.action === 'accept_warnings' ? ['manual_note'] : [],
    reviewedAt: new Date().toISOString(),
  };

  mkdirSync(pipelineReviewRoot(input.workspaceRoot), { recursive: true });
  writeFileSync(
    sourceReviewRecordPath(input.workspaceRoot, input.sourceDocumentId),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  );
  return record;
}

export function computeNextStatus(current: string, action: string): string {
  if (action === 'approve') return 'approved';
  if (action === 'reject') return 'rejected';
  if (action === 'request_edits') return 'review_required';
  if (action === 'accept_warnings') return 'approved';
  return current;
}
