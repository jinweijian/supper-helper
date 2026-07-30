import type { EmbeddingArtifactConfig, EmbeddingDocumentPort } from '../contracts/embedding.js';
import type { KnowledgeChunkingOptions } from '../knowledge/documents/chunk-contracts.js';
import {
  KnowledgeGenerationConflictError,
  createFileKnowledgeGenerationPublisher,
  type KnowledgeGenerationPublisherPort,
  type KnowledgeGenerationPointer,
} from '../knowledge/generation-store.js';
import {
  finalizeKnowledgeIndexGeneration,
  prepareKnowledgeIndexGeneration,
  type PreparedKnowledgeIndexGeneration,
} from '../knowledge/indexes/build.js';
import {
  prepareKnowledgeVectorGeneration,
  type BuildKnowledgeVectorIndexResult,
} from '../knowledge/vector-index.js';
import {
  auditKnowledgeQuality,
  evaluateQualityGate,
  writeKnowledgeQualityReport,
  writeSourceQualityReport,
  type KnowledgeQualityGate,
} from '../knowledge/quality.js';

export interface KnowledgeRebuildResult {
  generation: KnowledgeGenerationPointer;
  index: PreparedKnowledgeIndexGeneration['result'];
  vector?: BuildKnowledgeVectorIndexResult;
}

export async function rebuildKnowledgeArtifacts(input: {
  workspaceRoot: string;
  chunking?: KnowledgeChunkingOptions;
  embedding?: {
    enabled: boolean;
    provider: EmbeddingDocumentPort;
    config: EmbeddingArtifactConfig;
  };
  onVectorProgress?: (progress: { processed: number; total: number }) => void;
  publisher?: KnowledgeGenerationPublisherPort;
}): Promise<KnowledgeRebuildResult> {
  const publisher = input.publisher ?? createFileKnowledgeGenerationPublisher(input.workspaceRoot);
  const expectedActiveGenerationId = publisher.readActive()?.generation_id;
  const index = prepareKnowledgeIndexGeneration({
    workspaceRoot: input.workspaceRoot,
    chunking: input.chunking,
  });

  if (input.embedding?.enabled) {
    const vector = await prepareKnowledgeVectorGeneration({
      workspaceRoot: input.workspaceRoot,
      chunks: index.chunks,
      provider: input.embedding.provider,
      config: input.embedding.config,
      onProgress: input.onVectorProgress,
    });
    if (vector.result.failures.length > 0) {
      throw new Error('embedding_generation_incomplete');
    }
    const generation = publisher.publish({
      expectedActiveGenerationId,
      mode: 'hybrid',
      files: {
        ...index.files,
        ...vector.files,
      },
    });
    return {
      generation,
      index: finalizeKnowledgeIndexGeneration(input.workspaceRoot, index.result),
      vector: vector.result,
    };
  }

  const generation = publisher.publish({
    expectedActiveGenerationId,
    mode: 'bm25_only',
    files: index.files,
  });
  return {
    generation,
    index: finalizeKnowledgeIndexGeneration(input.workspaceRoot, index.result),
  };
}

export async function rebuildKnowledgeArtifactsWithQuality(input: {
  workspaceRoot: string;
  chunking?: KnowledgeChunkingOptions;
  qualityGate?: KnowledgeQualityGate;
}): Promise<KnowledgeRebuildResult> {
  const rebuilt = await rebuildKnowledgeArtifacts(input);
  const gate = input.qualityGate ?? 'warn';
  if (gate === 'off') {
    rebuilt.index.qualityGateResult = {
      passed: true,
      exitCode: 0,
      reason: 'quality gate disabled',
    };
    return rebuilt;
  }
  const report = auditKnowledgeQuality({ workspaceRoot: input.workspaceRoot, gate });
  rebuilt.index.qualityReportPath = writeKnowledgeQualityReport({
    workspaceRoot: input.workspaceRoot,
    report,
  });
  rebuilt.index.sourceQualityReportPath = writeSourceQualityReport({
    workspaceRoot: input.workspaceRoot,
    report,
  });
  rebuilt.index.qualityGateResult = evaluateQualityGate(report, gate);
  rebuilt.index.qualitySeverityCounts = report.severityCounts;
  rebuilt.index.qualityIssueCounts = report.issueCounts;
  return rebuilt;
}

export async function rebuildKnowledgeArtifactsWithRetry(
  input: Parameters<typeof rebuildKnowledgeArtifacts>[0] & { maxAttempts?: number },
): Promise<KnowledgeRebuildResult> {
  const maxAttempts = Math.max(1, Math.min(3, input.maxAttempts ?? 2));
  let lastConflict: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await rebuildKnowledgeArtifacts(input);
    } catch (error) {
      if (!(error instanceof KnowledgeGenerationConflictError)) throw error;
      lastConflict = error;
    }
  }
  throw lastConflict;
}

export function rollbackKnowledgeArtifacts(input: {
  workspaceRoot: string;
  expectedActiveGenerationId: string;
  previousGenerationId: string;
  publisher?: KnowledgeGenerationPublisherPort;
}): KnowledgeGenerationPointer {
  const publisher = input.publisher ?? createFileKnowledgeGenerationPublisher(input.workspaceRoot);
  return publisher.rollback({
    expectedActiveGenerationId: input.expectedActiveGenerationId,
    previousGenerationId: input.previousGenerationId,
  });
}

export function recoverKnowledgePublishLock(
  workspaceRoot: string,
  publisher = createFileKnowledgeGenerationPublisher(workspaceRoot),
): boolean {
  return publisher.recoverStaleLock();
}
