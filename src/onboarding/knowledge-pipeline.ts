import { createEmbeddingProvider } from '../providers/embedding/factory.js';
import {
  approveQualityCleanDraftSlices,
  auditKnowledgeQuality,
  buildDraftSlices,
  discoverSourceFiles,
  extractSourceBlocks,
  initKnowledgeWorkspace,
  intakeSourceDocument,
  normalizeSourceBlocks,
  publishApprovedDraftSlices,
  writeKnowledgeQualityReport,
  writeSourceQualityReport,
} from '../knowledge/index.js';
import { rebuildKnowledgeArtifacts } from '../application/knowledge-rebuild-service.js';
import type { OnboardingDraft, OnboardingStageId } from './types.js';
import { providerHasExecutionCredentials } from './provider-credentials.js';

export interface KnowledgeStageProgress {
  stage: OnboardingStageId;
  processed: number;
  total: number;
  message: string;
}

export interface OnboardingKnowledgePipelineResult {
  sources: number;
  reusedSources: number;
  processedSources: number;
  draftSlices: number;
  approvedSlices: number;
  pendingReviewSlices: number;
  blockedSlices: number;
  publishedSlices: number;
  indexedDocuments: number;
  indexedChunks: number;
  vectorCount: number;
}

export async function runOnboardingKnowledgePipeline(input: {
  draft: OnboardingDraft;
  workspaceRoot: string;
  report(progress: KnowledgeStageProgress): void;
}): Promise<OnboardingKnowledgePipelineResult> {
  initKnowledgeWorkspace({
    workspaceRoot: input.workspaceRoot,
    qualityGate: 'off',
    chunking: input.draft.knowledge.chunking,
  });

  const files = discoverSourceFiles(input.draft.knowledge.sourceDir)
    .filter((path) => /\.(docx|md|markdown)$/i.test(path));
  const total = files.length;
  const sources = files.map((sourcePath, index) => {
    const result = intakeSourceDocument({
      workspaceRoot: input.workspaceRoot,
      sourcePath,
    });
    input.report({
      stage: 'ingest_sources',
      processed: index + 1,
      total,
      message: result.reused
        ? `Reused ${index + 1}/${total}: ${sourcePath}`
        : `Ingested ${index + 1}/${total}: ${sourcePath}`,
    });
    return result;
  });
  const changed = sources.filter((source) => !source.reused);
  let draftSlices = 0;

  for (let index = 0; index < changed.length; index += 1) {
    const source = changed[index]!;
    const extracted = extractSourceBlocks({
      workspaceRoot: input.workspaceRoot,
      sourceDocumentId: source.sourceDocumentId,
      sourcePath: source.sourcePath,
    });
    input.report(stageProgress('extract_sources', index, changed.length, source.sourcePath));

    const normalized = normalizeSourceBlocks({
      workspaceRoot: input.workspaceRoot,
      sourceDocumentId: source.sourceDocumentId,
      blocks: extracted.blocks,
    });
    input.report(stageProgress('normalize_sources', index, changed.length, source.sourcePath));

    const slices = buildDraftSlices({
      workspaceRoot: input.workspaceRoot,
      sourceDocumentId: source.sourceDocumentId,
      sourceTitle: source.sourceTitle,
      sourceKind: source.sourceKind,
      sourceDocumentPath: source.sourceDocumentRelativePath,
      normalizedBlocks: normalized.blocks,
    });
    draftSlices += slices.draftIds.length;
    input.report(stageProgress('slice_sources', index, changed.length, source.sourcePath));
  }

  const quality = auditKnowledgeQuality({ workspaceRoot: input.workspaceRoot, gate: 'warn' });
  writeKnowledgeQualityReport({ workspaceRoot: input.workspaceRoot, report: quality });
  writeSourceQualityReport({ workspaceRoot: input.workspaceRoot, report: quality });
  input.report({
    stage: 'audit_slices',
    processed: quality.inspected.draftSlices,
    total: Math.max(quality.inspected.draftSlices, draftSlices),
    message: `Audited ${quality.inspected.draftSlices} draft slices`,
  });

  const approval = approveQualityCleanDraftSlices({
    workspaceRoot: input.workspaceRoot,
    reviewer: 'super-helper-onboarding',
  });
  const publish = publishApprovedDraftSlices({
    workspaceRoot: input.workspaceRoot,
    qualityGate: 'strict',
  });
  input.report({
    stage: 'publish_approved',
    processed: publish.publishedIds.length,
    total: approval.approvedIds.length,
    message: `Published ${publish.publishedIds.length}/${approval.approvedIds.length} quality-clean draft slices`,
  });

  const vectorEnabled = input.draft.knowledge.buildVectorIndex
    && input.draft.embedding.enabled
    && providerHasExecutionCredentials(input.draft.embedding);
  const rebuilt = await rebuildKnowledgeArtifacts({
    workspaceRoot: input.workspaceRoot,
    chunking: input.draft.knowledge.chunking,
    ...(vectorEnabled
      ? {
          embedding: {
            enabled: true,
            provider: createEmbeddingProvider(input.draft.embedding),
            config: input.draft.embedding,
          },
          onVectorProgress: (progress: { processed: number; total: number }) => {
            input.report({
              stage: 'build_vector_index',
              processed: progress.processed,
              total: progress.total,
              message: `Built vector batch ${progress.processed}/${progress.total}`,
            });
          },
        }
      : {}),
  });
  const index = rebuilt.index;
  input.report({
    stage: 'build_keyword_index',
    processed: index.chunkCount,
    total: index.chunkCount,
    message: `Indexed ${index.documentCount} documents and ${index.chunkCount} chunks`,
  });

  const vectorCount = rebuilt.vector?.vectorCount ?? 0;
  if (!vectorEnabled) {
    input.report({
      stage: 'build_vector_index',
      processed: 0,
      total: 0,
      message: 'Vector index skipped: embedding disabled, not requested, or credentials unavailable',
    });
  }

  return {
    sources: total,
    reusedSources: sources.length - changed.length,
    processedSources: changed.length,
    draftSlices,
    approvedSlices: approval.approvedIds.length,
    pendingReviewSlices: approval.pendingReviewIds.length,
    blockedSlices: approval.blockedIds.length,
    publishedSlices: publish.publishedIds.length,
    indexedDocuments: index.documentCount,
    indexedChunks: index.chunkCount,
    vectorCount,
  };
}

function stageProgress(
  stage: 'extract_sources' | 'normalize_sources' | 'slice_sources',
  index: number,
  total: number,
  sourcePath: string,
): KnowledgeStageProgress {
  return {
    stage,
    processed: index + 1,
    total,
    message: `${stage} ${index + 1}/${total}: ${sourcePath}`,
  };
}
