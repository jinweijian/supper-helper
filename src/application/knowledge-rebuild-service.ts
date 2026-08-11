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
  generation?: KnowledgeGenerationPointer;
  published: boolean;
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

  return publishPreparedKnowledgeArtifacts(input, index, publisher, expectedActiveGenerationId);
}

async function publishPreparedKnowledgeArtifacts(
  input: Parameters<typeof rebuildKnowledgeArtifacts>[0],
  index: PreparedKnowledgeIndexGeneration,
  publisher: KnowledgeGenerationPublisherPort,
  expectedActiveGenerationId: string | undefined,
): Promise<KnowledgeRebuildResult> {
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
      published: true,
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
    published: true,
    index: finalizeKnowledgeIndexGeneration(input.workspaceRoot, index.result),
  };
}

export async function rebuildKnowledgeArtifactsWithQuality(input: {
  workspaceRoot: string;
  chunking?: KnowledgeChunkingOptions;
  qualityGate?: KnowledgeQualityGate;
  embedding?: {
    enabled: boolean;
    provider: EmbeddingDocumentPort;
    config: EmbeddingArtifactConfig;
  };
}): Promise<KnowledgeRebuildResult> {
  const gate = input.qualityGate ?? 'warn';
  const publisher = createFileKnowledgeGenerationPublisher(input.workspaceRoot);
  const expectedActiveGenerationId = publisher.readActive()?.generation_id;
  const prepared = prepareKnowledgeIndexGeneration({
    workspaceRoot: input.workspaceRoot,
    chunking: input.chunking,
  });
  if (gate === 'off') {
    prepared.result.qualityGateResult = {
      passed: true,
      exitCode: 0,
      reason: 'quality gate disabled',
    };
    return publishPreparedKnowledgeArtifacts(input, prepared, publisher, expectedActiveGenerationId);
  }
  const report = auditKnowledgeQuality({
    workspaceRoot: input.workspaceRoot,
    gate,
    chunks: prepared.chunks,
  });
  prepared.result.qualityReportPath = writeKnowledgeQualityReport({
    workspaceRoot: input.workspaceRoot,
    report,
  });
  prepared.result.sourceQualityReportPath = writeSourceQualityReport({
    workspaceRoot: input.workspaceRoot,
    report,
  });
  prepared.result.qualityGateResult = evaluateQualityGate(report, gate);
  prepared.result.qualitySeverityCounts = report.severityCounts;
  prepared.result.qualityIssueCounts = report.issueCounts;
  if (!prepared.result.qualityGateResult.passed) {
    return { published: false, index: prepared.result };
  }
  return publishPreparedKnowledgeArtifacts(input, prepared, publisher, expectedActiveGenerationId);
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
