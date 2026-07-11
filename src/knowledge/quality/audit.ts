import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { discoverKnowledgeDocuments, loadSourceDocuments } from '../documents/discovery.js';
import { parseMarkdownDocument } from '../frontmatter.js';
import {
  DEFAULT_QUALITY_THRESHOLDS,
  type KnowledgeDocument,
  type KnowledgeQualityIssue,
  type KnowledgeQualityReport,
  type KnowledgeQualityThresholds,
} from '../types.js';
import { aggregateQualityIssues } from './aggregation.js';
import { auditKnowledgeChunks } from './chunk-rules.js';
import type { KnowledgeQualityGate } from './gate.js';
import { auditSliceDocuments, __testing } from './slice-rules.js';
import { auditSourceDocuments } from './source-rules.js';

export interface AuditKnowledgeInput {
  workspaceRoot: string;
  thresholds?: Partial<KnowledgeQualityThresholds>;
  gate?: KnowledgeQualityGate;
}

export function auditKnowledgeQuality(input: AuditKnowledgeInput): KnowledgeQualityReport {
  const thresholds = { ...DEFAULT_QUALITY_THRESHOLDS, ...(input.thresholds ?? {}) };
  const gate = input.gate ?? 'warn';
  const issues: KnowledgeQualityIssue[] = [];
  const documents = [...discoverKnowledgeDocuments(input.workspaceRoot), ...discoverDraftSlices(input.workspaceRoot)];
  const sources = loadSourceDocuments(input.workspaceRoot);
  const knownSourceBlockIds = auditSourceDocuments(input.workspaceRoot, sources, issues);
  auditSliceDocuments(documents, thresholds, issues, knownSourceBlockIds);
  const chunkCount = auditKnowledgeChunks(documents, input.workspaceRoot, issues);
  issues.sort((left, right) => left.code.localeCompare(right.code)
    || (left.documentId ?? '').localeCompare(right.documentId ?? ''));
  return {
    version: 1,
    workspaceRoot: input.workspaceRoot,
    knowledgeRoot: join(input.workspaceRoot, 'knowledge'),
    generatedAt: new Date().toISOString(),
    thresholds,
    inspected: {
      sourceDocuments: sources.length,
      draftSlices: documents.filter((document) => document.frontmatter.status === 'draft').length,
      publishedSlices: documents.filter((document) => document.frontmatter.status === 'active').length,
      chunks: chunkCount,
    },
    ...aggregateQualityIssues(issues),
    issues,
    gate,
  };
}

function discoverDraftSlices(workspaceRoot: string): KnowledgeDocument[] {
  const draftsRoot = join(workspaceRoot, 'knowledge', '_pipeline', 'drafts');
  if (!existsSync(draftsRoot)) return [];
  const documents: KnowledgeDocument[] = [];
  for (const sourceDirectory of readdirSync(draftsRoot)) {
    const sourcePath = join(draftsRoot, sourceDirectory);
    if (!statSync(sourcePath).isDirectory()) continue;
    for (const file of readdirSync(sourcePath)) {
      const fullPath = join(sourcePath, file);
      if (!file.endsWith('.md') || !statSync(fullPath).isFile()) continue;
      try {
        const parsed = parseMarkdownDocument(readFileSync(fullPath, 'utf8'), fullPath);
        documents.push({
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          headings: parsed.body.split(/\r?\n/)
            .map((line) => line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim())
            .filter((heading): heading is string => Boolean(heading)),
          path: fullPath,
          relativePath: relative(workspaceRoot, fullPath).replaceAll('\\', '/'),
        });
      } catch { /* malformed draft remains excluded for legacy compatibility */ }
    }
  }
  return documents;
}

export { parseMarkdownDocument, __testing };
export type { KnowledgeDocument, KnowledgeQualityGate };
export {
  readKnowledgeQualityReport,
  readSourceQualityReport,
  sourceQualityReportFromQualityReport,
  writeKnowledgeQualityReport,
  writeSourceQualityReport,
} from './report-io.js';
export { evaluateQualityGate } from './gate.js';
export { loadChunkQualityMap } from './chunk-map.js';
