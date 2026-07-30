import { createHash } from 'node:crypto';
import type { KnowledgeChunk } from '../types.js';
import {
  CURRENT_ARTIFACT_VERSION,
  CURRENT_CHUNKING_STRATEGY,
  DEFAULT_CHUNKING_OPTIONS,
  type KnowledgeChunkingOptions,
  type NormalizedChunkingOptions,
} from './chunk-contracts.js';

export function splitIntoSentences(text: string): string[] {
  return (text.replace(/\r\n/g, '\n').match(/[^。！？!?;；.\n]+(?:[。！？!?;；.]|\n+|$)/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function overlapText(text: string, options: NormalizedChunkingOptions): string | undefined {
  if (options.overlapChars <= 0) return undefined;
  if (options.overlapStrategy === 'sliding') {
    const overlap = text.slice(-options.overlapChars).trim();
    return overlap || undefined;
  }
  const sentence = lastBoundedCompleteSentence(text, options.overlapChars);
  return sentence && sentence.length <= options.overlapChars ? sentence : undefined;
}

export function windowOverlap(window: string[], options: NormalizedChunkingOptions): string {
  if (options.overlapChars <= 0 || window.length === 0) return '';
  if (options.overlapStrategy === 'sliding') {
    return window.join('').slice(-options.overlapChars).trim();
  }
  const sentence = window.at(-1)?.trim() ?? '';
  return sentence.length <= options.overlapChars ? sentence : '';
}

export function lastBoundedCompleteSentence(text: string, maxChars: number): string | undefined {
  const sentences = text.match(/[^。！？!?;；.]+[。！？!?;；.]/g) ?? [];
  const sentence = sentences.at(-1)?.trim();
  return sentence && sentence.length <= maxChars ? sentence : undefined;
}

export function normalizeChunkingOptions(options?: KnowledgeChunkingOptions): NormalizedChunkingOptions {
  const maxChars = positiveInteger(options?.maxChars, DEFAULT_CHUNKING_OPTIONS.maxChars);
  const requestedOverlap = options?.overlapChars;
  const overlapChars = Number.isFinite(requestedOverlap) && requestedOverlap! >= 0
    ? Math.floor(requestedOverlap!)
    : DEFAULT_CHUNKING_OPTIONS.overlapChars;
  return {
    maxChars,
    overlapStrategy: options?.overlapStrategy === 'sliding' ? 'sliding' : 'sentence',
    overlapChars: Math.min(overlapChars, maxChars),
    minChars: Math.min(positiveInteger(options?.minChars, DEFAULT_CHUNKING_OPTIONS.minChars), maxChars),
  };
}

export function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback;
}

export function sourceBlocksForChild(sourceBlockIds: string[], blockIndexes: number[]): string[] {
  if (sourceBlockIds.length === 0) return [];
  // Parent Markdown 没有保留无损的 block-to-paragraph 标记；保留完整父级溯源，
  // 避免猜测一个看似更精确、实际无法证明的子集。
  void blockIndexes;
  return Array.from(new Set(sourceBlockIds));
}

export function stripMarkdown(body: string): string {
  return body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'chunk';
}

export function markLegacyChunk(chunk: KnowledgeChunk): KnowledgeChunk {
  const current = chunk.artifact_version === CURRENT_ARTIFACT_VERSION
    && chunk.chunking_strategy === CURRENT_CHUNKING_STRATEGY;
  return { ...chunk, legacy: !current };
}
