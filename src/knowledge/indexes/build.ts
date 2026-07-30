import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildKnowledgeChunks, type KnowledgeChunkingOptions } from '../documents/chunks.js';
import { discoverKnowledgeDocuments, loadSourceDocuments } from '../documents/discovery.js';
import { normalizeKnowledgeText } from '../documents/terms.js';
import {
  chunksPath,
  dirtyFlagPath,
  keywordIndexPath,
  knowledgeRoot,
  manifestPath,
} from '../paths.js';
import {
  auditKnowledgeQuality,
  evaluateQualityGate,
  type KnowledgeQualityGate,
  writeKnowledgeQualityReport,
  writeSourceQualityReport,
} from '../quality.js';
import type { KnowledgeChunk, KnowledgeIndexManifest, KnowledgeUpdateResult } from '../types.js';
import { validateKnowledgeTaxonomyCoverage } from '../taxonomy.js';
import { publishKnowledgeGeneration, readActiveKnowledgeGeneration } from '../generation-store.js';

export interface PreparedKnowledgeIndexGeneration {
  result: KnowledgeUpdateResult;
  chunks: KnowledgeChunk[];
  files: Record<'chunks.jsonl' | 'manifest.json' | 'keyword-index.json', string>;
}

export function prepareKnowledgeIndexGeneration(input: {
  workspaceRoot: string;
  chunking?: KnowledgeChunkingOptions;
}): PreparedKnowledgeIndexGeneration {
  const root = knowledgeRoot(input.workspaceRoot);
  const docs = discoverKnowledgeDocuments(input.workspaceRoot);
  const sourceDocuments = loadSourceDocuments(input.workspaceRoot);
  const chunks = buildKnowledgeChunks(docs, input.chunking);
  const taxonomy = validateKnowledgeTaxonomyCoverage({
    workspaceRoot: input.workspaceRoot,
    modules: docs.map((document) => document.frontmatter.module),
  });
  const manifest: KnowledgeIndexManifest = {
    version: 1,
    updated_at: new Date().toISOString(),
    document_count: docs.length,
    chunk_count: chunks.length,
    source_document_count: sourceDocuments.length,
    documents: docs.map((document) => ({
      id: document.frontmatter.id,
      path: document.relativePath,
      title: document.frontmatter.title,
      type: document.frontmatter.type,
      module: document.frontmatter.module,
      intent: document.frontmatter.intent,
      status: document.frontmatter.status,
      confidence: document.frontmatter.confidence,
    })),
    taxonomy: {
      known_modules: taxonomy.knownModules,
      unknown_modules: taxonomy.unknownModules,
    },
  };
  return {
    chunks,
    files: {
      'chunks.jsonl': chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + (chunks.length ? '\n' : ''),
      'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
      'keyword-index.json': `${JSON.stringify(buildKeywordIndex(chunks), null, 2)}\n`,
    },
    result: {
      knowledgeRoot: root,
      documentCount: docs.length,
      chunkCount: chunks.length,
      sourceDocumentCount: sourceDocuments.length,
      manifestPath: manifestPath(input.workspaceRoot),
      chunksPath: chunksPath(input.workspaceRoot),
      taxonomyWarnings: taxonomy.unknownModules.map((module) => `unknown_module:${module}`),
    },
  };
}

export function updateKnowledgeIndex(input: {
  workspaceRoot: string;
  chunking?: KnowledgeChunkingOptions;
}): KnowledgeUpdateResult {
  const prepared = prepareKnowledgeIndexGeneration(input);
  mkdirSync(join(prepared.result.knowledgeRoot, 'indexes'), { recursive: true });
  publishKnowledgeGeneration({
    workspaceRoot: input.workspaceRoot,
    expectedActiveGenerationId: readActiveKnowledgeGeneration(input.workspaceRoot)?.generation_id,
    mode: 'bm25_only',
    files: prepared.files,
  });
  return finalizeKnowledgeIndexGeneration(input.workspaceRoot, prepared.result);
}

export function finalizeKnowledgeIndexGeneration(
  workspaceRoot: string,
  result: KnowledgeUpdateResult,
): KnowledgeUpdateResult {
  if (existsSync(dirtyFlagPath(workspaceRoot))) {
    rmSync(dirtyFlagPath(workspaceRoot), { force: true });
  }
  return {
    ...result,
    manifestPath: manifestPath(workspaceRoot),
    chunksPath: chunksPath(workspaceRoot),
  };
}

export function updateKnowledgeIndexWithQuality(input: {
  workspaceRoot: string;
  qualityGate?: KnowledgeQualityGate;
  chunking?: KnowledgeChunkingOptions;
}): KnowledgeUpdateResult {
  const gate = input.qualityGate ?? 'warn';
  const result = updateKnowledgeIndex({ workspaceRoot: input.workspaceRoot, chunking: input.chunking });
  if (gate === 'off') {
    return {
      ...result,
      qualityGateResult: { passed: true, exitCode: 0, reason: 'quality gate disabled' },
    };
  }
  const report = auditKnowledgeQuality({ workspaceRoot: input.workspaceRoot, gate });
  const qualityReportPath = writeKnowledgeQualityReport({ workspaceRoot: input.workspaceRoot, report });
  const sourceQualityReportPath = writeSourceQualityReport({ workspaceRoot: input.workspaceRoot, report });
  return {
    ...result,
    qualityReportPath,
    sourceQualityReportPath,
    qualityGateResult: evaluateQualityGate(report, gate),
    qualitySeverityCounts: report.severityCounts,
    qualityIssueCounts: report.issueCounts,
  };
}

function buildKeywordIndex(chunks: KnowledgeChunk[]): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const chunk of chunks) {
    for (const keyword of chunk.keywords) {
      const normalized = normalizeKnowledgeText(keyword);
      if (!normalized) continue;
      index[normalized] = Array.from(new Set([...(index[normalized] ?? []), chunk.chunk_id]));
    }
  }
  return index;
}
