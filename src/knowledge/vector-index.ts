import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type {
  EmbeddingArtifactConfig,
  EmbeddingDocumentContract,
  EmbeddingDocumentPort,
} from '../contracts/embedding.js';
import { indexesDir, vectorBuildReportPath, vectorManifestPath, vectorsPath } from './paths.js';
import type {
  KnowledgeChunk,
  KnowledgeVectorBuildReport,
  KnowledgeVectorManifest,
  KnowledgeVectorRecord,
} from './types.js';
import { embeddingConfigFingerprint, formatEmbeddingSafeError, hashEmbeddingText, sanitizeVectorMetadata, sourceChunkManifestHash } from './vector-utils.js';
import {
  publishKnowledgeGeneration,
  readActiveKnowledgeGeneration,
  resolveKnowledgeGenerationFileById,
} from './generation-store.js';
import { loadKnowledgeChunksForEmbedding } from './vector-index-reader.js';
export {
  checkKnowledgeVectorCompatibility,
  loadKnowledgeChunksForEmbedding,
  readKnowledgeVectorManifest,
  readKnowledgeVectorRecords,
} from './vector-index-reader.js';
export type {
  KnowledgeVectorCompatibilityResult,
  KnowledgeVectorCompatibilityStatus,
  LoadKnowledgeChunksForEmbeddingResult,
} from './vector-index-reader.js';

export type KnowledgeEmbeddingDocumentInput = EmbeddingDocumentContract;
export type KnowledgeEmbeddingProviderLike = EmbeddingDocumentPort;
export type KnowledgeEmbeddingConfigLike = EmbeddingArtifactConfig;

export interface BuildKnowledgeVectorIndexInput {
  workspaceRoot: string;
  provider: KnowledgeEmbeddingProviderLike;
  config: KnowledgeEmbeddingConfigLike;
  onProgress?: (progress: { processed: number; total: number }) => void;
}

export interface BuildKnowledgeVectorIndexResult extends KnowledgeVectorBuildReport {
  manifest: KnowledgeVectorManifest;
}

export interface PreparedKnowledgeVectorGeneration {
  result: BuildKnowledgeVectorIndexResult;
  files: Record<'vectors.jsonl' | 'vector-manifest.json' | 'vector-build-report.json', string>;
}

export function chunkToEmbeddingDocumentInput(chunk: KnowledgeChunk): KnowledgeEmbeddingDocumentInput {
  return {
    id: chunk.chunk_id,
    text: chunk.retrieval_text ?? chunk.text,
    contentHash: chunk.retrieval_text_hash ?? hashEmbeddingText(chunk.retrieval_text ?? chunk.text),
    source: chunk.source,
    documentId: chunk.parent_id,
    chunkId: chunk.chunk_id,
    metadata: {
      source: chunk.source,
      document_id: chunk.parent_id,
      chunk_id: chunk.chunk_id,
      source_type: chunk.source_type,
      module: chunk.module,
      intent: chunk.intent,
      visibility: chunk.visibility ?? 'internal',
    },
  };
}

export function isChunkEligibleForRemoteEmbedding(chunk: KnowledgeChunk): { eligible: true } | { eligible: false; reason: string } {
  if (chunk.visibility === 'restricted') {
    return { eligible: false, reason: 'restricted_visibility' };
  }
  if (chunk.status !== 'active') {
    return { eligible: false, reason: `status_${chunk.status}` };
  }
  if (chunk.legacy || chunk.artifact_version !== 4 || chunk.chunking_strategy !== 'parent-child-v4') {
    return { eligible: false, reason: 'legacy_chunk' };
  }
  if (chunk.undersized_unmergeable || chunk.manual_split_required) {
    return { eligible: false, reason: chunk.undersized_unmergeable ? 'undersized_unmergeable' : 'manual_split_required' };
  }
  if (chunk.quality_status !== 'ok') {
    return { eligible: false, reason: `quality_${chunk.quality_status ?? 'unknown'}` };
  }
  if (!chunk.text.trim()) {
    return { eligible: false, reason: 'empty_text' };
  }
  return { eligible: true };
}

export async function buildKnowledgeVectorIndex(input: BuildKnowledgeVectorIndexInput): Promise<BuildKnowledgeVectorIndexResult> {
  const activeBefore = readActiveKnowledgeGeneration(input.workspaceRoot);
  const pinnedGenerationId = activeBefore?.generation_id;
  const loaded = loadKnowledgeChunksForEmbedding(input.workspaceRoot, pinnedGenerationId);
  const prepared = await prepareKnowledgeVectorGeneration({
    ...input,
    chunks: loaded.chunks,
    initialFailures: loaded.failures.map((failure) => ({
      chunkId: `line_${failure.line}`,
      error: failure.error,
    })),
  });
  const { result, files } = prepared;
  mkdirSync(indexesDir(input.workspaceRoot), { recursive: true });
  if (activeBefore && result.failures.length === 0) {
    publishKnowledgeGeneration({
      workspaceRoot: input.workspaceRoot,
      expectedActiveGenerationId: activeBefore.generation_id,
      mode: 'hybrid',
      files: {
        'chunks.jsonl': readFileSync(resolveKnowledgeGenerationFileById(
          input.workspaceRoot,
          'chunks.jsonl',
          pinnedGenerationId,
        ), 'utf8'),
        'manifest.json': readFileSync(resolveKnowledgeGenerationFileById(
          input.workspaceRoot,
          'manifest.json',
          pinnedGenerationId,
        ), 'utf8'),
        'keyword-index.json': readFileSync(resolveKnowledgeGenerationFileById(
          input.workspaceRoot,
          'keyword-index.json',
          pinnedGenerationId,
        ), 'utf8'),
        ...files,
      },
    });
  } else if (!activeBefore) {
    writeFileSync(vectorsPath(input.workspaceRoot), files['vectors.jsonl'], 'utf8');
    writeFileSync(vectorManifestPath(input.workspaceRoot), files['vector-manifest.json'], 'utf8');
  }
  writeFileSync(vectorBuildReportPath(input.workspaceRoot), files['vector-build-report.json'], 'utf8');
  return result;
}

export async function prepareKnowledgeVectorGeneration(input: BuildKnowledgeVectorIndexInput & {
  chunks: KnowledgeChunk[];
  initialFailures?: KnowledgeVectorBuildReport['failures'];
}): Promise<PreparedKnowledgeVectorGeneration> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const skipped: KnowledgeVectorBuildReport['skipped'] = [];
  const failures: KnowledgeVectorBuildReport['failures'] = [...(input.initialFailures ?? [])];
  const eligibleInputs: KnowledgeEmbeddingDocumentInput[] = [];
  const eligibleChunks: KnowledgeChunk[] = [];

  for (const chunk of input.chunks) {
    const textHash = hashEmbeddingText(chunk.retrieval_text ?? chunk.text ?? '');
    const eligibility = isChunkEligibleForRemoteEmbedding(chunk);
    if (!eligibility.eligible) {
      skipped.push({ chunkId: chunk.chunk_id, textHash, reason: eligibility.reason });
      continue;
    }
    eligibleChunks.push(chunk);
    eligibleInputs.push(chunkToEmbeddingDocumentInput(chunk));
  }

  const records: KnowledgeVectorRecord[] = [];
  const chunkById = new Map(eligibleChunks.map((chunk) => [chunk.chunk_id, chunk]));
  if (eligibleInputs.length > 0) {
    const batchSize = Math.max(1, Math.floor(input.config.batchSize ?? 16));
    let processed = 0;
    for (let offset = 0; offset < eligibleInputs.length; offset += batchSize) {
      const batchInputs = eligibleInputs.slice(offset, offset + batchSize);
      try {
        const batch = await input.provider.embedDocuments(batchInputs, { batchSize });
        for (const result of batch.results) {
          const chunk = chunkById.get(result.id);
          if (!chunk) {
            failures.push({ chunkId: result.id, error: 'provider returned vector for unknown chunk id' });
            continue;
          }
          records.push({
            vector_id: `vec_${result.id}`,
            source: chunk.source,
            document_id: chunk.parent_id,
            chunk_id: chunk.chunk_id,
            text_hash: result.contentHash ?? hashEmbeddingText(chunk.retrieval_text ?? chunk.text),
            provider: result.provider,
            model: result.model,
            dimensions: result.dimensions,
            distance: result.distance,
            vector: result.vector,
            created_at: generatedAt,
            metadata: sanitizeVectorMetadata(result.metadata),
          });
        }
      } catch (error) {
        const safeError = formatEmbeddingSafeError(error);
        for (const item of batchInputs) {
          failures.push({ chunkId: item.chunkId ?? item.id, textHash: item.contentHash, error: safeError });
        }
      }
      processed += batchInputs.length;
      input.onProgress?.({ processed, total: eligibleInputs.length });
    }
  } else {
    input.onProgress?.({ processed: 0, total: 0 });
  }

  const manifest: KnowledgeVectorManifest = {
    version: 1,
    provider: input.provider.id,
    model: input.provider.model,
    dimensions: input.provider.dimensions,
    distance: input.provider.distance,
    source_chunk_manifest_hash: sourceChunkManifestHash(input.chunks),
    vector_count: records.length,
    skipped_count: skipped.length,
    failed_count: failures.length,
    generated_at: generatedAt,
    embedding_config_fingerprint: embeddingConfigFingerprint(input.config),
  };

  const vectorContent = records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
  const vectorManifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const report: KnowledgeVectorBuildReport = {
    version: 1,
    generatedAt,
    provider: manifest.provider,
    model: manifest.model,
    dimensions: manifest.dimensions,
    distance: manifest.distance,
    vectorCount: records.length,
    skipped,
    failures,
    durationMs: Date.now() - startedAt,
    vectorsPath: vectorsPath(input.workspaceRoot),
    manifestPath: vectorManifestPath(input.workspaceRoot),
  };
  const result = { ...report, manifest };
  return {
    result,
    files: {
      'vectors.jsonl': vectorContent,
      'vector-manifest.json': vectorManifestContent,
      'vector-build-report.json': `${JSON.stringify(report, null, 2)}\n`,
    },
  };
}
