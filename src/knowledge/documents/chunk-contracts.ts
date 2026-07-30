export interface KnowledgeChunkingOptions {
  maxChars?: number;
  overlapStrategy?: 'sentence' | 'sliding';
  overlapChars?: number;
  minChars?: number;
}

export interface NormalizedChunkingOptions {
  maxChars: number;
  overlapStrategy: 'sentence' | 'sliding';
  overlapChars: number;
  minChars: number;
}

export const DEFAULT_CHUNKING_OPTIONS: NormalizedChunkingOptions = {
  maxChars: 800,
  overlapStrategy: 'sentence',
  overlapChars: 120,
  minChars: 80,
};

export const CURRENT_CHUNKING_STRATEGY = 'parent-child-v4';
export const CURRENT_ARTIFACT_VERSION = 4;
export const MAX_RETRIEVAL_SECTION_PREFIX_CODE_POINTS = 240;
