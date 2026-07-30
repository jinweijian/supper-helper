import type { RetrievalCandidate } from '../types.js';

export interface RetrievalReranker {
  rerank(input: {
    query: string;
    candidates: RetrievalCandidate[];
    limit: number;
  }): Promise<{ candidates: RetrievalCandidate[] }>;
}

// rerank 权重 0.7：cross-encoder 比 RRF 更可信，让 rerank 主导最终排序。
const RERANK_WEIGHT = 0.7;
const RRF_WEIGHT = 1 - RERANK_WEIGHT;

export function createProviderReranker(input: {
  provider?: {
    rerank(input: {
      query: string;
      documents: Array<{ id: string; text: string; metadata?: Record<string, unknown> }>;
      topN?: number;
    }): Promise<{ results: Array<{ id: string; score: number; index?: number }> }>;
  };
  topN?: number;
}): RetrievalReranker | undefined {
  if (!input.provider) {
    return undefined;
  }
  return {
    async rerank(request) {
      const documents = request.candidates.map((candidate) => ({
        id: candidate.chunkId ?? candidate.id,
        text: candidate.retrievalText ?? candidate.text,
        metadata: candidate.metadata,
      }));
      const result = await input.provider!.rerank({
        query: request.query,
        documents,
        topN: input.topN ?? request.limit,
      });
      const byId = new Map(request.candidates.map((candidate) => [candidate.chunkId ?? candidate.id, candidate]));
      const used = new Set<string>();
      const reranked: RetrievalCandidate[] = [];
      const rerankScores = new Map<string, number>();
      for (const item of result.results) {
        if (used.has(item.id)) continue;
        const candidate = byId.get(item.id);
        if (!candidate) continue;
        used.add(item.id);
        rerankScores.set(item.id, item.score);
        reranked.push({ ...candidate, rerankScore: item.score });
      }
      // finalScore 在本批 rerank 候选集内做 min-max 归一化后加权融合，
      // 避免 rerankScore 与 RRF 分量纲不一致导致 rerank 实际未主导排序。
      const rerankValues = reranked.map((candidate) => candidate.rerankScore ?? 0);
      const rrfValues = reranked.map((candidate) => candidate.finalScore ?? candidate.score);
      const rerankMin = Math.min(...rerankValues);
      const rerankMax = Math.max(...rerankValues);
      const rrfMin = Math.min(...rrfValues);
      const rrfMax = Math.max(...rrfValues);
      const fusedCandidates = reranked
        .map((candidate) => ({
          ...candidate,
          finalScore: fuseRerankFinalScore({
            rerankScore: candidate.rerankScore ?? 0,
            rrfScore: candidate.finalScore ?? candidate.score,
            rerankMin,
            rerankMax,
            rrfMin,
            rrfMax,
          }),
        }))
        .sort((left, right) => (right.finalScore ?? 0) - (left.finalScore ?? 0));
      return {
        candidates: [
          ...fusedCandidates,
          ...request.candidates
            .filter((candidate) => !used.has(candidate.chunkId ?? candidate.id))
            // 未被 rerank 返回的候选保留原 finalScore，不参与归一化（避免拉低 max）。
            .map((candidate) => ({ ...candidate })),
        ],
      };
    },
  };
}

function fuseRerankFinalScore(input: {
  rerankScore: number;
  rrfScore: number;
  rerankMin: number;
  rerankMax: number;
  rrfMin: number;
  rrfMax: number;
}): number {
  const normalizedRerank = normalizeInRange(input.rerankScore, input.rerankMin, input.rerankMax);
  const normalizedRrf = normalizeInRange(input.rrfScore, input.rrfMin, input.rrfMax);
  return Number((RERANK_WEIGHT * normalizedRerank + RRF_WEIGHT * normalizedRrf).toFixed(8));
}

// max === min 时（所有 rerank 分相同）退化为纯 RRF 排序：rerank 归一化值取 0，让 RRF 主导。
function normalizeInRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max === min) return 0;
  return (value - min) / (max - min);
}
