import { existsSync, readFileSync } from 'node:fs';
import type { EmbeddingArtifactConfig } from '../contracts/embedding.js';
import { markLegacyChunk } from './documents/chunks.js';
import {
  readActiveKnowledgeGeneration,
  resolveKnowledgeGenerationFileById,
} from './generation-store.js';
import { vectorManifestPath, vectorsPath } from './paths.js';
import type {
  KnowledgeChunk,
  KnowledgeVectorManifest,
  KnowledgeVectorRecord,
} from './types.js';
import {
  formatEmbeddingSafeError,
  isEmbeddingManifestCompatible,
  sourceChunkManifestHash,
} from './vector-utils.js';

export interface LoadKnowledgeChunksForEmbeddingResult {
  chunks: KnowledgeChunk[];
  failures: Array<{ line: number; error: string }>;
  chunksPath: string;
}

export type KnowledgeVectorCompatibilityStatus = 'compatible' | 'missing-index' | 'rebuild-required';

export interface KnowledgeVectorCompatibilityResult {
  status: KnowledgeVectorCompatibilityStatus;
  mismatches: Array<'provider' | 'model' | 'dimensions' | 'distance' | 'source_chunks'>;
  manifest?: KnowledgeVectorManifest;
  reason?: string;
}

export function loadKnowledgeChunksForEmbedding(
  workspaceRoot: string,
  generationId?: string,
): LoadKnowledgeChunksForEmbeddingResult {
  const resolvedGenerationId = generationId ??
    readActiveKnowledgeGeneration(workspaceRoot)?.generation_id;
  const path = resolveKnowledgeGenerationFileById(
    workspaceRoot,
    'chunks.jsonl',
    resolvedGenerationId,
  );
  const flatLegacy = !resolvedGenerationId;
  if (!existsSync(path)) {
    return { chunks: [], failures: [], chunksPath: path };
  }

  const chunks: KnowledgeChunk[] = [];
  const failures: LoadKnowledgeChunksForEmbeddingResult['failures'] = [];
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const chunk = markLegacyChunk(JSON.parse(trimmed) as KnowledgeChunk);
        chunks.push(flatLegacy ? { ...chunk, legacy: true } : chunk);
      } catch (error) {
        failures.push({ line: index + 1, error: formatEmbeddingSafeError(error) });
      }
    });
  return { chunks, failures, chunksPath: path };
}

export function readKnowledgeVectorManifest(
  workspaceRoot: string,
  generationId?: string,
): KnowledgeVectorManifest | undefined {
  const path = generationId
    ? resolveKnowledgeGenerationFileById(workspaceRoot, 'vector-manifest.json', generationId)
    : vectorManifestPath(workspaceRoot);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as KnowledgeVectorManifest;
}

export function readKnowledgeVectorRecords(workspaceRoot: string, generationId?: string): {
  records: KnowledgeVectorRecord[];
  failures: Array<{ line: number; error: string }>;
} {
  const path = generationId
    ? resolveKnowledgeGenerationFileById(workspaceRoot, 'vectors.jsonl', generationId)
    : vectorsPath(workspaceRoot);
  if (!existsSync(path)) return { records: [], failures: [] };
  const records: KnowledgeVectorRecord[] = [];
  const failures: Array<{ line: number; error: string }> = [];
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
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
  embeddingConfig: EmbeddingArtifactConfig;
  generationId?: string;
}): KnowledgeVectorCompatibilityResult {
  const generationId = input.generationId ??
    readActiveKnowledgeGeneration(input.workspaceRoot)?.generation_id;
  const vectorsArtifactPath = resolveKnowledgeGenerationFileById(
    input.workspaceRoot,
    'vectors.jsonl',
    generationId,
  );
  const manifest = readKnowledgeVectorManifest(input.workspaceRoot, generationId);
  if (!manifest || !existsSync(vectorsArtifactPath)) {
    return { status: 'missing-index', mismatches: [], reason: 'vector artifacts are absent' };
  }

  const compatibility = isEmbeddingManifestCompatible(manifest, input.embeddingConfig);
  const mismatches: KnowledgeVectorCompatibilityResult['mismatches'] = [...compatibility.mismatches];
  const loaded = loadKnowledgeChunksForEmbedding(input.workspaceRoot, generationId);
  const currentHash = sourceChunkManifestHash(loaded.chunks);
  if (currentHash !== manifest.source_chunk_manifest_hash) mismatches.push('source_chunks');

  return {
    status: mismatches.length === 0 ? 'compatible' : 'rebuild-required',
    mismatches,
    manifest,
    reason: mismatches.length === 0 ? undefined : `vector rebuild required: ${mismatches.join(', ')}`,
  };
}
