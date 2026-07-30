import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverKnowledgeDocuments, loadSourceDocuments } from './documents/discovery.js';
import { readKnowledgeChunks } from './indexes/chunks.js';
import { knowledgeReportsRoot } from './paths.js';

export interface KnowledgeMigrationReport {
  version: 1;
  generatedAt: string;
  workspaceRoot: string;
  sourceDocumentCount: number;
  parents: Array<{
    id: string;
    module: string;
    status: string;
    chunkingStrategy?: string;
    directEligible: boolean;
    blockers: string[];
  }>;
  legacyChunks: Array<{ chunkId: string; parentId: string; blockers: string[] }>;
  batches: Array<{
    module: string;
    order: number;
    status: 'blocked_missing_sources' | 'blocked_quality_or_provenance' | 'ready_for_human_review';
    parentIds: string[];
  }>;
  reviewQueue: Array<{ module: string; parentId: string; blockers: string[] }>;
  reportPath: string;
  reviewQueuePath: string;
}

export function generateKnowledgeMigrationReport(input: {
  workspaceRoot: string;
  modules?: string[];
}): KnowledgeMigrationReport {
  const modules = input.modules ?? ['ai-companion', 'edusoho-training'];
  const documents = discoverKnowledgeDocuments(input.workspaceRoot);
  const sources = loadSourceDocuments(input.workspaceRoot);
  const chunks = readKnowledgeChunks(input.workspaceRoot).chunks;
  const chunksByParent = new Map<string, typeof chunks>();
  for (const chunk of chunks) {
    chunksByParent.set(chunk.parent_id, [...(chunksByParent.get(chunk.parent_id) ?? []), chunk]);
  }
  const parents = documents.map((document) => {
    const parentChunks = chunksByParent.get(document.frontmatter.id) ?? [];
    const blockers = parentBlockers(document.frontmatter, parentChunks);
    return {
      id: document.frontmatter.id,
      module: document.frontmatter.module,
      status: document.frontmatter.status,
      chunkingStrategy: document.frontmatter.chunking_strategy,
      directEligible: blockers.length === 0,
      blockers,
    };
  });
  const legacyChunks = chunks
    .filter((chunk) => chunk.legacy || chunk.artifact_version !== 4 || chunk.chunking_strategy !== 'parent-child-v4')
    .map((chunk) => ({
      chunkId: chunk.chunk_id,
      parentId: chunk.parent_id,
      blockers: [
        'legacy_chunk',
        ...(!chunk.source_block_ids?.length ? ['missing_source_block_ids'] : []),
        ...(!chunk.section_path?.length ? ['missing_section_path'] : []),
      ],
    }));
  const reviewQueue = parents
    .filter((parent) => modules.includes(parent.module) && !parent.directEligible)
    .map((parent) => ({ module: parent.module, parentId: parent.id, blockers: parent.blockers }));
  const batches = modules.map((module, index) => {
    const moduleParents = parents.filter((parent) => parent.module === module);
    const hasSource = documents
      .filter((document) => document.frontmatter.module === module)
      .some((document) => sources.some((source) => source.id === document.frontmatter.source_document_id));
    return {
      module,
      order: index + 1,
      status: !hasSource
        ? 'blocked_missing_sources' as const
        : moduleParents.some((parent) => !parent.directEligible)
          ? 'blocked_quality_or_provenance' as const
          : 'ready_for_human_review' as const,
      parentIds: moduleParents.map((parent) => parent.id),
    };
  });
  const reportDirectory = knowledgeReportsRoot(input.workspaceRoot);
  const reportPath = join(reportDirectory, 'migration-report.json');
  const reviewQueuePath = join(reportDirectory, 'migration-review-queue.json');
  const report: KnowledgeMigrationReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    workspaceRoot: input.workspaceRoot,
    sourceDocumentCount: sources.length,
    parents,
    legacyChunks,
    batches,
    reviewQueue,
    reportPath,
    reviewQueuePath,
  };
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(reviewQueuePath, `${JSON.stringify({
    version: 1,
    generatedAt: report.generatedAt,
    items: reviewQueue,
    requiresHumanReview: true,
  }, null, 2)}\n`, 'utf8');
  return report;
}

function parentBlockers(
  frontmatter: {
    status: string;
    quality_status?: string;
    source_document?: string;
    source_document_id?: string;
    source_block_ids?: string[];
    section_path?: string[];
    chunking_strategy?: string;
  },
  chunks: Array<{
    artifact_version?: number;
    legacy?: boolean;
    source_block_ids?: string[];
    section_path?: string[];
  }>,
): string[] {
  return Array.from(new Set([
    ...(frontmatter.status !== 'active' ? [`status_${frontmatter.status}`] : []),
    ...(frontmatter.quality_status !== 'ok' ? [`quality_${frontmatter.quality_status ?? 'unknown'}`] : []),
    ...(!frontmatter.source_document ? ['missing_source_document'] : []),
    ...(!frontmatter.source_document_id ? ['missing_source_document_id'] : []),
    ...(!frontmatter.source_block_ids?.length ? ['missing_source_block_ids'] : []),
    ...(!frontmatter.section_path?.length ? ['missing_section_path'] : []),
    ...(frontmatter.chunking_strategy !== 'parent-child-v4' ? ['legacy_parent_strategy'] : []),
    ...(chunks.length === 0 ? ['missing_children'] : []),
    ...(chunks.some((chunk) => chunk.legacy || chunk.artifact_version !== 4) ? ['legacy_child'] : []),
    ...(chunks.some((chunk) => !chunk.source_block_ids?.length || !chunk.section_path?.length) ? ['incomplete_child_provenance'] : []),
  ]));
}
