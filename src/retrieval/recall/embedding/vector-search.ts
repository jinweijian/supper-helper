import { readKnowledgeChunks } from '../../../knowledge/indexes/chunks.js';
import { readKnowledgeVectorRecords } from '../../../knowledge/indexes/vector-index.js';
import { loadKnowledgeParentGrounding } from '../../../knowledge/documents/retrieval-grounding.js';
import type { KnowledgeVectorRecord } from '../../../knowledge/types.js';
import type { RetrievalCandidate } from '../../types.js';
import type { RetrievalInput } from '../../types.js';
import { createKnowledgeRetrievalCandidate } from '../knowledge-candidate.js';

export function searchVectorArtifacts(input: {
  workspaceRoot: string;
  queryVector: number[];
  limit: number;
}): RetrievalCandidate[] {
  return searchVectorArtifactsWithFilters(input).candidates;
}

export function searchVectorArtifactsWithFilters(input: {
  workspaceRoot: string;
  queryVector: number[];
  limit: number;
  moduleCandidates?: RetrievalInput['moduleCandidates'];
  intentCandidates?: RetrievalInput['intentCandidates'];
  sourceTypes?: RetrievalInput['sourceTypes'];
  visibility?: RetrievalInput['visibility'];
  generationId?: string;
}): { candidates: RetrievalCandidate[]; filteredOut: Array<{ reason: string; count: number }> } {
  const loadedVectors = readKnowledgeVectorRecords(input.workspaceRoot, input.generationId);
  const loadedChunks = readKnowledgeChunks(input.workspaceRoot, input.generationId);
  const chunkById = new Map(loadedChunks.chunks.map((chunk) => [chunk.chunk_id, chunk]));
  const parents = loadKnowledgeParentGrounding(input.workspaceRoot);
  const filtered = new Map<string, number>();

  const candidates = loadedVectors.records
    .map((record): RetrievalCandidate | undefined => {
      const chunk = chunkById.get(record.chunk_id);
      if (!chunk) {
        increment(filtered, 'missing_chunk');
        return undefined;
      }
      const parent = parents.get(chunk.parent_id) ?? parents.get(chunk.source);
      const frontmatter = parent?.document.frontmatter;
      const status = frontmatter?.status ?? chunk.status;
      const visibility = frontmatter?.visibility ?? chunk.visibility ?? 'internal';
      const module = frontmatter?.module ?? chunk.module;
      const intent = frontmatter?.intent ?? chunk.intent;
      const sourceType = frontmatter?.source_type ?? chunk.source_type;
      const quality = parent?.quality?.severity ?? chunk.quality_status;
      const reason = status !== 'active'
        ? `status_${status}`
        : visibility === 'restricted'
          ? 'restricted_visibility'
          : input.moduleCandidates?.length && !input.moduleCandidates.includes(module)
            ? 'module_filter'
            : input.intentCandidates?.length && !input.intentCandidates.includes(intent)
              ? 'intent_filter'
              : input.sourceTypes?.length && !input.sourceTypes.includes(sourceType)
                ? 'source_type_filter'
                : input.visibility?.length && !input.visibility.includes(visibility)
                  ? 'visibility_filter'
                  : quality !== 'ok' && quality !== 'info'
                    ? `quality_${quality ?? 'unknown'}`
                    : chunk.legacy
                      ? 'legacy_chunk'
                      : undefined;
      if (reason) {
        increment(filtered, reason);
        return undefined;
      }
      const score = vectorSimilarity(input.queryVector, record);
      if (score <= 0) {
        return undefined;
      }
      return createKnowledgeRetrievalCandidate({
        chunk,
        parent,
        score: Number(score.toFixed(8)),
      });
    })
    .filter((item): item is RetrievalCandidate => item !== undefined)
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit);
  return {
    candidates,
    filteredOut: Array.from(filtered.entries()).map(([reason, count]) => ({ reason, count })),
  };
}

function increment(target: Map<string, number>, reason: string): void {
  target.set(reason, (target.get(reason) ?? 0) + 1);
}

function vectorSimilarity(queryVector: number[], record: KnowledgeVectorRecord): number {
  if (queryVector.length === 0 || queryVector.length !== record.vector.length) {
    return 0;
  }
  if (record.distance === 'dot') {
    return dotProduct(queryVector, record.vector);
  }
  if (record.distance === 'euclidean') {
    let squared = 0;
    for (let index = 0; index < queryVector.length; index += 1) {
      const delta = queryVector[index]! - record.vector[index]!;
      squared += delta * delta;
    }
    return 1 / (1 + Math.sqrt(squared));
  }
  const queryNorm = vectorNorm(queryVector);
  const recordNorm = vectorNorm(record.vector);
  if (queryNorm === 0 || recordNorm === 0) {
    return 0;
  }
  return dotProduct(queryVector, record.vector) / (queryNorm * recordNorm);
}

function dotProduct(left: number[], right: number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index]! * right[index]!;
  }
  return total;
}

function vectorNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}
