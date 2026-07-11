import { createHash } from 'node:crypto';
import type { EmbeddingArtifactConfig } from '../contracts/embedding.js';
import type { KnowledgeChunk, KnowledgeVectorManifest } from './types.js';

type KnowledgeEmbeddingConfigLike = EmbeddingArtifactConfig;

export function sourceChunkManifestHash(chunks: KnowledgeChunk[]): string {
  const payload = chunks
    .map((chunk) => ({
      chunk_id: chunk.chunk_id,
      parent_id: chunk.parent_id,
      child_order: chunk.child_order,
      text_hash: chunk.text_hash ?? hashEmbeddingText(chunk.text ?? ''),
      source_block_ids: chunk.source_block_ids ?? [],
      section_path: chunk.section_path ?? [],
      chunking_strategy: chunk.chunking_strategy,
      artifact_version: chunk.artifact_version,
    }))
    .sort((a, b) => a.chunk_id.localeCompare(b.chunk_id));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function sanitizeVectorMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }
  const allowed: Record<string, unknown> = {};
  for (const key of ['source', 'document_id', 'chunk_id', 'source_type', 'module', 'intent', 'visibility']) {
    if (metadata[key] !== undefined) {
      allowed[key] = metadata[key];
    }
  }
  return allowed;
}

export function embeddingConfigFingerprint(config: KnowledgeEmbeddingConfigLike): string {
  return [
    'embedding-v1',
    config.provider,
    config.model,
    String(config.dimensions),
    config.distance,
  ].join(':');
}

export function hashEmbeddingText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function isEmbeddingManifestCompatible(
  manifest: KnowledgeVectorManifest,
  config: KnowledgeEmbeddingConfigLike,
): { compatible: boolean; mismatches: Array<'provider' | 'model' | 'dimensions' | 'distance'> } {
  const mismatches: Array<'provider' | 'model' | 'dimensions' | 'distance'> = [];
  if (manifest.provider !== config.provider) mismatches.push('provider');
  if (manifest.model !== config.model) mismatches.push('model');
  if (manifest.dimensions !== config.dimensions) mismatches.push('dimensions');
  if (manifest.distance !== config.distance) mismatches.push('distance');
  return { compatible: mismatches.length === 0, mismatches };
}

export function formatEmbeddingSafeError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'provider' in error && 'code' in error && 'safeMessage' in error) {
    const value = error as { provider?: unknown; code?: unknown; status?: unknown; safeMessage?: unknown };
    const status = typeof value.status === 'number' ? ` status=${value.status}` : '';
    return redactKnowledgeVectorError(`${String(value.provider)}:${String(value.code)}${status}: ${String(value.safeMessage)}`);
  }
  if (error instanceof Error) {
    return redactKnowledgeVectorError(error.message);
  }
  return redactKnowledgeVectorError(error);
}

export function redactKnowledgeVectorError(value: unknown): string {
  return safeSerialize(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(api[-_ ]?key["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]');
}

export function safeSerialize(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
