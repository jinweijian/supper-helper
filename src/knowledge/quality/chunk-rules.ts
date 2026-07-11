import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KnowledgeDocument, KnowledgeQualityIssue } from '../types.js';

export function auditKnowledgeChunks(
  documents: KnowledgeDocument[],
  workspaceRoot: string,
  issues: KnowledgeQualityIssue[],
): number {
  const path = join(workspaceRoot, 'knowledge', 'indexes', 'chunks.jsonl');
  if (!existsSync(path)) return 0;
  const knownIds = new Set(documents.map((document) => document.frontmatter.id));
  const parentsWithChunks = new Set<string>();
  let count = 0;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)) {
    try {
      const chunk = JSON.parse(line) as {
        chunk_id: string;
        parent_id: string;
        artifact_version?: number;
        source_block_ids?: string[];
        section_path?: string[];
        manual_split_required?: boolean;
      };
      count += 1;
      parentsWithChunks.add(chunk.parent_id);
      if (!knownIds.has(chunk.parent_id)) {
        issues.push({ code: 'orphan_chunk', severity: 'error', message: `Chunk ${chunk.chunk_id} references unknown parent_id ${chunk.parent_id}.`, chunkId: chunk.chunk_id });
      }
      if (chunk.artifact_version === 2 && !chunk.source_block_ids?.length) {
        issues.push({ code: 'missing_source_block_ids', severity: 'error', message: `V2 chunk ${chunk.chunk_id} has no source_block_ids.`, documentId: chunk.parent_id, chunkId: chunk.chunk_id });
      }
      if (chunk.artifact_version === 2 && !chunk.section_path?.length) {
        issues.push({ code: 'missing_section_path', severity: 'error', message: `V2 chunk ${chunk.chunk_id} has no section_path.`, documentId: chunk.parent_id, chunkId: chunk.chunk_id });
      }
      if (chunk.manual_split_required) {
        issues.push({ code: 'too_long', severity: 'warn', message: `Chunk ${chunk.chunk_id} preserves an oversized indivisible block and requires manual split.`, documentId: chunk.parent_id, chunkId: chunk.chunk_id });
      }
    } catch { /* malformed lines are ignored for legacy compatibility */ }
  }
  for (const document of documents) {
    if (document.frontmatter.status === 'active' && !parentsWithChunks.has(document.frontmatter.id)) {
      issues.push({ code: 'missing_parent', severity: 'warn', message: `Active parent ${document.frontmatter.id} has no derived chunk after index generation.`, documentId: document.frontmatter.id, source: document.relativePath });
    }
  }
  return count;
}
