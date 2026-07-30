import type { KnowledgeChunk } from '../../knowledge/types.js';
import type { KnowledgeParentGrounding } from '../../knowledge/documents/retrieval-grounding.js';
import { selectAnswerSpan } from '../answer-span.js';
import type { RetrievalCandidate } from '../types.js';

export function createKnowledgeRetrievalCandidate(input: {
  chunk: KnowledgeChunk;
  parent?: KnowledgeParentGrounding;
  matchedTerms?: string[];
  score: number;
}): RetrievalCandidate {
  const { chunk, parent } = input;
  const frontmatter = parent?.document.frontmatter;
  const groundingIssues = [
    ...(parent ? [] : ['missing_parent']),
    ...(chunk.legacy ? ['legacy_chunk', 'rebuild_required'] : []),
    ...(!chunk.source_block_ids?.length ? ['missing_child_source_blocks'] : []),
    ...(!chunk.section_path?.length ? ['missing_child_section_path'] : []),
  ];
  const contextText = (chunk.legacy && parent ? parent.document.body : chunk.text).slice(0, 1600);
  return {
    id: chunk.chunk_id,
    chunkId: chunk.chunk_id,
    documentId: frontmatter?.id ?? chunk.parent_id,
    parentId: frontmatter?.id ?? chunk.parent_id,
    source: parent?.document.relativePath ?? chunk.source,
    sourceDocument: frontmatter?.source_document,
    sourceDocumentId: frontmatter?.source_document_id,
    sourcePages: frontmatter?.source_pages ?? chunk.source_pages,
    sourceBlockIds: chunk.source_block_ids?.length ? chunk.source_block_ids : frontmatter?.source_block_ids,
    sectionPath: chunk.section_path?.length ? chunk.section_path : frontmatter?.section_path,
    title: frontmatter?.title ?? chunk.headings[0],
    type: frontmatter?.type,
    module: frontmatter?.module ?? chunk.module,
    intent: frontmatter?.intent ?? chunk.intent,
    sourceType: frontmatter?.source_type ?? chunk.source_type,
    confidence: frontmatter?.confidence ?? chunk.confidence,
    status: frontmatter?.status ?? chunk.status,
    visibility: frontmatter?.visibility ?? chunk.visibility ?? 'internal',
    lastVerifiedAt: frontmatter?.last_verified_at,
    matchedTerms: input.matchedTerms ?? [],
    summary: frontmatter?.title ?? chunk.headings[0] ?? chunk.source,
    excerpt: contextText,
    answerSpan: selectAnswerSpan({ text: contextText, matchedTerms: input.matchedTerms }),
    quality: parent?.quality,
    groundingIssues,
    taxonomyKnown: parent?.taxonomyKnown,
    text: chunk.text,
    retrievalText: chunk.retrieval_text ?? chunk.text,
    score: input.score,
  };
}
