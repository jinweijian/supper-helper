import { lastBoundedCompleteSentence } from './chunk-utils.js';
import type { NormalizedChunkingOptions } from './chunk-contracts.js';

export interface ChildDraft {
  text: string;
  sectionPath: string[];
  blockIndexes: number[];
  manualSplitRequired: boolean;
  overlapChars: number;
  undersizedUnmergeable: boolean;
}

export function rebalanceUndersized(
  children: ChildDraft[],
  options: NormalizedChunkingOptions,
): ChildDraft[] {
  if (children.length < 2) {
    return children.map((child) => ({
      ...child,
      undersizedUnmergeable: child.text.length < options.minChars,
    }));
  }
  const result = children.map((child) => ({ ...child }));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const child = result[index]!;
    if (child.text.length >= options.minChars) continue;
    const previous = result[index - 1]!;
    const mergedText = `${previous.text}\n\n${child.text}`.trim();
    if (
      mergedText.length <= options.maxChars &&
      JSON.stringify(previous.sectionPath) === JSON.stringify(child.sectionPath)
    ) {
      result.splice(index - 1, 2, {
        text: mergedText,
        sectionPath: previous.sectionPath,
        blockIndexes: Array.from(new Set([...previous.blockIndexes, ...child.blockIndexes])),
        manualSplitRequired: previous.manualSplitRequired || child.manualSplitRequired,
        overlapChars: 0,
        undersizedUnmergeable: false,
      });
      continue;
    }
    const rebalanced = JSON.stringify(previous.sectionPath) === JSON.stringify(child.sectionPath)
      ? rebalancePair(previous, child, options)
      : undefined;
    if (rebalanced) {
      result.splice(index - 1, 2, ...rebalanced);
      continue;
    }
    child.undersizedUnmergeable = true;
  }
  return result;
}

function rebalancePair(
  previous: ChildDraft,
  child: ChildDraft,
  options: NormalizedChunkingOptions,
): [ChildDraft, ChildDraft] | undefined {
  const boundaries = Array.from(previous.text.matchAll(/(?:[。！？!?;；.]|\n{2,})/g))
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((boundary) => boundary > 0 && boundary < previous.text.length);
  const candidates = boundaries.flatMap((boundary) => {
    const leftText = previous.text.slice(0, boundary).trim();
    const movedText = previous.text.slice(boundary).trim();
    const rightText = `${movedText}\n\n${child.text}`.trim();
    if (
      !movedText ||
      leftText.length < options.minChars ||
      rightText.length < options.minChars ||
      leftText.length > options.maxChars ||
      rightText.length > options.maxChars
    ) {
      return [];
    }
    return [{
      leftText,
      rightText,
      imbalance: Math.abs(leftText.length - rightText.length),
      boundary,
    }];
  }).sort((left, right) => left.imbalance - right.imbalance || left.boundary - right.boundary);
  const selected = candidates[0];
  if (!selected) return undefined;
  const combinedIndexes = Array.from(new Set([...previous.blockIndexes, ...child.blockIndexes]));
  const overlap = options.overlapChars > 0
    ? lastBoundedCompleteSentence(selected.leftText, options.overlapChars)
    : undefined;
  const rightWithOverlap = overlap
    ? `${overlap}${selected.rightText}`.trim()
    : selected.rightText;
  const boundedRightText = rightWithOverlap.length <= options.maxChars
    ? rightWithOverlap
    : selected.rightText;
  const overlapChars = boundedRightText === rightWithOverlap ? overlap?.length ?? 0 : 0;
  return [
    {
      ...previous,
      text: selected.leftText,
      undersizedUnmergeable: false,
    },
    {
      ...child,
      text: boundedRightText,
      blockIndexes: combinedIndexes,
      manualSplitRequired: previous.manualSplitRequired || child.manualSplitRequired,
      overlapChars,
      undersizedUnmergeable: false,
    },
  ];
}
