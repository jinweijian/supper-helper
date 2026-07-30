import { retrievalCandidatesToEvidencePack } from './evidence-pack.js';
import { redactProviderErrorMessage } from '../providers/redaction.js';
import { readActiveKnowledgeGeneration } from '../knowledge/generation-store.js';
import { fuseWithRrf } from './fusion/rrf.js';
import { normalizeStrategyCandidates } from './fusion/normalize.js';
import type { NormalizedQuery } from './query/normalize.js';
import type { RecallStrategy } from './recall/contract.js';
import type { RetrievalReranker } from './rerank/service.js';
import { createEmptyRetrievalTrace } from './trace.js';
import { dedupeRetrievalCandidatesByParent } from './parent-dedupe.js';
import type {
  RetrievalCandidate,
  RetrievalInput,
  RetrievalResult,
} from './types.js';

export interface RetrievalService {
  retrieve(input: RetrievalInput): Promise<RetrievalResult>;
}

export type QueryNormalizer = (query: string, workspaceRoot: string) => NormalizedQuery;

export function createRetrievalService(input: {
  strategies: RecallStrategy[];
  reranker?: RetrievalReranker;
  rerankerUnavailableReason?: string;
  recallLimit?: number;
  fusionLimit?: number;
  queryNormalizer?: QueryNormalizer;
}): RetrievalService {
  return {
    async retrieve(request) {
      const limit = request.limit ?? 8;
      const recallLimit = input.recallLimit ?? limit;
      const fusionLimit = input.fusionLimit ?? recallLimit;
      const trace = createEmptyRetrievalTrace();
      const normalizedQuery = request.normalizedQuery ?? input.queryNormalizer?.(request.query, request.workspaceRoot);
      const knowledgeGenerationId = readActiveKnowledgeGeneration(request.workspaceRoot)?.generation_id;
      if (knowledgeGenerationId) trace.generationId = knowledgeGenerationId;
      const recallRequest = { ...request, normalizedQuery, knowledgeGenerationId };
      const recalled: RetrievalCandidate[] = [];
      const filteredOut: Array<{ reason: string; count: number }> = [];

      for (const strategy of input.strategies) {
        const enabled = normalizeEnabledResult(strategy.enabled({ workspaceRoot: request.workspaceRoot }));
        if (!enabled.enabled) {
          trace.strategies.push({
            id: strategy.id,
            kind: strategy.kind,
            status: 'skipped',
            candidateCount: 0,
            reason: enabled.reason ?? 'disabled',
          });
          continue;
        }
        try {
          const result = await strategy.recall({ ...recallRequest, limit: recallLimit });
          const normalized = normalizeStrategyCandidates({
            strategyId: strategy.id,
            candidates: result.candidates,
          });
          recalled.push(...normalized);
          mergeFilteredOut(filteredOut, result.filteredOut ?? []);
          trace.strategies.push({
            id: strategy.id,
            kind: strategy.kind,
            status: 'ran',
            candidateCount: normalized.length,
          });
        } catch (error) {
          const reason = redactProviderErrorMessage(error);
          filteredOut.push({ reason: `${strategy.id}_failed`, count: 1 });
          trace.strategies.push({
            id: strategy.id,
            kind: strategy.kind,
            status: 'failed',
            candidateCount: 0,
            reason,
          });
        }
      }

      const fused = fuseWithRrf(recalled);
      // dedupe 在 rerank 之前：同 parent 的多个 child 合并为代表，避免重复消耗 rerank 配额，
      // 也避免两条 rerank 结果恰好同 parent 而在去重后只剩一条有效。
      const fusionSliced = fused.candidates.slice(0, fusionLimit);
      let candidates = dedupeRetrievalCandidatesByParent(fusionSliced);
      const parentDedupeCount = fusionSliced.length - candidates.length;
      trace.fusion = {
        method: 'rrf',
        inputCount: fused.inputCount,
        // 策略级 chunk 去重 + parent 去重合并计入 dedupedCount，反映 fusion 阶段总缩减量。
        dedupedCount: fused.dedupedCount + parentDedupeCount,
        finalCandidateCount: candidates.length,
      };
      if (input.reranker && candidates.length > 0) {
        try {
          trace.rerank = {
            status: 'ran',
            inputCount: candidates.length,
          };
          // rerank 用 original query（避免扩展噪声干扰 cross-encoder）。
          const reranked = await input.reranker.rerank({
            query: normalizedQuery?.original ?? request.query,
            candidates,
            limit,
          });
          candidates = reranked.candidates;
          trace.rerank.outputCount = candidates.length;
        } catch (error) {
          trace.rerank = {
            status: 'failed',
            reason: redactProviderErrorMessage(error),
            inputCount: candidates.length,
            outputCount: candidates.length,
          };
        }
      } else {
        trace.rerank = {
          status: 'skipped',
          reason: input.reranker ? 'no candidates' : input.rerankerUnavailableReason ?? 'not configured',
          inputCount: candidates.length,
          outputCount: candidates.length,
        };
      }

      const finalCandidates = candidates.slice(0, limit);
      trace.fusion.finalCandidateCount = finalCandidates.length;
      trace.filters = filteredOut;
      return {
        query: request.query,
        candidates: finalCandidates,
        trace,
        evidence: retrievalCandidatesToEvidencePack({
          request,
          candidates: finalCandidates,
          filteredOut,
        }),
      };
    },
  };
}

function mergeFilteredOut(
  target: Array<{ reason: string; count: number }>,
  additions: Array<{ reason: string; count: number }>,
): void {
  for (const addition of additions) {
    const existing = target.find((item) => item.reason === addition.reason);
    if (existing) {
      existing.count += addition.count;
    } else {
      target.push({ ...addition });
    }
  }
}

function normalizeEnabledResult(value: boolean | { enabled: boolean; reason?: string }): { enabled: boolean; reason?: string } {
  return typeof value === 'boolean' ? { enabled: value } : value;
}
