import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type {
  EmbeddingArtifactConfig,
  EmbeddingDocumentContract,
  EmbeddingDocumentPort,
} from '../contracts/embedding.js';
import { chunksPath, indexesDir, vectorBuildReportPath, vectorManifestPath, vectorsPath } from './paths.js';
import type {
  KnowledgeChunk,
  KnowledgeVectorBuildReport,
  KnowledgeVectorManifest,
  KnowledgeVectorRecord,
} from './types.js';
import { markLegacyChunk } from './documents/chunks.js';
import { embeddingConfigFingerprint, formatEmbeddingSafeError, hashEmbeddingText, isEmbeddingManifestCompatible, sanitizeVectorMetadata, sourceChunkManifestHash } from './vector-utils.js';

export type KnowledgeEmbeddingDocumentInput = EmbeddingDocumentContract;
export type KnowledgeEmbeddingProviderLike = EmbeddingDocumentPort;
export type KnowledgeEmbeddingConfigLike = EmbeddingArtifactConfig;

export interface LoadKnowledgeChunksForEmbeddingResult {
  chunks: KnowledgeChunk[];
  failures: Array<{ line: number; error: string }>;
  chunksPath: string;
}

export interface BuildKnowledgeVectorIndexInput {
  workspaceRoot: string;
  provider: KnowledgeEmbeddingProviderLike;
  config: KnowledgeEmbeddingConfigLike;
  onProgress?: (progress: { processed: number; total: number }) => void;
}

export interface BuildKnowledgeVectorIndexResult extends KnowledgeVectorBuildReport {
  manifest: KnowledgeVectorManifest;
}

export type KnowledgeVectorCompatibilityStatus = 'compatible' | 'missing-index' | 'rebuild-required';

export interface KnowledgeVectorCompatibilityResult {
  status: KnowledgeVectorCompatibilityStatus;
  mismatches: Array<'provider' | 'model' | 'dimensions' | 'distance' | 'source_chunks'>;
  manifest?: KnowledgeVectorManifest;
  reason?: string;
}

export function loadKnowledgeChunksForEmbedding(workspaceRoot: string): LoadKnowledgeChunksForEmbeddingResult {
  const path = chunksPath(workspaceRoot);
  if (!existsSync(path)) {
    return { chunks: [], failures: [], chunksPath: path };
  }

  const chunks: KnowledgeChunk[] = [];
  const failures: LoadKnowledgeChunksForEmbeddingResult['failures'] = [];
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      try {
        chunks.push(markLegacyChunk(JSON.parse(trimmed) as KnowledgeChunk));
      } catch (error) {
        failures.push({ line: index + 1, error: formatEmbeddingSafeError(error) });
      }
    });
  return { chunks, failures, chunksPath: path };
}

export function chunkToEmbeddingDocumentInput(chunk: KnowledgeChunk): KnowledgeEmbeddingDocumentInput {
  return {
    id: chunk.chunk_id,
    text: chunk.text,
    contentHash: chunk.text_hash ?? hashEmbeddingText(chunk.text),
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
  if (chunk.legacy || chunk.artifact_version !== 3 || chunk.chunking_strategy !== 'parent-child-v3') {
    return { eligible: false, reason: 'legacy_chunk' };
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
  const startedAt = Date.now();
  const loaded = loadKnowledgeChunksForEmbedding(input.workspaceRoot);
  const generatedAt = new Date().toISOString();
  const skipped: KnowledgeVectorBuildReport['skipped'] = [];
  const failures: KnowledgeVectorBuildReport['failures'] = loaded.failures.map((failure) => ({
    chunkId: `line_${failure.line}`,
    error: failure.error,
  }));
  const eligibleInputs: KnowledgeEmbeddingDocumentInput[] = [];
  const eligibleChunks: KnowledgeChunk[] = [];

  for (const chunk of loaded.chunks) {
    const textHash = hashEmbeddingText(chunk.text ?? '');
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
            text_hash: result.contentHash ?? hashEmbeddingText(chunk.text),
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
    source_chunk_manifest_hash: sourceChunkManifestHash(loaded.chunks),
    vector_count: records.length,
    skipped_count: skipped.length,
    failed_count: failures.length,
    generated_at: generatedAt,
    embedding_config_fingerprint: embeddingConfigFingerprint(input.config),
  };

  mkdirSync(indexesDir(input.workspaceRoot), { recursive: true });
  writeFileSync(vectorsPath(input.workspaceRoot), records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''), 'utf8');
  writeFileSync(vectorManifestPath(input.workspaceRoot), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
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
  writeFileSync(vectorBuildReportPath(input.workspaceRoot), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { ...report, manifest };
}

export function readKnowledgeVectorManifest(workspaceRoot: string): KnowledgeVectorManifest | undefined {
  const path = vectorManifestPath(workspaceRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as KnowledgeVectorManifest;
}

export function readKnowledgeVectorRecords(workspaceRoot: string): {
  records: KnowledgeVectorRecord[];
  failures: Array<{ line: number; error: string }>;
} {
  const path = vectorsPath(workspaceRoot);
  if (!existsSync(path)) {
    return { records: [], failures: [] };
  }
  const records: KnowledgeVectorRecord[] = [];
  const failures: Array<{ line: number; error: string }> = [];
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      try {
        records.push(JSON.parse(trimmed) as KnowledgeVectorRecord);
      } catch (error) {
        failures.push({ line: index + 1, error: formatEmbeddingSafeError(error) });
      }
    });
  return { records, failures };
}

export function checkKnowledgeVectorCompatibility(input: {
  workspaceRoot: string;
  embeddingConfig: KnowledgeEmbeddingConfigLike;
}): KnowledgeVectorCompatibilityResult {
  const manifest = readKnowledgeVectorManifest(input.workspaceRoot);
  if (!manifest || !existsSync(vectorsPath(input.workspaceRoot))) {
    return { status: 'missing-index', mismatches: [], reason: 'vector artifacts are absent' };
  }

  const compatibility = isEmbeddingManifestCompatible(manifest, input.embeddingConfig);
  const mismatches: KnowledgeVectorCompatibilityResult['mismatches'] = [...compatibility.mismatches];
  const loaded = loadKnowledgeChunksForEmbedding(input.workspaceRoot);
  const currentHash = sourceChunkManifestHash(loaded.chunks);
  if (currentHash !== manifest.source_chunk_manifest_hash) {
    mismatches.push('source_chunks');
  }

  return {
    status: mismatches.length === 0 ? 'compatible' : 'rebuild-required',
    mismatches,
    manifest,
    reason: mismatches.length === 0 ? undefined : `vector rebuild required: ${mismatches.join(', ')}`,
  };
}
