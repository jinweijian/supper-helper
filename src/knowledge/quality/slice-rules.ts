import { createHash } from 'node:crypto';
import type {
  KnowledgeDocument,
  KnowledgeQualityIssue,
  KnowledgeQualityThresholds,
} from '../types.js';
import {
  hasAnswerBearingSentence,
  isBrokenCoreference,
  isHeadingOnly,
  isMultiTopic,
  isTocLike,
} from './slice-heuristics.js';

export function auditSliceDocuments(
  documents: KnowledgeDocument[],
  thresholds: KnowledgeQualityThresholds,
  issues: KnowledgeQualityIssue[],
  knownSourceBlockIds: Map<string, Set<string>>,
): void {
  const duplicates = computeDuplicateHashes(documents);
  for (const document of documents) auditSlice(document, duplicates, thresholds, issues, knownSourceBlockIds);
}

export function meaningfulBody(document: KnowledgeDocument): string {
  return document.body.split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^##\s+(可回答的问题|原文来源)/.test(line))
    .map((line) => line.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function computeDuplicateHashes(documents: KnowledgeDocument[]): Map<string, KnowledgeDocument[]> {
  const map = new Map<string, KnowledgeDocument[]>();
  for (const document of documents) {
    const hash = hashMeaningfulBody(document);
    if (!hash) continue;
    map.set(hash, [...(map.get(hash) ?? []), document]);
  }
  return new Map([...map].filter(([, matches]) => matches.length > 1));
}

function hashMeaningfulBody(document: KnowledgeDocument): string {
  const body = meaningfulBody(document);
  return body ? createHash('sha1').update(body).digest('hex').slice(0, 16) : '';
}

function auditSlice(
  document: KnowledgeDocument,
  duplicates: Map<string, KnowledgeDocument[]>,
  thresholds: KnowledgeQualityThresholds,
  issues: KnowledgeQualityIssue[],
  knownSourceBlockIds: Map<string, Set<string>>,
): void {
  const fm = document.frontmatter;
  if (!fm.source_document) issues.push(issue('missing_source_document', 'error', `Slice ${fm.id} lacks source_document provenance.`, document));
  if (!fm.source_document_id) issues.push(issue('missing_source_document_id', 'error', `Slice ${fm.id} lacks source_document_id provenance.`, document));
  if (fm.source_document_id && !fm.source_block_ids?.length) {
    issues.push(issue('missing_source_block_ids', 'warn', `Slice ${fm.id} is missing source_block_ids; cannot trace to source.`, document));
  }
  if (fm.source_block_ids?.length && fm.source_document_id) {
    const known = knownSourceBlockIds.get(fm.source_document_id);
    const missingBlocks = known ? fm.source_block_ids.filter((id) => !known.has(id)) : [];
    if (missingBlocks.length) {
      issues.push({ ...issue('missing_source_blocks', 'warn', `Slice ${fm.id} references ${missingBlocks.length} unknown source block id(s).`, document), details: { missingBlocks } });
    }
  }
  if (!fm.section_path?.length) issues.push(issue('missing_section_path', 'warn', `Slice ${fm.id} has no section_path.`, document));
  const body = meaningfulBody(document);
  if (!body) {
    issues.push(issue('empty_body', 'warn', `Slice ${fm.id} has empty meaningful body.`, document));
    return;
  }
  if (body.length < thresholds.minBodyChars) issues.push(issue('too_short', 'warn', `Slice ${fm.id} body length ${body.length} below ${thresholds.minBodyChars}.`, document));
  if (body.length > thresholds.maxParentChars) issues.push(issue('too_long', 'warn', `Slice ${fm.id} body length ${body.length} exceeds ${thresholds.maxParentChars}.`, document));
  if (isTocLike(document)) issues.push(issue('toc_like', 'warn', `Slice ${fm.id} resembles table-of-contents or navigation.`, document));
  if (isHeadingOnly(document, body)) issues.push(issue('heading_only', 'warn', `Slice ${fm.id} contains headings but no substantive body.`, document));
  if (isMultiTopic(document, thresholds.multiTopicHeadingThreshold)) issues.push(issue('multi_topic_slice', 'warn', `Slice ${fm.id} contains multiple unrelated headings.`, document));
  if (isBrokenCoreference(document.body)) issues.push(issue('broken_coreference', 'warn', `Slice ${fm.id} contains unresolved references.`, document));
  if (!hasAnswerBearingSentence(document.body)) issues.push(issue('not_answer_bearing', 'warn', `Slice ${fm.id} has no answer-bearing sentence.`, document));
  const relatedTerms = fm.related_terms?.length ?? 0;
  if (relatedTerms < thresholds.minRelatedTerms) issues.push(issue('low_signal_terms', 'info', `Slice ${fm.id} has ${relatedTerms} related_terms (min ${thresholds.minRelatedTerms}).`, document));
  const hash = hashMeaningfulBody(document);
  const duplicate = hash ? duplicates.get(hash)?.find((candidate) => candidate !== document && candidate.frontmatter.id !== fm.id) : undefined;
  if (duplicate) {
    issues.push({ ...issue('duplicate_content', 'warn', `Slice ${fm.id} duplicates content from ${duplicate.frontmatter.id ?? 'unknown'}.`, document), contentHash: hash });
  }
}

function issue(
  code: KnowledgeQualityIssue['code'],
  severity: KnowledgeQualityIssue['severity'],
  message: string,
  document: KnowledgeDocument,
): KnowledgeQualityIssue {
  return { code, severity, message, documentId: document.frontmatter.id, source: document.relativePath };
}

export const __testing = { isTocLike, isHeadingOnly, isMultiTopic, isBrokenCoreference, hasAnswerBearingSentence };
