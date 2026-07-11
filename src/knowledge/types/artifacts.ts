import type { KnowledgeConfidence, KnowledgeDocumentType, KnowledgePipelineStatus, KnowledgeQualitySeverity, KnowledgeSourceType, KnowledgeStatus, KnowledgeVisibility } from './core.js';
import type { KnowledgeFrontmatter } from './pipeline.js';

export interface KnowledgeSourceDocument {
  id: string;
  source_type: string;
  path: string;
  sha256?: string;
  title: string;
  downloaded_at?: string;
  source_url?: string;
  product_versions?: string[];
  page_count?: number;
  owner?: string;
  ingest_tool_version?: string;
  // Pipeline fields
  original_path?: string;
  stored_path?: string;
  parser?: string;
  imported_at?: string;
  source_kind?: string;
  pipeline_status?: KnowledgePipelineStatus;
}

export interface KnowledgeChunk {
  chunk_id: string;
  parent_id: string;
  source: string;
  source_document?: string;
  source_document_id?: string;
  source_pages?: number[];
  module: string;
  intent: string;
  source_type: KnowledgeSourceType;
  status: KnowledgeStatus;
  confidence: KnowledgeConfidence;
  visibility?: KnowledgeVisibility;
  headings: string[];
  keywords: string[];
  text: string;
  child_order?: number;
  source_block_ids?: string[];
  section_path?: string[];
  text_hash?: string;
  parent_title?: string;
  parent_terms?: string[];
  quality_status?: 'unchecked' | 'ok' | 'warn' | 'error';
  chunking_strategy?: string;
  artifact_version?: 2 | 3;
  legacy?: boolean;
  manual_split_required?: boolean;
  overlap_chars?: number;
}

export interface KnowledgeVectorRecord {
  vector_id: string;
  source: string;
  document_id: string;
  chunk_id: string;
  text_hash: string;
  provider: string;
  model: string;
  dimensions: number;
  distance: string;
  vector: number[];
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeVectorManifest {
  version: 1;
  provider: string;
  model: string;
  dimensions: number;
  distance: string;
  source_chunk_manifest_hash: string;
  vector_count: number;
  skipped_count: number;
  failed_count: number;
  generated_at: string;
  embedding_config_fingerprint: string;
}

export interface KnowledgeVectorBuildReport {
  version: 1;
  generatedAt: string;
  provider: string;
  model: string;
  dimensions: number;
  distance: string;
  vectorCount: number;
  skipped: Array<{ chunkId: string; textHash: string; reason: string }>;
  failures: Array<{ chunkId: string; textHash?: string; error: string }>;
  durationMs: number;
  vectorsPath: string;
  manifestPath: string;
}

export interface KnowledgeEvidenceResult {
  evidence_id: string;
  document_id: string;
  parent_id: string;
  chunk_id?: string;
  source: string;
  source_document?: string;
  source_document_id?: string;
  source_pages?: number[];
  source_block_ids?: string[];
  section_path?: string[];
  title: string;
  type: KnowledgeDocumentType;
  module: string;
  intent: string;
  source_type: KnowledgeSourceType;
  confidence: KnowledgeConfidence;
  status: KnowledgeStatus;
  visibility: KnowledgeVisibility;
  last_verified_at?: string;
  matched_terms: string[];
  summary: string;
  excerpt: string;
  answer_span?: string;
  grounding_issues?: string[];
  taxonomy_known?: boolean;
  score: number;
  retrieval?: {
    source: 'keyword' | 'vector' | 'hybrid' | 'rerank';
    keywordScore?: number;
    vectorScore?: number;
    rerankScore?: number;
    fieldContributions?: Record<string, number>;
  };
  quality?: { severity: 'ok' | 'info' | 'warn' | 'error'; issues: string[] };
}

export interface KnowledgeSearchQuery {
  workspaceRoot: string;
  query: string;
  moduleCandidates?: string[];
  intentCandidates?: string[];
  sourceTypes?: KnowledgeSourceType[];
  productVersions?: string[];
  visibility?: KnowledgeVisibility[];
  limit?: number;
}

export interface KnowledgeRoute {
  normalizedQuestion: string;
  moduleCandidates: string[];
  intentCandidates: string[];
  keywords: string[];
  sourceTypes: KnowledgeSourceType[];
  codeEscalationSignals: string[];
  risks: string[];
}

export interface KnowledgeEvidencePack {
  query: {
    normalized_question: string;
    module_candidates: string[];
    intent_candidates: string[];
    keywords: string[];
  };
  results: KnowledgeEvidenceResult[];
  coverage: {
    searched_files: number;
    matched_files: number;
    filtered_out: Array<{ reason: string; count: number }>;
  };
}

export interface KnowledgeIndexManifest {
  version: 1;
  updated_at: string;
  document_count: number;
  chunk_count: number;
  source_document_count: number;
  documents: Array<{
    id: string;
    path: string;
    title: string;
    type: KnowledgeDocumentType;
    module: string;
    intent: string;
    status: KnowledgeStatus;
    confidence: KnowledgeConfidence;
  }>;
  taxonomy?: { known_modules: string[]; unknown_modules: string[] };
}

export interface KnowledgeInitResult {
  knowledgeRoot: string;
  created: boolean;
  directories: string[];
  files: string[];
  ingestReportPath?: string;
  qualityReportPath?: string;
  sourceQualityReportPath?: string;
  qualityGateResult?: {
    passed: boolean;
    exitCode: number;
    reason?: string;
  };
  qualitySeverityCounts?: Record<KnowledgeQualitySeverity, number>;
  qualityIssueCounts?: Record<string, number>;
}

export interface KnowledgeIngestReport {
  version: 1;
  sourceDir?: string;
  parserStrategy: string;
  compatibility_mode?: 'legacy_active_publish';
  quality_gate_bypassed?: boolean;
  sourceDocuments: number;
  parentSlices: number;
  chunks: number;
  skipped: Array<{ path: string; reason: string }>;
  imported: Array<{
    sourcePath: string;
    sourceDocumentId: string;
    sourceDocumentPath: string;
    parentSliceIds: string[];
    // Pipeline artifact paths
    sourceMetaPath?: string;
    blocksPath?: string;
    normalizedBlocksPath?: string;
    draftRoot?: string;
    publishReportPath?: string;
  }>;
  generatedAt: string;
}

export interface KnowledgeUpdateResult {
  knowledgeRoot: string;
  documentCount: number;
  chunkCount: number;
  sourceDocumentCount: number;
  manifestPath: string;
  chunksPath: string;
  qualityReportPath?: string;
  sourceQualityReportPath?: string;
  qualityGateResult?: {
    passed: boolean;
    exitCode: number;
    reason?: string;
  };
  qualitySeverityCounts?: Record<KnowledgeQualitySeverity, number>;
  qualityIssueCounts?: Record<string, number>;
  taxonomyWarnings?: string[];
}
