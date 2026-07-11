export type KnowledgeDocumentType =
  | 'faq'
  | 'solved_case'
  | 'unresolved_case'
  | 'whitepaper_slice'
  | 'runbook'
  | 'module_overview'
  | 'glossary_term';

export type KnowledgeSourceType =
  | 'faq'
  | 'runbook'
  | 'solved_case'
  | 'unresolved_case'
  | 'whitepaper'
  | 'glossary'
  | 'module_doc'
  | 'ticket';

export type KnowledgeConfidence = 'low' | 'medium' | 'high';

export type KnowledgeStatus = 'draft' | 'review_required' | 'active' | 'deprecated' | 'archived';

export type KnowledgeVisibility = 'internal' | 'support' | 'customer_safe' | 'restricted';

// Pipeline stage and status enums
export type KnowledgePipelineStage =
  | 'intake'
  | 'extract'
  | 'normalize'
  | 'slice'
  | 'audit'
  | 'repair'
  | 'review'
  | 'publish'
  | 'index'
  | 'eval';

export type KnowledgePipelineStatus =
  | 'imported'
  | 'extracted'
  | 'normalized'
  | 'draft'
  | 'quality_warn'
  | 'quality_error'
  | 'review_required'
  | 'approved'
  | 'rejected'
  | 'published';

// Source block types
export type KnowledgeSourceBlockType =
  | 'heading'
  | 'paragraph'
  | 'list_item'
  | 'table'
  | 'toc'
  | 'header_footer'
  | 'image_caption'
  | 'unknown';

export interface KnowledgeSourceBlock {
  block_id: string;
  source_document_id: string;
  order: number;
  type: KnowledgeSourceBlockType;
  text: string;
  heading_level?: number;
  section_path: string[];
  raw?: string;
  parser?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeNormalizedBlock {
  block_id: string;
  source_document_id: string;
  source_block_id: string;
  order: number;
  type: KnowledgeSourceBlockType;
  text: string;
  normalized_text: string;
  section_path: string[];
  included_in_slice: boolean;
  excluded_reason?: string;
}

// Quality severity and issue codes
export type KnowledgeQualitySeverity = 'info' | 'warn' | 'error';

export type KnowledgeQualityIssueCode =
  // Source/parser issues
  | 'parser_empty'
  | 'too_many_unknown_blocks'
  | 'toc_not_removed'
  | 'header_footer_noise'
  | 'table_lost'
  | 'list_structure_lost'
  | 'heading_structure_broken'
  | 'duplicate_paragraphs'
  | 'source_provenance_missing'
  // Slice issues
  | 'empty_body'
  | 'heading_only'
  | 'toc_like'
  | 'too_short'
  | 'too_long'
  | 'duplicate_content'
  | 'multi_topic_slice'
  | 'broken_coreference'
  | 'not_answer_bearing'
  | 'missing_source_document'
  | 'missing_source_document_id'
  | 'missing_source_block_ids'
  | 'missing_source_blocks'
  | 'missing_section_path'
  | 'missing_parent'
  | 'orphan_chunk'
  | 'low_signal_terms';

export interface KnowledgeQualityIssue {
  code: KnowledgeQualityIssueCode;
  severity: KnowledgeQualitySeverity;
  message: string;
  documentId?: string;
  chunkId?: string;
  source?: string;
  sourceDocument?: string;
  sectionPath?: string[];
  contentHash?: string;
  details?: Record<string, unknown>;
}

export interface KnowledgeQualityThresholds {
  minBodyChars: number;
  maxParentChars: number;
  maxUnknownBlockRatio: number;
  minRelatedTerms: number;
  maxDuplicateNormalizedHashes: number;
  multiTopicHeadingThreshold: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: KnowledgeQualityThresholds = {
  minBodyChars: 80,
  maxParentChars: 2800,
  maxUnknownBlockRatio: 0.3,
  minRelatedTerms: 3,
  maxDuplicateNormalizedHashes: 1,
  multiTopicHeadingThreshold: 3,
};

export interface KnowledgeQualityReport {
  version: 1;
  workspaceRoot: string;
  knowledgeRoot: string;
  generatedAt: string;
  thresholds: KnowledgeQualityThresholds;
  inspected: {
    sourceDocuments: number;
    draftSlices: number;
    publishedSlices: number;
    chunks: number;
  };
  stageSummaries: Record<string, { warnings: number; errors: number; info: number }>;
  severityCounts: Record<KnowledgeQualitySeverity, number>;
  issueCounts: Record<string, number>;
  issues: KnowledgeQualityIssue[];
  recommendedActions: string[];
  gate: 'warn' | 'strict' | 'off';
}

// Frontmatter extended with optional pipeline fields
