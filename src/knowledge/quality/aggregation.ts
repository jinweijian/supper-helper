import type {
  KnowledgeQualityIssue,
  KnowledgeQualityReport,
  KnowledgeQualitySeverity,
} from '../types.js';

export function aggregateQualityIssues(issues: KnowledgeQualityIssue[]): Pick<
  KnowledgeQualityReport,
  'stageSummaries' | 'severityCounts' | 'issueCounts' | 'recommendedActions'
> {
  const stageSummaries: Record<string, { warnings: number; errors: number; info: number }> = {};
  const severityCounts: Record<KnowledgeQualitySeverity, number> = { info: 0, warn: 0, error: 0 };
  const issueCounts: Record<string, number> = {};
  for (const issue of issues) {
    const stage = inferQualityStage(issue);
    const bucket = stageSummaries[stage] ?? { warnings: 0, errors: 0, info: 0 };
    if (issue.severity === 'error') bucket.errors += 1;
    else if (issue.severity === 'warn') bucket.warnings += 1;
    else bucket.info += 1;
    stageSummaries[stage] = bucket;
    severityCounts[issue.severity] += 1;
    issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
  }
  return { stageSummaries, severityCounts, issueCounts, recommendedActions: recommendActions(issueCounts) };
}

export function sourceQualityReportFromQualityReport(report: KnowledgeQualityReport): KnowledgeQualityReport {
  const sourceCodes = new Set([
    'parser_empty', 'too_many_unknown_blocks', 'toc_not_removed', 'header_footer_noise',
    'table_lost', 'list_structure_lost', 'heading_structure_broken', 'duplicate_paragraphs',
    'source_provenance_missing',
  ]);
  const issues = report.issues.filter((issue) => sourceCodes.has(issue.code));
  return {
    ...report,
    inspected: { sourceDocuments: report.inspected.sourceDocuments, draftSlices: 0, publishedSlices: 0, chunks: 0 },
    ...aggregateQualityIssues(issues),
    issues,
  };
}

function inferQualityStage(issue: KnowledgeQualityIssue): string {
  const extractCodes = new Set([
    'parser_empty', 'too_many_unknown_blocks', 'toc_not_removed', 'header_footer_noise',
    'table_lost', 'list_structure_lost', 'heading_structure_broken', 'duplicate_paragraphs',
    'source_provenance_missing',
  ]);
  return extractCodes.has(issue.code) ? 'extract' : 'slice';
}

function recommendActions(counts: Record<string, number>): string[] {
  const actions: string[] = [];
  if (counts.empty_body || counts.heading_only || counts.too_short) actions.push('Re-run draft slice generation with relaxed thresholds or merge adjacent short slices.');
  if (counts.duplicate_content) actions.push('Review duplicate draft slices and remove non-canonical duplicates.');
  if (counts.missing_source_block_ids || counts.missing_source_blocks) actions.push('Repair source block provenance for legacy slices.');
  if (counts.multi_topic_slice) actions.push('Split multi-topic slices on heading boundaries.');
  if (counts.not_answer_bearing) actions.push('Mark not_answer_bearing slices as review_required.');
  if (counts.low_signal_terms) actions.push('Add related_terms using titles, section paths, and high-signal module aliases.');
  if (counts.orphan_chunk || counts.missing_parent) actions.push('Rebuild manifest and chunks to resolve orphan_chunk issues.');
  if (counts.source_provenance_missing) actions.push('Re-intake source files to restore sha256 and stored_path metadata.');
  return actions;
}
