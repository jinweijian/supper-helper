import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sourceBlocksPath, sourceExtractReportPath, sourceNormalizeReportPath } from './paths.js';
import type {
  KnowledgeExtractReport,
  KnowledgeNormalizedBlock,
  KnowledgeNormalizeReport,
  KnowledgeSourceBlock,
  KnowledgeSourceBlockType,
} from './types.js';

export function normalizeSourceBlocks(input: {
  workspaceRoot: string;
  sourceDocumentId: string;
  blocks: KnowledgeSourceBlock[];
}): { blocks: KnowledgeNormalizedBlock[]; report: KnowledgeNormalizeReport } {
  const headingPath: string[] = [];
  const normalized: KnowledgeNormalizedBlock[] = [];
  const excludedCounts: Record<string, number> = {};
  const headingStructureWarnings: string[] = [];
  const titleRepetitions = detectTitleRepetitions(input.blocks);
  const footerRepetitions = detectHeaderFooterRepetitions(input.blocks);

  for (const block of input.blocks) {
    if (block.type === 'heading' && block.heading_level) {
      while (headingPath.length >= block.heading_level) {
        headingPath.pop();
      }
      headingPath.push(block.text);
    }
    const sectionPath = block.heading_level ? headingPath.slice(0, block.heading_level) : headingPath.slice();
    const isExcluded =
      block.type === 'toc' ||
      block.type === 'header_footer' ||
      (block.type === 'heading' && titleRepetitions.has(block.text)) ||
      (block.type === 'paragraph' && footerRepetitions.has(block.text));

    let excludedReason: string | undefined;
    if (block.type === 'toc') {
      excludedReason = 'toc_block';
      excludedCounts['toc'] = (excludedCounts['toc'] ?? 0) + 1;
    } else if (block.type === 'header_footer') {
      excludedReason = 'header_footer';
      excludedCounts['header_footer'] = (excludedCounts['header_footer'] ?? 0) + 1;
    } else if (block.type === 'heading' && titleRepetitions.has(block.text)) {
      excludedReason = 'repeated_title';
      excludedCounts['repeated_title'] = (excludedCounts['repeated_title'] ?? 0) + 1;
    } else if (block.type === 'paragraph' && footerRepetitions.has(block.text)) {
      excludedReason = 'repeated_footer';
      excludedCounts['repeated_footer'] = (excludedCounts['repeated_footer'] ?? 0) + 1;
    }

    const normalizedText = isExcluded ? '' : cleanText(block.text);

    if (block.type === 'heading' && !block.heading_level) {
      headingStructureWarnings.push(`Heading block without heading_level: ${block.text.slice(0, 40)}`);
    }

    normalized.push({
      block_id: `nrm_${input.sourceDocumentId}_${String(block.order).padStart(5, '0')}`,
      source_document_id: input.sourceDocumentId,
      source_block_id: block.block_id,
      order: block.order,
      type: block.type,
      text: block.text,
      normalized_text: normalizedText,
      section_path: sectionPath,
      included_in_slice: !isExcluded,
      excluded_reason: excludedReason,
    });
  }

  if (headingPath.length === 0 && normalized.some((b) => b.type === 'paragraph')) {
    headingStructureWarnings.push('No heading blocks detected; section_path will be empty for all slices.');
  }

  const report: KnowledgeNormalizeReport = {
    version: 1,
    sourceDocumentId: input.sourceDocumentId,
    inputBlockCount: input.blocks.length,
    outputBlockCount: normalized.length,
    excludedBlockCounts: excludedCounts,
    headingStructureWarnings,
    generatedAt: new Date().toISOString(),
  };

  writeNormalizeArtifacts(input.workspaceRoot, normalized, report);
  return { blocks: normalized, report };
}

function writeNormalizeArtifacts(workspaceRoot: string, blocks: KnowledgeNormalizedBlock[], report: KnowledgeNormalizeReport): void {
  const dir = join(workspaceRoot, 'knowledge', '_pipeline', 'normalized');
  mkdirSync(dir, { recursive: true });
  writeFileSync(sourceNormalizeReportPath(workspaceRoot, report.sourceDocumentId), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // The blocks path keeps .blocks.jsonl for downstream tools.
  const blocksPath = sourceNormalizeReportPath(workspaceRoot, report.sourceDocumentId).replace(/\.normalize-report\.json$/, '.blocks.jsonl');
  writeFileSync(blocksPath, blocks.map((b) => JSON.stringify(b)).join('\n') + (blocks.length ? '\n' : ''), 'utf8');
}

function cleanText(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectTitleRepetitions(blocks: KnowledgeSourceBlock[]): Set<string> {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    if (block.type === 'heading' && block.text.length < 60) {
      counts.set(block.text, (counts.get(block.text) ?? 0) + 1);
    }
  }
  const repeats = new Set<string>();
  for (const [text, count] of counts) {
    if (count >= 3) {
      repeats.add(text);
    }
  }
  return repeats;
}

function detectHeaderFooterRepetitions(blocks: KnowledgeSourceBlock[]): Set<string> {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    if (block.type === 'paragraph' && block.text.length < 80) {
      counts.set(block.text, (counts.get(block.text) ?? 0) + 1);
    }
  }
  const repeats = new Set<string>();
  for (const [text, count] of counts) {
    if (count >= 4) {
      repeats.add(text);
    }
  }
  return repeats;
}

export function readSourceBlocks(workspaceRoot: string, sourceDocumentId: string): KnowledgeSourceBlock[] {
  const path = sourceBlocksPath(workspaceRoot, sourceDocumentId);
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as KnowledgeSourceBlock];
      } catch {
        return [];
      }
    });
}

export function readNormalizedBlocks(workspaceRoot: string, sourceDocumentId: string): KnowledgeNormalizedBlock[] {
  const path = sourceNormalizeReportPath(workspaceRoot, sourceDocumentId).replace(/\.normalize-report\.json$/, '.blocks.jsonl');
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as KnowledgeNormalizedBlock];
      } catch {
        return [];
      }
    });
}

export function hashSourceDocument(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
