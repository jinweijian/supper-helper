import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chunksPath, dirtyFlagPath } from '../paths.js';
import type { KnowledgeChunk, KnowledgeDocument } from '../types.js';
import { extractKnowledgeTerms } from './terms.js';

import { markLegacyChunk, normalizeChunkingOptions, overlapText, slug, sourceBlocksForChild, splitIntoSentences, stripMarkdown, windowOverlap } from './chunk-utils.js';
export { markLegacyChunk } from './chunk-utils.js';
import { CURRENT_ARTIFACT_VERSION, CURRENT_CHUNKING_STRATEGY, MAX_RETRIEVAL_SECTION_PREFIX_CODE_POINTS, type KnowledgeChunkingOptions, type NormalizedChunkingOptions } from './chunk-contracts.js';
export type { KnowledgeChunkingOptions, NormalizedChunkingOptions } from './chunk-contracts.js';
import { rebalanceUndersized, type ChildDraft } from './chunk-rebalance.js';

export function loadKnowledgeChunksForSearch(
  workspaceRoot: string,
  documents: KnowledgeDocument[],
  options?: KnowledgeChunkingOptions,
): KnowledgeChunk[] {
  const path = chunksPath(workspaceRoot);
  if (existsSync(path) && !existsSync(dirtyFlagPath(workspaceRoot))) {
    const parsed = readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [markLegacyChunk(JSON.parse(line) as KnowledgeChunk)];
        } catch {
          return [];
        }
      });
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return buildKnowledgeChunks(documents, options);
}

export function buildKnowledgeChunks(
  documents: KnowledgeDocument[],
  options?: KnowledgeChunkingOptions,
): KnowledgeChunk[] {
  const chunking = normalizeChunkingOptions(options);
  return documents.flatMap((document) => chunkDocument(document, chunking));
}

function chunkDocument(document: KnowledgeDocument, options: NormalizedChunkingOptions): KnowledgeChunk[] {
  const frontmatter = document.frontmatter;
  const sections = sectionBlocks(document);
  if (sections.length === 0) {
    return [];
  }
  const drafts = buildSectionChildren(sections, options);
  return drafts.map((draft, index) => {
    const childOrder = index + 1;
    const sourceBlockIds = sourceBlocksForChild(frontmatter.source_block_ids ?? [], draft.blockIndexes);
    const textHash = createHash('sha256').update(JSON.stringify({
      text: draft.text,
      sectionPath: draft.sectionPath,
      sourceBlockIds,
      childOrder,
    })).digest('hex');
    const sectionPrefix = Array.from(draft.sectionPath.join(' / '))
      .slice(0, MAX_RETRIEVAL_SECTION_PREFIX_CODE_POINTS)
      .join('');
    const retrievalText = [sectionPrefix, draft.text].filter(Boolean).join('\n');
    const retrievalTextHash = createHash('sha256').update(retrievalText).digest('hex');
    return {
      chunk_id: `chk_${slug(frontmatter.id)}_${String(childOrder).padStart(3, '0')}`,
      parent_id: frontmatter.id,
      source: document.relativePath,
      source_document: frontmatter.source_document,
      source_document_id: frontmatter.source_document_id,
      source_pages: frontmatter.source_pages ?? [],
      module: frontmatter.module,
      intent: frontmatter.intent,
      source_type: frontmatter.source_type,
      status: frontmatter.status,
      confidence: frontmatter.confidence,
      visibility: frontmatter.visibility,
      headings: draft.sectionPath,
      keywords: Array.from(new Set([
        frontmatter.title,
        frontmatter.module,
        frontmatter.intent,
        ...frontmatter.related_terms,
        ...draft.sectionPath,
      ].flatMap((item) => extractKnowledgeTerms(item)))),
      text: draft.text,
      retrieval_text: retrievalText,
      child_order: childOrder,
      source_block_ids: sourceBlockIds,
      section_path: draft.sectionPath,
      text_hash: textHash,
      retrieval_text_hash: retrievalTextHash,
      parent_title: frontmatter.title,
      parent_terms: [...frontmatter.related_terms],
      quality_status: frontmatter.quality_status,
      chunking_strategy: CURRENT_CHUNKING_STRATEGY,
      artifact_version: CURRENT_ARTIFACT_VERSION,
      legacy: false,
      manual_split_required: draft.manualSplitRequired || undefined,
      overlap_chars: draft.overlapChars || undefined,
      undersized_unmergeable: draft.undersizedUnmergeable || undefined,
    } satisfies KnowledgeChunk;
  });
}

interface SectionBlock {
  text: string;
  sectionPath: string[];
  blockIndex: number;
}

function sectionBlocks(document: KnowledgeDocument): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  const headingStack: string[] = [];
  const lines: string[] = [];
  let blockIndex = 0;

  const currentPath = (): string[] => {
    const configured = document.frontmatter.section_path ?? [];
    const headings = headingStack.filter((heading) => heading !== document.frontmatter.title);
    const path = Array.from(new Set([...configured, ...headings]));
    return path.length > 0 ? path : [document.frontmatter.title];
  };
  const flush = (): void => {
    const text = stripMarkdown(lines.join('\n')).trim();
    lines.length = 0;
    if (!text) return;
    blocks.push({ text, sectionPath: currentPath(), blockIndex });
    blockIndex += 1;
  };

  for (const rawLine of document.body.split(/\r?\n/)) {
    const heading = rawLine.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      headingStack.splice(level - 1);
      headingStack[level - 1] = heading[2]!.trim();
      continue;
    }
    if (!rawLine.trim()) {
      flush();
      continue;
    }
    lines.push(rawLine);
  }
  flush();
  return blocks;
}

function buildSectionChildren(blocks: SectionBlock[], options: NormalizedChunkingOptions): ChildDraft[] {
  const bySection = new Map<string, SectionBlock[]>();
  for (const block of blocks) {
    const key = JSON.stringify(block.sectionPath);
    bySection.set(key, [...(bySection.get(key) ?? []), block]);
  }
  return Array.from(bySection.values()).flatMap((section) => packSection(section, options));
}

function packSection(blocks: SectionBlock[], options: NormalizedChunkingOptions): ChildDraft[] {
  const children: ChildDraft[] = [];
  let texts: string[] = [];
  let indexes: number[] = [];
  let overlapChars = 0;
  const sectionPath = blocks[0]?.sectionPath ?? [];
  const flush = (manualSplitRequired = false): void => {
    const text = texts.join('\n\n').trim();
    if (!text) return;
    children.push({ text, sectionPath, blockIndexes: [...indexes], manualSplitRequired, overlapChars, undersizedUnmergeable: false });
    texts = [];
    indexes = [];
    overlapChars = 0;
  };

  for (const block of blocks) {
    if (block.text.length > options.maxChars) {
      flush();
      children.push(...splitLongBlock(block, sectionPath, options));
      continue;
    }
    const nextText = [...texts, block.text].join('\n\n');
    if (texts.length > 0 && nextText.length > options.maxChars) {
      const previousSentence = overlapText(texts.at(-1) ?? '', options);
      flush();
      if (previousSentence) {
        texts = [previousSentence];
        overlapChars = previousSentence.length;
      }
    }
    texts.push(block.text);
    indexes.push(block.blockIndex);
  }
  flush();
  return rebalanceUndersized(children, options);
}

function splitLongBlock(
  block: SectionBlock,
  sectionPath: string[],
  options: NormalizedChunkingOptions,
): ChildDraft[] {
  const sentences = splitIntoSentences(block.text);
  if (sentences.length <= 1 || sentences.some((sentence) => sentence.length > options.maxChars)) {
    return [{
      text: block.text,
      sectionPath,
      blockIndexes: [block.blockIndex],
      manualSplitRequired: true,
      overlapChars: 0,
      undersizedUnmergeable: block.text.length < options.minChars,
    }];
  }

  const children: ChildDraft[] = [];
  let window: string[] = [];
  let currentOverlapChars = 0;
  const flush = (): void => {
    const text = window.join('').trim();
    if (!text) return;
    children.push({
      text,
      sectionPath,
      blockIndexes: [block.blockIndex],
      manualSplitRequired: false,
      overlapChars: currentOverlapChars,
      undersizedUnmergeable: false,
    });
  };

  for (const sentence of sentences) {
    const candidate = [...window, sentence].join('').trim();
    if (window.length > 0 && candidate.length > options.maxChars) {
      flush();
      const overlap = windowOverlap(window, options);
      window = overlap ? [overlap] : [];
      currentOverlapChars = overlap.length;
    }
    window.push(sentence);
  }
  flush();
  return children;
}
