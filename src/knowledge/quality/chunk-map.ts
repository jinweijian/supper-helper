import { readKnowledgeQualityReport } from './report-io.js';

export interface ChunkQualitySummary {
  severity: 'ok' | 'info' | 'warn' | 'error';
  issues: string[];
}

export function loadChunkQualityMap(workspaceRoot: string): Map<string, ChunkQualitySummary> {
  const report = readKnowledgeQualityReport(workspaceRoot);
  const map = new Map<string, ChunkQualitySummary>();
  if (!report) return map;
  for (const issue of report.issues) {
    if (!issue.documentId) continue;
    if (issue.source?.includes('knowledge/_pipeline/drafts/')) continue;
    const current = map.get(issue.documentId) ?? { severity: 'ok' as const, issues: [] };
    if (issue.severity === 'error') current.severity = 'error';
    else if (issue.severity === 'warn' && current.severity !== 'error') current.severity = 'warn';
    else if (issue.severity === 'info' && current.severity === 'ok') current.severity = 'info';
    current.issues.push(issue.code);
    map.set(issue.documentId, current);
  }
  return map;
}
