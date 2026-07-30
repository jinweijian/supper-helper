import type {
  KnowledgeConfidence,
  KnowledgeDocumentType,
  KnowledgeEvidencePack,
  KnowledgeQualitySeverity,
  KnowledgeSourceType,
  KnowledgeStatus,
  KnowledgeVisibility,
} from '../knowledge/types.js';

export type RecallStrategyKind = 'lexical' | 'semantic' | 'business' | 'hybrid';

export interface RetrievalInput {
  workspaceRoot: string;
  query: string;
  /** Runtime-owned snapshot token. Callers should not set this directly. */
  knowledgeGenerationId?: string;
  limit?: number;
  moduleCandidates?: string[];
  intentCandidates?: string[];
  sourceTypes?: KnowledgeSourceType[];
  visibility?: KnowledgeVisibility[];
  normalizedQuery?: NormalizedQuery;
}

export interface NormalizedQuery {
  original: string;
  normalized: string;
  expandedTerms: string[];
}

export interface RetrievalCandidate {
  id: string;
  chunkId?: string;
  documentId: string;
  parentId?: string;
  source: string;
  sourceDocument?: string;
  sourceDocumentId?: string;
  sourcePages?: number[];
  sourceBlockIds?: string[];
  sectionPath?: string[];
  title?: string;
  type?: KnowledgeDocumentType;
  module?: string;
  intent?: string;
  sourceType?: KnowledgeSourceType;
  confidence?: KnowledgeConfidence;
  status?: KnowledgeStatus;
  visibility?: KnowledgeVisibility;
  lastVerifiedAt?: string;
  matchedTerms?: string[];
  summary?: string;
  excerpt?: string;
  answerSpan?: string;
  quality?: { severity: 'ok' | KnowledgeQualitySeverity; issues: string[] };
  groundingIssues?: string[];
  taxonomyKnown?: boolean;
  text: string;
  retrievalText?: string;
  score: number;
  finalScore?: number;
  rerankScore?: number;
  strategyScores?: RetrievalStrategyScore[];
  metadata?: Record<string, unknown>;
}

export interface RetrievalStrategyScore {
  strategyId: string;
  score: number;
  rank: number;
}

export interface RetrievalResult {
  query: string;
  candidates: RetrievalCandidate[];
  trace: RetrievalTrace;
  evidence: KnowledgeEvidencePack;
}

export interface RetrievalTrace {
  generationId?: string;
  strategies: RetrievalStrategyTrace[];
  fusion: {
    method: 'rrf' | 'none';
    inputCount: number;
    dedupedCount: number;
    finalCandidateCount: number;
  };
  rerank: {
    status: 'skipped' | 'ran' | 'failed';
    reason?: string;
    inputCount?: number;
    outputCount?: number;
  };
  filters: Array<{ reason: string; count: number }>;
}

export interface RetrievalStrategyTrace {
  id: string;
  kind?: RecallStrategyKind;
  status: 'ran' | 'skipped' | 'failed';
  candidateCount: number;
  reason?: string;
}
