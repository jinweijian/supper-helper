import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceDraftReportPath, sourceDraftRoot } from './paths.js';
import type {
  KnowledgeDraftSliceReport,
  KnowledgeNormalizedBlock,
  KnowledgePipelineStage,
  KnowledgePipelineStatus,
  KnowledgeStatus,
} from './types.js';

import { blockText, inferModule, renderBody, renderDraftSlice, safeSlug } from './slicer-render.js';
const DEFAULT_MAX_PARENT_CHARS = 2800;
const DEFAULT_MIN_BODY_CHARS = 80;

export interface BuildDraftSlicesInput {
  workspaceRoot: string;
  sourceDocumentId: string;
  sourceTitle: string;
  sourceKind: string;
  sourceDocumentPath?: string;
  normalizedBlocks: KnowledgeNormalizedBlock[];
  maxParentChars?: number;
  minBodyChars?: number;
}

export interface BuildDraftSlicesResult {
  draftIds: string[];
  report: KnowledgeDraftSliceReport;
  draftPaths: string[];
}

export function buildDraftSlices(input: BuildDraftSlicesInput): BuildDraftSlicesResult {
  const maxChars = input.maxParentChars ?? DEFAULT_MAX_PARENT_CHARS;
  const minChars = input.minBodyChars ?? DEFAULT_MIN_BODY_CHARS;
  const included = input.normalizedBlocks.filter((b) => b.included_in_slice);
  const groups = groupBlocksByHeading(included);
  const draftRoot = sourceDraftRoot(input.workspaceRoot, input.sourceDocumentId);
  mkdirSync(draftRoot, { recursive: true });

  const draftIds: string[] = [];
  const draftPaths: string[] = [];
  const warnings: string[] = [];
  const moduleInferred = inferModule(input.sourceTitle, included.map((b) => b.text).join('\n'));
  let sliceIndex = 0;
  const coveredBlockIds = new Set<string>();

  for (const group of groups) {
    const splitGroups = splitBlockGroupIntoDraftGroups(group, maxChars, warnings);
    for (let partIndex = 0; partIndex < splitGroups.length; partIndex += 1) {
      const splitGroup = splitGroups[partIndex]!;
      const sliceBody = renderBody(splitGroup.blocks, minChars, warnings);
      if (!sliceBody.trim()) {
        continue;
      }
      sliceIndex += 1;
      const sliceId = `drf_${input.sourceDocumentId}_${String(sliceIndex).padStart(3, '0')}`;
      const slug = safeSlug(group.title || input.sourceTitle);
      const partSuffix = splitGroups.length > 1 ? `-part-${partIndex + 1}` : '';
      const path = join(draftRoot, `${String(sliceIndex).padStart(3, '0')}-${slug}${partSuffix}.md`);
      const firstBlockId = splitGroup.blocks[0]?.source_block_id;
      const lastBlockId = splitGroup.blocks[splitGroup.blocks.length - 1]?.source_block_id;
      const sourceBlockIds = splitGroup.blocks.map((b) => b.source_block_id);
      sourceBlockIds.forEach((id) => coveredBlockIds.add(id));
      const title = splitGroups.length > 1
        ? `${group.title || input.sourceTitle} 第 ${partIndex + 1} 部分`
        : group.title || input.sourceTitle;

      const content = renderDraftSlice({
        id: sliceId,
        title,
        module: moduleInferred,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentPath: input.sourceDocumentPath,
        sourceTitle: input.sourceTitle,
        sectionPath: group.sectionPath,
        sourceBlockIds,
        body: sliceBody,
        firstBlockId,
        lastBlockId,
      });

      writeFileSync(path, content, 'utf8');
      draftIds.push(sliceId);
      draftPaths.push(path);
    }
  }

  if (draftIds.length === 0) {
    warnings.push('No draft slices generated; consider widening input or relaxing boilerplate detection.');
  }

  const includedCount = included.length;
  const includedBlockIds = included.map((block) => block.source_block_id);
  const uncoveredBlockIds = includedBlockIds.filter((id) => !coveredBlockIds.has(id));

  const report: KnowledgeDraftSliceReport = {
    version: 1,
    sourceDocumentId: input.sourceDocumentId,
    draftSliceCount: draftIds.length,
    draftPaths,
    sourceBlockCoverage: { included: includedCount, total: coveredBlockIds.size },
    coveredSourceBlockIds: Array.from(coveredBlockIds),
    uncoveredSourceBlockIds: uncoveredBlockIds,
    warnings,
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(sourceDraftReportPath(input.workspaceRoot, input.sourceDocumentId), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { draftIds, report, draftPaths };
}

export interface BlockGroup {
  title: string;
  sectionPath: string[];
  blocks: KnowledgeNormalizedBlock[];
}

function groupBlocksByHeading(blocks: KnowledgeNormalizedBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  let current: BlockGroup = { title: '', sectionPath: [], blocks: [] };

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (current.blocks.length > 0) {
        groups.push(current);
      }
      current = {
        title: block.text,
        sectionPath: block.section_path.length > 0 ? block.section_path : [block.text],
        blocks: [block],
      };
    } else {
      current.blocks.push(block);
    }
  }
  if (current.blocks.length > 0) {
    groups.push(current);
  }
  if (groups.length === 0 && blocks.length > 0) {
    groups.push({ title: '', sectionPath: [], blocks });
  }
  return groups;
}

export function splitBlockGroupIntoDraftGroups(group: BlockGroup, maxChars: number, warnings: string[] = []): BlockGroup[] {
  const totalLength = group.blocks.reduce((sum, block) => sum + blockText(block).length, 0);
  if (totalLength <= maxChars) {
    return [group];
  }

  const result: BlockGroup[] = [];
  let current: KnowledgeNormalizedBlock[] = [];
  let currentLength = 0;

  const pushCurrent = (): void => {
    if (current.length === 0) {
      return;
    }
    result.push({ title: group.title, sectionPath: group.sectionPath, blocks: current });
    current = [];
    currentLength = 0;
  };

  for (const block of group.blocks) {
    const textLength = blockText(block).length;
    if (textLength > maxChars && current.length === 0) {
      result.push({ title: group.title, sectionPath: group.sectionPath, blocks: [block] });
      warnings.push(`manual_split_required: ${block.source_block_id} exceeds maxParentChars=${maxChars}.`);
      continue;
    }

    const currentHasBody = current.some((item) => item.type !== 'heading');
    if (textLength > maxChars && current.length > 0 && !currentHasBody) {
      current.push(block);
      currentLength += textLength;
      warnings.push(`manual_split_required: ${block.source_block_id} exceeds maxParentChars=${maxChars}.`);
      pushCurrent();
      continue;
    }
    if (current.length > 0 && currentHasBody && currentLength + textLength > maxChars) {
      pushCurrent();
    }

    current.push(block);
    currentLength += textLength;
  }

  pushCurrent();
  return result.length > 0 ? result : [group];
}

export function readDraftSlices(workspaceRoot: string, sourceDocumentId: string): Array<{ path: string; content: string }> {
  const root = sourceDraftRoot(workspaceRoot, sourceDocumentId);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(root, name))
    .flatMap((path) => {
      if (!statSync(path).isFile()) {
        return [];
      }
      return [{ path, content: readFileSync(path, 'utf8') }];
    });
}
