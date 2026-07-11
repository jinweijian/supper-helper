import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  pipelineRepairPlansRoot,
  qualityReportPath,
  repairPlanPath,
  repairResultPath,
  sourceDraftRoot,
} from './paths.js';
import { parseMarkdownDocument } from './frontmatter.js';
import { serializeFrontmatter, toYaml } from './frontmatter-serializer.js';
import { readKnowledgeQualityReport, writeKnowledgeQualityReport } from './quality.js';
import { readDraftSlices } from './slicer.js';
import type {
  KnowledgeRepairAction,
  KnowledgeRepairActionType,
  KnowledgeRepairPlan,
  KnowledgeRepairResult,
  KnowledgeRepairSafety,
} from './types.js';

interface GeneratePlanInput {
  workspaceRoot: string;
  qualityReportPath?: string;
}

export function generateKnowledgeRepairPlan(input: GeneratePlanInput): KnowledgeRepairPlan {
  const reportPath = input.qualityReportPath ?? qualityReportPath(input.workspaceRoot);
  const quality = existsSync(reportPath) ? readKnowledgeQualityReport(input.workspaceRoot) : undefined;
  if (!quality) {
    return emptyPlan(reportPath);
  }

  const actions: KnowledgeRepairAction[] = [];
  const issueToAction = new Map<string, KnowledgeRepairAction>();
  let counter = 0;
  const nextActionId = (): string => `act_${Date.now()}_${String(++counter).padStart(4, '0')}`;

  for (const issue of quality.issues) {
    if (!issue.documentId) {
      continue;
    }
    const mapping = mapIssueToAction(issue);
    if (!mapping) {
      continue;
    }
    const existing = issueToAction.get(`${issue.documentId}:${mapping.actionType}`);
    if (existing) {
      existing.issueIds.push(issue.code);
      continue;
    }
    const action: KnowledgeRepairAction = {
      actionId: nextActionId(),
      issueIds: [issue.code],
      actionType: mapping.actionType,
      targetPaths: issue.source ? [issue.source] : [],
      targetIds: [issue.documentId],
      beforeSummary: mapping.beforeSummary(issue),
      afterSummary: mapping.afterSummary(issue),
      safety: mapping.safety,
      requiresHumanReview: mapping.safety === 'review_required',
      details: mapping.details(issue),
    };
    actions.push(action);
    issueToAction.set(`${issue.documentId}:${mapping.actionType}`, action);
  }

  return {
    version: 1,
    planId: `plan_${Date.now()}`,
    generatedAt: new Date().toISOString(),
    sourceReportPaths: [reportPath],
    qualityReportPath: reportPath,
    actions,
    summary: {
      safe: actions.filter((a) => a.safety === 'safe').length,
      reviewRequired: actions.filter((a) => a.safety === 'review_required').length,
      total: actions.length,
    },
    safetySummary: {
      safe: actions.filter((a) => a.safety === 'safe').length,
      reviewRequired: actions.filter((a) => a.safety === 'review_required').length,
    },
  };
}

function emptyPlan(reportPath: string): KnowledgeRepairPlan {
  return {
    version: 1,
    planId: `plan_${Date.now()}`,
    generatedAt: new Date().toISOString(),
    sourceReportPaths: reportPath ? [reportPath] : [],
    qualityReportPath: reportPath,
    actions: [],
    summary: { safe: 0, reviewRequired: 0, total: 0 },
    safetySummary: { safe: 0, reviewRequired: 0 },
  };
}

function mapIssueToAction(issue: { code: string; documentId?: string }): {
  actionType: KnowledgeRepairActionType;
  safety: KnowledgeRepairSafety;
  beforeSummary: (i: { code: string; documentId?: string }) => string;
  afterSummary: (i: { code: string; documentId?: string }) => string;
  details: (i: { code: string; documentId?: string }) => Record<string, unknown>;
} | undefined {
  switch (issue.code) {
    case 'too_short':
      return {
        actionType: 'merge_adjacent_short_slices',
        safety: 'safe',
        beforeSummary: () => 'Two adjacent short slices in the same section.',
        afterSummary: () => 'Merge adjacent short slices when source block order allows.',
        details: () => ({}),
      };
    case 'too_long':
      return {
        actionType: 'split_oversized_slice',
        safety: 'review_required',
        beforeSummary: () => 'Slice exceeds parent char limit; needs split on heading/list/table boundary.',
        afterSummary: () => 'Mark slice as manual_review_required for splitting.',
        details: () => ({}),
      };
    case 'duplicate_content':
      return {
        actionType: 'remove_duplicate_draft',
        safety: 'review_required',
        beforeSummary: () => 'Draft slice content duplicates another draft slice.',
        afterSummary: () => 'Mark for review; do not auto-delete published slices.',
        details: () => ({}),
      };
    case 'missing_section_path':
      return {
        actionType: 'add_section_path',
        safety: 'safe',
        beforeSummary: () => 'Section path is missing.',
        afterSummary: () => 'Inherit section path from source heading block provenance.',
        details: () => ({}),
      };
    case 'low_signal_terms':
      return {
        actionType: 'add_related_terms',
        safety: 'safe',
        beforeSummary: () => 'Related terms are too few to be searchable.',
        afterSummary: () => 'Backfill related_terms from title, section path, and module aliases.',
        details: () => ({}),
      };
    case 'multi_topic_slice':
    case 'broken_coreference':
    case 'table_lost':
    case 'missing_source_block_ids':
    case 'missing_source_blocks':
    case 'duplicate_paragraphs':
    case 'heading_structure_broken':
    case 'too_many_unknown_blocks':
    case 'toc_not_removed':
    case 'header_footer_noise':
    case 'list_structure_lost':
    case 'parser_empty':
    case 'source_provenance_missing':
      return {
        actionType: 'manual_review_required',
        safety: 'review_required',
        beforeSummary: () => 'Issue requires human review before any structural fix.',
        afterSummary: () => 'Mark slice as review_required; do not auto-apply.',
        details: () => ({}),
      };
    case 'empty_body':
    case 'heading_only':
    case 'toc_like':
    case 'not_answer_bearing':
      return {
        actionType: 'mark_review_required',
        safety: 'safe',
        beforeSummary: () => 'Slice content cannot justify a direct answer.',
        afterSummary: () => 'Set pipeline_status=review_required and skip from publish gate.',
        details: () => ({}),
      };
    default:
      return undefined;
  }
}
