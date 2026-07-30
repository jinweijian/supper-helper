import type { SuperHelperConfig } from '../config.js';
import type { Evidence } from '../domain.js';
import {
  readActiveKnowledgeGeneration,
  readKnowledgeChunks,
  resolveKnowledgeWorkspaceRoot,
} from '../knowledge/index.js';
import type { ExperienceCurrentEvidenceResolver } from './experience-agent.js';

export class KnowledgeExperienceEvidenceResolver implements ExperienceCurrentEvidenceResolver {
  constructor(private readonly config: SuperHelperConfig) {}

  resolve(
    input: Parameters<ExperienceCurrentEvidenceResolver['resolve']>[0],
  ): ReturnType<ExperienceCurrentEvidenceResolver['resolve']> {
    if (input.evidence.kind !== 'knowledge') return undefined;
    const workspaceRoot = resolveKnowledgeWorkspaceRoot(this.config, input.currentCase.workspaceId);
    const activeGeneration = readActiveKnowledgeGeneration(workspaceRoot);
    if (!activeGeneration) return undefined;
    const expectedChunkId = input.evidence.id.startsWith('ev_kb_')
      ? `chk_${input.evidence.id.slice('ev_kb_'.length)}`
      : undefined;
    if (!expectedChunkId) return undefined;
    const chunk = readKnowledgeChunks(
      workspaceRoot,
      activeGeneration.generation_id,
    ).chunks.find((item) => item.chunk_id === expectedChunkId);
    const currentGeneration = readActiveKnowledgeGeneration(workspaceRoot);
    if (
      !chunk ||
      currentGeneration?.generation_id !== activeGeneration.generation_id ||
      chunk.legacy ||
      chunk.artifact_version !== 4 ||
      chunk.chunking_strategy !== 'parent-child-v4' ||
      chunk.status !== 'active' ||
      chunk.quality_status !== 'ok' ||
      chunk.undersized_unmergeable ||
      chunk.manual_split_required
    ) {
      return undefined;
    }
    const evidence: Evidence = {
        ...input.evidence,
        source: chunk.source,
        summary: chunk.text,
        confidence: chunk.confidence,
        validation: {
          status: 'active',
          visibility: chunk.visibility,
          quality: 'ok',
          lastVerifiedAt: new Date().toISOString(),
        },
      };
    return {
      evidence,
      coverageEvidenceEnvelope: {
        evidenceId: evidence.id,
        kind: 'knowledge',
        safeText: chunk.text,
        freshness: 'current_knowledge_v4',
        validated: true,
        generationId: activeGeneration.generation_id,
        currentGenerationId: currentGeneration.generation_id,
        strictEligible: true,
      },
    };
  }
}
