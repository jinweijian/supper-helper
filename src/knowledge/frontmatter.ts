import { parseSimpleYaml } from './frontmatter-yaml.js';
import {
  enumValue, optionalEnum, optionalNumber, optionalNumberArray, optionalString,
  optionalStringArray, requiredString, requiredStringArray,
} from './frontmatter-values.js';
import type {
  KnowledgeCaseReviewAction, KnowledgeConfidence, KnowledgeDocumentType, KnowledgeFrontmatter,
  KnowledgePipelineStage, KnowledgePipelineStatus, KnowledgeSourceType, KnowledgeStatus, KnowledgeVisibility,
} from './types.js';

const requiredFields = ['id', 'title', 'type', 'module', 'intent', 'source_type', 'confidence', 'status', 'visibility', 'product_versions', 'related_terms', 'related_repos', 'last_verified_at', 'owner'] as const;
const documentTypes = new Set<KnowledgeDocumentType>(['faq', 'solved_case', 'unresolved_case', 'whitepaper_slice', 'runbook', 'module_overview', 'glossary_term']);
const sourceTypes = new Set<KnowledgeSourceType>(['faq', 'runbook', 'solved_case', 'unresolved_case', 'whitepaper', 'glossary', 'module_doc', 'ticket']);
const confidences = new Set<KnowledgeConfidence>(['low', 'medium', 'high']);
const statuses = new Set<KnowledgeStatus>(['draft', 'review_required', 'active', 'deprecated', 'archived']);
const visibilities = new Set<KnowledgeVisibility>(['internal', 'support', 'customer_safe', 'restricted']);
const pipelineStatuses = new Set<KnowledgePipelineStatus>(['imported', 'extracted', 'normalized', 'draft', 'quality_warn', 'quality_error', 'review_required', 'approved', 'rejected', 'published']);
const pipelineStages = new Set<KnowledgePipelineStage>(['intake', 'extract', 'normalize', 'slice', 'audit', 'repair', 'review', 'publish', 'index', 'eval']);
const reviewStatuses = new Set<NonNullable<KnowledgeFrontmatter['review_status']>>(['pending', 'approved', 'rejected', 'request_edits']);
const reviewActions = new Set<KnowledgeCaseReviewAction>(['approve', 'reject', 'request_edits', 'convert_to_unresolved', 'accept_warnings']);
const qualityStatuses = new Set<NonNullable<KnowledgeFrontmatter['quality_status']>>(['unchecked', 'ok', 'warn', 'error']);
const verificationStatuses = new Set<NonNullable<KnowledgeFrontmatter['verification_status']>>(['verified', 'partially_verified', 'unverified']);
const coverageLevels = new Set<NonNullable<KnowledgeFrontmatter['coverage_level']>>(['full', 'partial', 'context_only']);

export interface ParsedMarkdownDocument { frontmatter: KnowledgeFrontmatter; body: string; }

export function parseMarkdownDocument(content: string, pathForError = 'document'): ParsedMarkdownDocument {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${pathForError}: missing YAML frontmatter`);
  const raw = parseSimpleYaml(match[1]!);
  const missing = requiredFields.filter((field) => raw[field] === undefined);
  if (missing.length) throw new Error(`${pathForError}: missing required frontmatter fields: ${missing.join(', ')}`);
  const frontmatter: KnowledgeFrontmatter = {
    id: requiredString(raw.id, 'id', pathForError), title: requiredString(raw.title, 'title', pathForError),
    type: enumValue(raw.type, documentTypes, 'type', pathForError), module: requiredString(raw.module, 'module', pathForError),
    intent: requiredString(raw.intent, 'intent', pathForError), source_type: enumValue(raw.source_type, sourceTypes, 'source_type', pathForError),
    confidence: enumValue(raw.confidence, confidences, 'confidence', pathForError), status: enumValue(raw.status, statuses, 'status', pathForError),
    visibility: enumValue(raw.visibility, visibilities, 'visibility', pathForError),
    product_versions: requiredStringArray(raw.product_versions, 'product_versions', pathForError),
    related_terms: requiredStringArray(raw.related_terms, 'related_terms', pathForError), related_repos: requiredStringArray(raw.related_repos, 'related_repos', pathForError),
    last_verified_at: requiredString(raw.last_verified_at, 'last_verified_at', pathForError), owner: requiredString(raw.owner, 'owner', pathForError),
    source_document: optionalString(raw.source_document), source_document_id: optionalString(raw.source_document_id),
    source_pages: optionalNumberArray(raw.source_pages, 'source_pages', pathForError), section_path: optionalStringArray(raw.section_path, 'section_path', pathForError),
    chunking_strategy: optionalString(raw.chunking_strategy), tags: optionalStringArray(raw.tags, 'tags', pathForError), review_cycle_days: optionalNumber(raw.review_cycle_days, 'review_cycle_days', pathForError),
    quality_status: optionalEnum(raw.quality_status, qualityStatuses), source_block_ids: optionalStringArray(raw.source_block_ids, 'source_block_ids', pathForError),
    pipeline_stage: optionalEnum(raw.pipeline_stage, pipelineStages), pipeline_status: optionalEnum(raw.pipeline_status, pipelineStatuses),
    review_id: optionalString(raw.review_id), publish_id: optionalString(raw.publish_id), repair_plan_ids: optionalStringArray(raw.repair_plan_ids, 'repair_plan_ids', pathForError),
    reviewer: optionalString(raw.reviewer), reviewed_at: optionalString(raw.reviewed_at), review_notes: optionalString(raw.review_notes),
    review_status: optionalEnum(raw.review_status, reviewStatuses), review_action: optionalEnum(raw.review_action, reviewActions),
    review_source: optionalEnum(raw.review_source, new Set(['cli', 'runtime', 'api'] as const)), external_source: optionalString(raw.external_source),
    redmine_issue_id: optionalNumber(raw.redmine_issue_id, 'redmine_issue_id', pathForError), redmine_project: optionalString(raw.redmine_project),
    redmine_tracker: optionalString(raw.redmine_tracker), redmine_status: optionalString(raw.redmine_status), redmine_priority: optionalString(raw.redmine_priority),
    verification_status: optionalEnum(raw.verification_status, verificationStatuses), coverage_level: optionalEnum(raw.coverage_level, coverageLevels),
    missing_items: optionalStringArray(raw.missing_items, 'missing_items', pathForError),
  };
  return { frontmatter, body: match[2] ?? '' };
}

export { parseSimpleYaml };
