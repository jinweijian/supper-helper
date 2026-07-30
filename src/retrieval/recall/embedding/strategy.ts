import type { EmbeddingProviderConfig } from '../../../providers/embedding/contract.js';
import { checkKnowledgeVectorCompatibility } from '../../../knowledge/vector-index.js';
import type { RecallInput, RecallStrategy } from '../contract.js';
import { searchVectorArtifactsWithFilters } from './vector-search.js';

type EmbeddingRecallConfig = Pick<EmbeddingProviderConfig, 'enabled'> & Partial<Pick<
  EmbeddingProviderConfig,
  'provider' | 'model' | 'dimensions' | 'distance'
>>;

interface EmbeddingRecallStrategyOptions {
  provider?: {
    embedQuery(input: { id?: string; text: string; metadata?: Record<string, unknown> }): Promise<{ vector: number[] }>;
  };
  embeddingConfig?: EmbeddingRecallConfig;
  unavailableReason?: string;
}

export function createEmbeddingRecallStrategy(input: EmbeddingRecallStrategyOptions = {}): RecallStrategy {
  return {
    id: 'embedding',
    kind: 'semantic',
    enabled: () => {
      if (!input.provider) {
        return { enabled: false, reason: input.unavailableReason ?? 'embedding provider not configured' };
      }
      if (input.embeddingConfig && input.embeddingConfig.enabled === false) {
        return { enabled: false, reason: 'embedding disabled' };
      }
      return { enabled: true };
    },
    async recall(recallInput: RecallInput) {
      if (!input.provider) {
        return { candidates: [] };
      }
      if (hasCompleteCompatibilityConfig(input.embeddingConfig)) {
        const compatibility = checkKnowledgeVectorCompatibility({
          workspaceRoot: recallInput.workspaceRoot,
          embeddingConfig: input.embeddingConfig,
          generationId: recallInput.knowledgeGenerationId,
        });
        if (compatibility.status !== 'compatible') {
          throw new Error(compatibility.reason ?? compatibility.status);
        }
      }
      const queryText = recallInput.normalizedQuery?.normalized ?? recallInput.query;
      const queryVector = await input.provider.embedQuery({ text: queryText });
      const searched = searchVectorArtifactsWithFilters({
        workspaceRoot: recallInput.workspaceRoot,
        queryVector: queryVector.vector,
        limit: recallInput.limit,
        moduleCandidates: recallInput.moduleCandidates,
        intentCandidates: recallInput.intentCandidates,
        sourceTypes: recallInput.sourceTypes,
        visibility: recallInput.visibility,
        generationId: recallInput.knowledgeGenerationId,
      });
      const candidates = searched.candidates;
      const missingParentCount = candidates.filter((candidate) => candidate.groundingIssues?.includes('missing_parent')).length;
      return {
        candidates,
        filteredOut: [
          ...searched.filteredOut,
          ...(missingParentCount > 0 ? [{ reason: 'missing_parent', count: missingParentCount }] : []),
        ],
      };
    },
  };
}

function hasCompleteCompatibilityConfig(
  config: EmbeddingRecallConfig | undefined,
): config is Pick<EmbeddingProviderConfig, 'enabled' | 'provider' | 'model' | 'dimensions' | 'distance'> {
  return Boolean(
    config &&
    typeof config.provider === 'string' &&
    typeof config.model === 'string' &&
    typeof config.dimensions === 'number' &&
    typeof config.distance === 'string',
  );
}
