import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { indexesDir, knowledgeReportsRoot, qualityReportPath, sourceQualityReportPath } from '../paths.js';
import type { KnowledgeQualityReport } from '../types.js';
import { sourceQualityReportFromQualityReport } from './aggregation.js';

export { sourceQualityReportFromQualityReport } from './aggregation.js';

export function writeKnowledgeQualityReport(input: { workspaceRoot: string; report: KnowledgeQualityReport }): string {
  mkdirSync(indexesDir(input.workspaceRoot), { recursive: true });
  const path = qualityReportPath(input.workspaceRoot);
  writeFileSync(path, `${JSON.stringify(input.report, null, 2)}\n`, 'utf8');
  return path;
}

export function readKnowledgeQualityReport(workspaceRoot: string): KnowledgeQualityReport | undefined {
  return readReport(qualityReportPath(workspaceRoot));
}

export function writeSourceQualityReport(input: { workspaceRoot: string; report: KnowledgeQualityReport }): string {
  mkdirSync(knowledgeReportsRoot(input.workspaceRoot), { recursive: true });
  const path = sourceQualityReportPath(input.workspaceRoot);
  writeFileSync(path, `${JSON.stringify(sourceQualityReportFromQualityReport(input.report), null, 2)}\n`, 'utf8');
  return path;
}

export function readSourceQualityReport(workspaceRoot: string): KnowledgeQualityReport | undefined {
  return readReport(sourceQualityReportPath(workspaceRoot));
}

function readReport(path: string): KnowledgeQualityReport | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as KnowledgeQualityReport;
  } catch {
    return undefined;
  }
}
