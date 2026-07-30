import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { indexesDir } from './paths.js';
import type { KnowledgeGenerationManifest } from './generation-store.js';

export function validateGenerationFiles(
  files: Record<string, string>,
  mode: 'bm25_only' | 'hybrid',
): { chunkCount: number; vectorCount?: number; vectorDimensions?: number } {
  if (['chunks.jsonl', 'manifest.json', 'keyword-index.json']
    .some((name) => typeof files[name] !== 'string')) {
    throw new Error('incomplete_generation');
  }
  if (mode === 'hybrid' && (
    typeof files['vectors.jsonl'] !== 'string' ||
    typeof files['vector-manifest.json'] !== 'string'
  )) {
    throw new Error('incomplete_hybrid_generation');
  }

  const chunks = parseJsonLines(files['chunks.jsonl']!, 'invalid_chunk_json') as Array<{
    chunk_id?: unknown;
    artifact_version?: unknown;
    chunking_strategy?: unknown;
  }>;
  const chunkIds = new Set<string>();
  for (const chunk of chunks) {
    if (
      typeof chunk.chunk_id !== 'string' ||
      chunk.artifact_version !== 4 ||
      chunk.chunking_strategy !== 'parent-child-v4'
    ) {
      throw new Error('invalid_v4_chunk');
    }
    if (chunkIds.has(chunk.chunk_id)) throw new Error('duplicate_chunk_id');
    chunkIds.add(chunk.chunk_id);
  }
  const manifest = parseJsonObject(files['manifest.json']!, 'invalid_index_manifest');
  if (manifest.chunk_count !== chunks.length) throw new Error('chunk_count_mismatch');
  parseJsonObject(files['keyword-index.json']!, 'invalid_keyword_index');

  if (mode === 'bm25_only') return { chunkCount: chunks.length };

  const vectorManifest = parseJsonObject(files['vector-manifest.json']!, 'invalid_vector_manifest');
  const expectedDimensions = vectorManifest.dimensions;
  if (!Number.isSafeInteger(expectedDimensions) || Number(expectedDimensions) <= 0) {
    throw new Error('invalid_vector_dimensions');
  }
  const vectors = parseJsonLines(files['vectors.jsonl']!, 'invalid_vector_json') as Array<{
    chunk_id?: unknown;
    dimensions?: unknown;
    vector?: unknown;
  }>;
  if (vectorManifest.vector_count !== vectors.length) throw new Error('vector_count_mismatch');
  for (const vector of vectors) {
    if (
      typeof vector.chunk_id !== 'string' ||
      !chunkIds.has(vector.chunk_id) ||
      vector.dimensions !== expectedDimensions ||
      !Array.isArray(vector.vector) ||
      vector.vector.length !== expectedDimensions ||
      !vector.vector.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new Error('vector_dimension_mismatch');
    }
  }
  return {
    chunkCount: chunks.length,
    vectorCount: vectors.length,
    vectorDimensions: Number(expectedDimensions),
  };
}

export function assertSafeGenerationId(generationId: string): void {
  if (
    basename(generationId) !== generationId ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(generationId)
  ) {
    throw new Error('invalid_generation_id');
  }
}

export function validateStoredKnowledgeGeneration(
  workspaceRoot: string,
  generationId: string,
  verifyFileHashes: boolean,
): boolean {
  try {
    assertSafeGenerationId(generationId);
    const root = join(indexesDir(workspaceRoot), 'generations', generationId);
    const manifest = JSON.parse(readFileSync(join(root, 'generation-manifest.json'), 'utf8')) as KnowledgeGenerationManifest;
    const complete = JSON.parse(readFileSync(join(root, 'complete.json'), 'utf8')) as {
      version?: unknown;
      generation_id?: unknown;
      manifest_hash?: unknown;
    };
    if (
      manifest.version !== 1 ||
      manifest.generation_id !== generationId ||
      manifest.chunk_artifact_version !== 4 ||
      manifest.chunking_strategy !== 'parent-child-v4' ||
      !Number.isSafeInteger(manifest.chunk_count) ||
      manifest.chunk_count < 0 ||
      (manifest.mode !== 'bm25_only' && manifest.mode !== 'hybrid') ||
      !Array.isArray(manifest.files) ||
      !manifest.files.includes('chunks.jsonl') ||
      !manifest.files.includes('manifest.json') ||
      !manifest.files.includes('keyword-index.json') ||
      (manifest.mode === 'hybrid' && (
        !manifest.files.includes('vectors.jsonl') ||
        !manifest.files.includes('vector-manifest.json')
      )) ||
      !manifest.file_hashes ||
      typeof manifest.file_hashes !== 'object' ||
      complete.version !== 1 ||
      complete.generation_id !== generationId ||
      complete.manifest_hash !== createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
    ) {
      return false;
    }
    return manifest.files.every((fileName) => {
      if (basename(fileName) !== fileName || typeof manifest.file_hashes[fileName] !== 'string') return false;
      const path = join(root, fileName);
      return existsSync(path) && (!verifyFileHashes ||
        createHash('sha256').update(readFileSync(path)).digest('hex') === manifest.file_hashes[fileName]);
    });
  } catch {
    return false;
  }
}

function parseJsonLines(content: string, errorCode: string): unknown[] {
  try {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    throw new Error(errorCode);
  }
}

function parseJsonObject(content: string, errorCode: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(errorCode);
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(errorCode);
  }
}
