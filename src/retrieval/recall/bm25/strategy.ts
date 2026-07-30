import { readKnowledgeChunks } from '../../../knowledge/indexes/chunks.js';
import { loadKnowledgeParentGrounding } from '../../../knowledge/documents/retrieval-grounding.js';
import { loadKnowledgeTaxonomy } from '../../../knowledge/taxonomy.js';
import type { RecallInput, RecallStrategy } from '../contract.js';
import { createKnowledgeRetrievalCandidate } from '../knowledge-candidate.js';
import { scoreFieldWeightedBm25 } from './field-scorer.js';
import { tokenizeForBm25 } from './tokenizer.js';

export function createBm25RecallStrategy(): RecallStrategy {
  return {
    id: 'bm25',
    kind: 'lexical',
    enabled: () => ({ enabled: true }),
    async recall(input: RecallInput) {
      const loaded = readKnowledgeChunks(input.workspaceRoot, input.knowledgeGenerationId);
      const parents = loadKnowledgeParentGrounding(input.workspaceRoot);
      const taxonomy = loadKnowledgeTaxonomy(input.workspaceRoot);
      const eligibleChunks = loaded.chunks.filter((chunk) => (
        chunk.status === 'active' &&
        (!input.moduleCandidates?.length || input.moduleCandidates.includes(chunk.module)) &&
        (!input.intentCandidates?.length || input.intentCandidates.includes(chunk.intent)) &&
        (!input.sourceTypes?.length || input.sourceTypes.includes(chunk.source_type)) &&
        (!input.visibility?.length || input.visibility.includes(chunk.visibility ?? 'internal'))
      ));
      const taxonomyTerms = [
        ...taxonomy.modules.flatMap((module) => [module.id, module.name, ...module.keywords]),
        ...taxonomy.aliases.flatMap((alias) => [alias.alias, alias.term ?? '']),
      ].map((term) => term.trim()).filter(Boolean);
      const registeredSingleCharacterTerms = taxonomyTerms.filter((term) => Array.from(term).length === 1);
      const businessTerms = Array.from(new Set(
        [...taxonomyTerms, ...eligibleChunks.flatMap((chunk) => [
          chunk.parent_title ?? '',
          ...(chunk.parent_terms ?? []),
          ...(chunk.keywords ?? []),
        ])].map((term) => term.trim()).filter((term) => term.length >= 2),
      ));
      const tokenizerOptions = { businessTerms, registeredSingleCharacterTerms };
      // BM25 用 normalized + expandedTerms 增强 tokenize：归一化消除全/半角、繁简差异，
      // expandedTerms 把 alias 对应的 term 加入查询词，提升同义换述召回。
      const normalizedQuery = input.normalizedQuery;
      const queryText = normalizedQuery?.normalized ?? input.query;
      const queryTokens = [
        ...tokenizeForBm25(queryText, tokenizerOptions),
        ...(normalizedQuery?.expandedTerms ?? []).flatMap((term) => tokenizeForBm25(term, tokenizerOptions)),
      ];
      const documents = eligibleChunks.map((chunk) => ({
          id: chunk.chunk_id,
          fields: {
            title: tokenizeForBm25(chunk.parent_title ?? chunk.headings[0] ?? '', tokenizerOptions),
            headings: tokenizeForBm25([...(chunk.headings ?? []), ...(chunk.section_path ?? [])].join(' '), tokenizerOptions),
            relatedTerms: tokenizeForBm25((chunk.parent_terms ?? chunk.keywords ?? []).join(' '), tokenizerOptions),
            moduleIntent: tokenizeForBm25([chunk.module, chunk.intent].join(' '), { ...tokenizerOptions, removeGenericTerms: false }),
            body: tokenizeForBm25(chunk.text, tokenizerOptions),
          },
        }));
      const chunkById = new Map(loaded.chunks.map((chunk) => [chunk.chunk_id, chunk]));
      const candidates = scoreFieldWeightedBm25({ queryTokens, documents })
        .slice(0, input.limit)
        .flatMap((scored) => {
          const chunk = chunkById.get(scored.id);
          if (!chunk) {
            return [];
          }
          const candidate = createKnowledgeRetrievalCandidate({
            chunk,
            parent: parents.get(chunk.parent_id) ?? parents.get(chunk.source),
            matchedTerms: scored.matchedTerms,
            score: scored.score,
          });
          candidate.metadata = {
            ...candidate.metadata,
            bm25FieldContributions: scored.fieldContributions,
          };
          return [candidate];
        });
      const missingParentCount = candidates.filter((candidate) => candidate.groundingIssues?.includes('missing_parent')).length;
      return {
        candidates,
        filteredOut: missingParentCount > 0 ? [{ reason: 'missing_parent', count: missingParentCount }] : [],
      };
    },
  };
}
