import type { SuperHelperConfig } from '../config.js';
import type { Evidence } from '../domain.js';
import {
  extractKnowledgeTerms,
  readActiveKnowledgeGeneration,
  readKnowledgeChunks,
  resolveKnowledgeWorkspaceRoot,
} from '../knowledge/index.js';
import { loadKnowledgeParentGrounding } from '../knowledge/documents/retrieval-grounding.js';
import { createKnowledgeRetrievalCandidate } from '../retrieval/recall/knowledge-candidate.js';
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
    const parent = chunk
      ? loadKnowledgeParentGrounding(workspaceRoot).get(chunk.parent_id)
      : undefined;
    const matchedTerms = chunk && input.sourceRun.request?.answerGoal
      ? extractKnowledgeTerms(input.sourceRun.request.answerGoal.resolvedQuestion)
          .filter((term) => normalizeKnowledgeText(chunk.text).includes(normalizeKnowledgeText(term)))
      : [];
    const candidate = chunk && parent
      ? createKnowledgeRetrievalCandidate({ chunk, parent, matchedTerms, score: 1 })
      : undefined;
    const currentGeneration = readActiveKnowledgeGeneration(workspaceRoot);
    if (
      !chunk ||
      !parent ||
      !candidate?.answerSpan ||
      currentGeneration?.generation_id !== activeGeneration.generation_id ||
      chunk.legacy ||
      chunk.artifact_version !== 4 ||
      chunk.chunking_strategy !== 'parent-child-v4' ||
      chunk.status !== 'active' ||
      chunk.quality_status !== 'ok' ||
      chunk.undersized_unmergeable ||
      chunk.manual_split_required ||
      candidate.status !== 'active' ||
      !candidate.confidence ||
      candidate.confidence === 'low' ||
      candidate.quality?.severity !== 'ok' ||
      (candidate.groundingIssues?.length ?? 0) > 0 ||
      !isFresh(candidate.lastVerifiedAt)
    ) {
      return undefined;
    }
    const evidence: Evidence = {
        ...input.evidence,
        source: candidate.source,
        summary: candidate.answerSpan,
        confidence: candidate.confidence,
        validation: {
          status: 'active',
          visibility: candidate.visibility,
          quality: 'ok',
          lastVerifiedAt: candidate.lastVerifiedAt,
        },
      };
    return {
      evidence,
      coverageEvidenceEnvelope: {
        evidenceId: evidence.id,
        kind: 'knowledge',
        safeText: candidate.answerSpan,
        freshness: 'current_knowledge_v4',
        validated: true,
        generationId: activeGeneration.generation_id,
        currentGenerationId: currentGeneration.generation_id,
        strictEligible: true,
      },
    };
  }
}

function normalizeKnowledgeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function isFresh(value: string | undefined): value is string {
  if (!value) return false;
  const verifiedAt = Date.parse(value);
  const ageDays = (Date.now() - verifiedAt) / 86_400_000;
  return Number.isFinite(verifiedAt) && ageDays >= 0 && ageDays <= 180;
}
