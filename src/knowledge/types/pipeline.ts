import type { KnowledgeConfidence, KnowledgeDocumentType, KnowledgePipelineStage, KnowledgePipelineStatus, KnowledgeQualityReport, KnowledgeQualitySeverity, KnowledgeSourceType, KnowledgeStatus, KnowledgeVisibility } from './core.js';

export interface KnowledgeFrontmatter {
  id: string;
  title: string;
  type: KnowledgeDocumentType;
  module: string;
  intent: string;
  source_type: KnowledgeSourceType;
  confidence: KnowledgeConfidence;
  status: KnowledgeStatus;
  visibility: KnowledgeVisibility;
  product_versions: string[];
  related_terms: string[];
  related_repos: string[];
  last_verified_at: string;
  owner: string;
  source_document?: string;
  source_document_id?: string;
  source_pages?: number[];
  section_path?: string[];
  chunking_strategy?: string;
  tags?: string[];
  review_cycle_days?: number;
  // Optional pipeline fields (all must be optional for backward compatibility)
  quality_status?: 'unchecked' | 'ok' | 'warn' | 'error';
  source_block_ids?: string[];
  pipeline_stage?: KnowledgePipelineStage;
  pipeline_status?: KnowledgePipelineStatus;
  review_id?: string;
  publish_id?: string;
  repair_plan_ids?: string[];
  // Solved case review fields
  reviewer?: string;
  reviewed_at?: string;
  review_notes?: string;
  review_status?: 'pending' | 'approved' | 'rejected' | 'request_edits';
  review_action?: KnowledgeCaseReviewAction;
  review_source?: 'cli' | 'runtime' | 'api';
  // External source fields for imported ticket systems such as Redmine.
  external_source?: string;
  redmine_issue_id?: number;
  redmine_project?: string;
  redmine_tracker?: string;
  redmine_status?: string;
  redmine_priority?: string;
  verification_status?: 'verified' | 'partially_verified' | 'unverified';
  coverage_level?: 'full' | 'partial' | 'context_only';
  missing_items?: string[];
}

export interface KnowledgeDocument {
  frontmatter: KnowledgeFrontmatter;
  body: string;
  headings: string[];
  path: string;
  relativePath: string;
}

// Pipeline artifact reports
export interface KnowledgeExtractReport {
  version: 1;
  sourceDocumentId: string;
  generatedAt: string;
  parserStrategy: string;
  blockCounts: Record<string, number>;
  unknownBlockCount: number;
  skippedTocCount: number;
  warnings: string[];
  errors: string[];
  fatal: boolean;
}

export interface KnowledgeNormalizeReport {
  version: 1;
  sourceDocumentId: string;
  inputBlockCount: number;
  outputBlockCount: number;
  excludedBlockCounts: Record<string, number>;
  headingStructureWarnings: string[];
  generatedAt: string;
}

export interface KnowledgeDraftSliceReport {
  version: 1;
  sourceDocumentId: string;
  draftSliceCount: number;
  draftPaths: string[];
  sourceBlockCoverage: { included: number; total: number };
  coveredSourceBlockIds?: string[];
  uncoveredSourceBlockIds?: string[];
  warnings: string[];
  generatedAt: string;
}

export type KnowledgeRepairActionType =
  | 'merge_adjacent_short_slices'
  | 'split_oversized_slice'
  | 'remove_duplicate_draft'
  | 'add_section_path'
  | 'add_related_terms'
  | 'mark_review_required'
  | 'mark_quality_error'
  | 'manual_review_required';

export type KnowledgeRepairSafety = 'safe' | 'review_required';

export interface KnowledgeRepairAction {
  actionId: string;
  issueIds: string[];
  actionType: KnowledgeRepairActionType;
  targetPaths: string[];
  targetIds: string[];
  beforeSummary: string;
  afterSummary: string;
  safety: KnowledgeRepairSafety;
  requiresHumanReview: boolean;
  details?: Record<string, unknown>;
}

export interface KnowledgeRepairPlan {
  version: 1;
  planId: string;
  generatedAt: string;
  sourceReportPaths: string[];
  qualityReportPath: string;
  actions: KnowledgeRepairAction[];
  summary: { safe: number; reviewRequired: number; total: number };
  safetySummary: { safe: number; reviewRequired: number };
}

export interface KnowledgeRepairResult {
  planId: string;
  appliedActions: KnowledgeRepairAction[];
  skippedActions: KnowledgeRepairAction[];
  changedFiles: Array<{ path: string; previousHash: string; newHash: string }>;
  rollbackNotes: string[];
  generatedAt: string;
}

// Review records
export type KnowledgeCaseReviewAction = 'approve' | 'reject' | 'request_edits' | 'convert_to_unresolved' | 'accept_warnings';

export interface KnowledgeSliceReviewRecord {
  reviewId: string;
  sourceDocumentId: string;
  reviewer: string;
  action: 'approve' | 'reject' | 'request_edits' | 'accept_warnings';
  notes: string;
  reviewedIds: string[];
  previousStatuses: string[];
  nextStatuses: string[];
  qualityIssueIds: string[];
  reviewedAt: string;
}

export interface KnowledgeCaseReviewRecord {
  documentId: string;
  action: KnowledgeCaseReviewAction;
  reviewer: string;
  reviewedAt: string;
  notes: string;
  previousStatus: string;
  nextStatus: string;
  sourcePath: string;
  targetPath?: string;
  createdAt: string;
}

// Publish report
export interface KnowledgePublishReport {
  version: 1;
  publishId: string;
  generatedAt: string;
  publishedIds: string[];
  rejectedIds: string[];
  warningOverrides: Array<{ documentId: string; issueId: string; reason: string }>;
  sourceDocumentIds: string[];
  outputPaths: string[];
  indexDirty: boolean;
  qualityReportPath?: string;
  qualityReportGeneratedAt?: string;
}

// Acceptance report types
export type KnowledgeAcceptanceSeverity = 'ok' | 'info' | 'warn' | 'error';

export interface KnowledgeAcceptanceCheck {
  id: string;
  name: string;
  severity: KnowledgeAcceptanceSeverity;
  passed: boolean;
  message: string;
  redactedDetails?: Record<string, unknown>;
}

export interface KnowledgeAcceptanceScenario {
  id: string;
  name: string;
  question: string;
  passed: boolean;
  reason: string;
  caseId?: string;
  runId?: string;
  evidenceIds: string[];
  workerCallCount: number;
  logPhases: string[];
  checks: KnowledgeAcceptanceCheck[];
}

export interface KnowledgeAcceptanceReport {
  version: 1;
  generatedAt: string;
  workspaceRoot: string;
  configSummary: Record<string, string>;
  environmentSummary: Record<string, string>;
  redactionSummary: { fieldsRedacted: string[]; secretsStripped: boolean };
  scenarios: KnowledgeAcceptanceScenario[];
  failures: Array<{ scenarioId: string; reason: string }>;
  overallPassed: boolean;
}
