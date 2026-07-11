import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_QUALITY_THRESHOLDS, type KnowledgeQualityIssue } from '../types.js';

export interface QualitySourceDocument {
  id: string;
  sha256?: string;
  path?: string;
  title?: string;
}

export function auditSourceDocuments(
  workspaceRoot: string,
  sources: QualitySourceDocument[],
  issues: KnowledgeQualityIssue[],
): Map<string, Set<string>> {
  for (const source of sources) auditSourceProvenance(source, issues);
  auditPerSourceExtracts(workspaceRoot, sources, issues);
  return loadKnownSourceBlockIds(workspaceRoot, sources);
}

function auditSourceProvenance(source: QualitySourceDocument, issues: KnowledgeQualityIssue[]): void {
  if (!source.sha256 || !source.path) {
    issues.push({
      code: 'source_provenance_missing',
      severity: 'error',
      message: 'Source metadata missing sha256 or stored path.',
      documentId: source.id,
      source: source.path,
    });
  }
}

function loadKnownSourceBlockIds(workspaceRoot: string, sources: QualitySourceDocument[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const source of sources) {
    const path = join(workspaceRoot, 'knowledge', '_pipeline', 'extracts', `${source.id}.blocks.jsonl`);
    if (!existsSync(path)) continue;
    const ids = new Set<string>();
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const block = JSON.parse(line) as { block_id?: string };
        if (block.block_id) ids.add(block.block_id);
      } catch { /* malformed blocks are reported by extraction quality */ }
    }
    map.set(source.id, ids);
  }
  return map;
}

function auditPerSourceExtracts(
  workspaceRoot: string,
  sources: QualitySourceDocument[],
  issues: KnowledgeQualityIssue[],
): void {
  for (const source of sources) {
    const extract = readJson<{
      blockCounts?: Record<string, number>;
      unknownBlockCount?: number;
      warnings?: string[];
      fatal?: boolean;
    }>(join(workspaceRoot, 'knowledge', '_pipeline', 'extracts', `${source.id}.extract-report.json`));
    if (!extract) continue;
    const blockCounts = extract.blockCounts ?? {};
    const totalBlocks = Object.values(blockCounts).reduce((sum, count) => sum + count, 0);
    const unknown = extract.unknownBlockCount ?? 0;
    if (extract.fatal || totalBlocks === 0) {
      issues.push({ code: 'parser_empty', severity: 'error', message: `Source ${source.id} produced no parseable blocks.`, sourceDocument: source.id, source: source.path });
    }
    if (totalBlocks > 0 && unknown / totalBlocks > DEFAULT_QUALITY_THRESHOLDS.maxUnknownBlockRatio) {
      issues.push({
        code: 'too_many_unknown_blocks',
        severity: 'warn',
        message: `Source ${source.id} has ${unknown}/${totalBlocks} unknown blocks (${(unknown / totalBlocks).toFixed(2)}).`,
        sourceDocument: source.id,
        details: { blockCounts, unknown, total: totalBlocks },
      });
    }
    for (const [pattern, code, message] of [
      [/table_lost/, 'table_lost', 'table loss during extraction'],
      [/list_structure_lost/, 'list_structure_lost', 'list structure loss during extraction'],
      [/toc_not_removed/, 'toc_not_removed', 'table-of-contents noise'],
    ] as const) {
      if (extract.warnings?.some((warning) => pattern.test(warning))) {
        issues.push({ code, severity: 'warn', message: `Source ${source.id} reported ${message}.`, sourceDocument: source.id });
      }
    }
    const normalized = readJson<{
      excludedBlockCounts?: Record<string, number>;
      headingStructureWarnings?: string[];
    }>(join(workspaceRoot, 'knowledge', '_pipeline', 'normalized', `${source.id}.normalize-report.json`));
    if (!normalized) continue;
    const excluded = normalized.excludedBlockCounts ?? {};
    if ((excluded.header_footer ?? 0) > 0) {
      issues.push({
        code: 'header_footer_noise',
        severity: 'info',
        message: `Source ${source.id} had ${excluded.header_footer} header/footer block(s) removed during normalization.`,
        sourceDocument: source.id,
        details: { excluded },
      });
    }
    if ((normalized.headingStructureWarnings ?? []).length > 0) {
      issues.push({
        code: 'heading_structure_broken',
        severity: 'warn',
        message: `Source ${source.id} has heading structure warning(s).`,
        sourceDocument: source.id,
        details: { warnings: normalized.headingStructureWarnings },
      });
    }
  }
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return undefined; }
}
