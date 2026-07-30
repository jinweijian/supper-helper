import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  readActiveKnowledgeGeneration,
  resolveKnowledgeGenerationFileById,
} from '../generation-store.js';
import type { KnowledgeChunk } from '../types.js';
import { markLegacyChunk } from '../documents/chunks.js';

export interface ReadKnowledgeChunksResult {
  chunks: KnowledgeChunk[];
  failures: Array<{ line: number; error: string }>;
  path: string;
}

export function readKnowledgeChunks(
  workspaceRoot: string,
  generationId?: string,
): ReadKnowledgeChunksResult {
  const resolvedGenerationId = generationId ??
    readActiveKnowledgeGeneration(workspaceRoot)?.generation_id;
  const path = resolveKnowledgeGenerationFileById(
    workspaceRoot,
    'chunks.jsonl',
    resolvedGenerationId,
  );
  const flatLegacy = !resolvedGenerationId;
  if (!existsSync(path)) {
    return { chunks: [], failures: [], path };
  }
  const chunks: KnowledgeChunk[] = [];
  const failures: ReadKnowledgeChunksResult['failures'] = [];
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      try {
        const chunk = markLegacyChunk(JSON.parse(trimmed) as KnowledgeChunk);
        chunks.push(flatLegacy ? { ...chunk, legacy: true } : chunk);
      } catch (error) {
        failures.push({ line: index + 1, error: error instanceof Error ? error.message : String(error) });
      }
    });
  return { chunks, failures, path };
}

export function writeKnowledgeChunks(input: {
  workspaceRoot: string;
  chunks: KnowledgeChunk[];
}): string {
  if (readActiveKnowledgeGeneration(input.workspaceRoot)) {
    throw new Error('active_generation_immutable');
  }
  const path = resolveKnowledgeGenerationFileById(
    input.workspaceRoot,
    'chunks.jsonl',
    undefined,
  );
  writeFileSync(path, input.chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + (input.chunks.length ? '\n' : ''), 'utf8');
  return path;
}
