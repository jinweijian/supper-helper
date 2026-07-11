import {
  applyKnowledgeRepairPlan,
  auditKnowledgeQuality,
  buildDraftSlices,
  evaluateQualityGate,
  extractSourceBlocks,
  generateKnowledgeRepairPlan,
  generateKnowledgeMigrationReport,
  loadSourceDocuments,
  normalizeSourceBlocks,
  publishApprovedDraftSlices,
  importRedmineIssueFixture,
  readKnowledgeRepairPlan,
  readSourceBlocks,
  reviewDraftSlices,
  writeKnowledgeQualityReport,
  writeKnowledgeRepairPlan,
  writeSourceQualityReport,
} from '../../knowledge/index.js';
import { hasFlag, readOption } from '../args.js';
import type { KnowledgeCommandContext } from './context.js';
import { readQualityGateArg, resolveSourcePath } from './context.js';

export async function runKnowledgePipelineCommand(
  argv: string[],
  context: KnowledgeCommandContext,
): Promise<boolean> {
  const subcommand = argv[0];
  const workspaceRoot = context.knowledgeWorkspaceRoot;

  if (subcommand === 'extract') {
    const sourceId = readOption(argv, '--source-id');
    const sourceDocuments = loadSourceDocuments(workspaceRoot);
    const sources = sourceId ? [sourceId] : sourceDocuments.map((source) => source.id);
    let totalBlocks = 0;
    for (const id of sources) {
      const sourceMeta = sourceDocuments.find((source) => source.id === id);
      if (!sourceMeta?.path) continue;
      const absolutePath = resolveSourcePath(workspaceRoot, sourceMeta.path);
      const { report } = extractSourceBlocks({ workspaceRoot, sourceDocumentId: id, sourcePath: absolutePath });
      const blockCount = Object.values(report.blockCounts).reduce((total, count) => total + count, 0);
      console.log(`extracted: ${id} -> ${blockCount} blocks (parser=${report.parserStrategy})`);
      totalBlocks += blockCount;
    }
    console.log(`total blocks: ${totalBlocks}`);
    return true;
  }

  if (subcommand === 'normalize') {
    const sourceId = readOption(argv, '--source-id');
    const sourceDocuments = loadSourceDocuments(workspaceRoot);
    const sources = sourceId ? [sourceId] : sourceDocuments.map((source) => source.id);
    let totalBlocks = 0;
    for (const id of sources) {
      const blocks = readSourceBlocks(workspaceRoot, id);
      if (blocks.length === 0) {
        console.log(`normalized: ${id} skipped (no extracted blocks)`);
        continue;
      }
      const { report } = normalizeSourceBlocks({ workspaceRoot, sourceDocumentId: id, blocks });
      console.log(`normalized: ${id} -> ${report.outputBlockCount} blocks`);
      totalBlocks += report.outputBlockCount;
    }
    console.log(`total normalized blocks: ${totalBlocks}`);
    console.log('next: super-helper knowledge slice --workspace <workspace> [--knowledge-root <path>]');
    return true;
  }

  if (subcommand === 'slice') {
    const sources = loadSourceDocuments(workspaceRoot);
    for (const source of sources) {
      if (!source.path) continue;
      const absolutePath = resolveSourcePath(workspaceRoot, source.path);
      const { blocks: extractedBlocks } = extractSourceBlocks({
        workspaceRoot,
        sourceDocumentId: source.id,
        sourcePath: absolutePath,
      });
      const { blocks: normalized } = normalizeSourceBlocks({
        workspaceRoot,
        sourceDocumentId: source.id,
        blocks: extractedBlocks,
      });
      const report = buildDraftSlices({
        workspaceRoot,
        sourceDocumentId: source.id,
        sourceTitle: source.title,
        sourceKind: source.source_kind ?? 'whitepaper',
        sourceDocumentPath: source.path,
        normalizedBlocks: normalized,
      });
      console.log(`sliced: ${source.id} -> ${report.draftIds.length} draft slices`);
    }
    return true;
  }

  if (subcommand === 'audit') {
    const gate = readQualityGateArg(argv, 'warn');
    if (gate === 'off') {
      console.log('quality audit skipped (gate=off)');
      return true;
    }
    const report = auditKnowledgeQuality({ workspaceRoot, gate });
    const path = writeKnowledgeQualityReport({ workspaceRoot, report });
    const sourcePath = writeSourceQualityReport({ workspaceRoot, report });
    const gateResult = evaluateQualityGate(report, gate);
    console.log(`quality report: ${path}`);
    console.log(`source quality report: ${sourcePath}`);
    console.log(`severity: error=${report.severityCounts.error} warn=${report.severityCounts.warn} info=${report.severityCounts.info}`);
    console.log(`top issues: ${Object.entries(report.issueCounts).slice(0, 5).map(([code, count]) => `${code}=${count}`).join(', ')}`);
    if (!gateResult.passed) {
      console.error(`gate failed: ${gateResult.reason}`);
      process.exit(gateResult.exitCode);
    }
    return true;
  }

  if (subcommand === 'repair') {
    if (hasFlag(argv, '--plan')) {
      const plan = generateKnowledgeRepairPlan({ workspaceRoot });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = writeKnowledgeRepairPlan({ workspaceRoot, plan, timestamp });
      console.log(`repair plan: ${path}`);
      console.log(`actions: total=${plan.summary.total} safe=${plan.summary.safe} review_required=${plan.summary.reviewRequired}`);
      return true;
    }
    const planPath = readOption(argv, '--apply');
    if (!planPath) {
      console.error('Usage: super-helper knowledge repair --plan | --apply <plan-path>');
      process.exit(1);
    }
    const plan = readKnowledgeRepairPlan(planPath);
    if (!plan) {
      console.error(`repair plan not found or malformed: ${planPath}`);
      process.exit(1);
    }
    const result = applyKnowledgeRepairPlan({ workspaceRoot, planPath });
    console.log(`repair applied: ${result.appliedActions.length} applied, ${result.skippedActions.length} skipped`);
    if (result.changedFiles.length > 0) console.log(`changed files: ${result.changedFiles.length}`);
    return true;
  }

  if (subcommand === 'review') {
    const action = (readOption(argv, '--action') ?? argv[1]) as 'approve' | 'reject' | 'request_edits' | 'accept_warnings';
    const reviewer = readOption(argv, '--reviewer') ?? 'local-user';
    const notes = readOption(argv, '--notes') ?? '';
    const sourceId = readOption(argv, '--source-id');
    if (!sourceId || !['approve', 'reject', 'request_edits', 'accept_warnings'].includes(action)) {
      console.error('Usage: super-helper knowledge review --source-id <id> --action <approve|reject|request_edits|accept_warnings> --reviewer <name> [--notes <text>]');
      process.exit(1);
    }
    const record = reviewDraftSlices({ workspaceRoot, sourceDocumentId: sourceId, action, reviewer, notes });
    console.log(`review ${record.action}: ${record.reviewedIds.length} slices, reviewer=${record.reviewer}`);
    return true;
  }

  if (subcommand === 'publish') {
    const gate = readQualityGateArg(argv, 'warn');
    const sourceId = readOption(argv, '--source-id');
    const report = publishApprovedDraftSlices({ workspaceRoot, sourceDocumentId: sourceId, qualityGate: gate });
    console.log(`publish: ${report.publishedIds.length} published, ${report.rejectedIds.length} rejected, dirty=${report.indexDirty}`);
    if (report.qualityReportPath) console.log(`quality report used: ${report.qualityReportPath}`);
    return true;
  }

  if (subcommand === 'migration-report') {
    const report = generateKnowledgeMigrationReport({ workspaceRoot });
    console.log(`migration report: ${report.reportPath}`);
    console.log(`review queue: ${report.reviewQueuePath}`);
    for (const batch of report.batches) {
      console.log(`batch ${batch.order}: ${batch.module} status=${batch.status} parents=${batch.parentIds.length}`);
    }
    return true;
  }

  if (subcommand === 'redmine' && argv[1] === 'import-fixture') {
    const issuePath = readOption(argv, '--issue');
    if (!issuePath) {
      console.error('Usage: super-helper knowledge redmine import-fixture --issue <issue.json> [--workspace <path>] [--knowledge-root <path>]');
      process.exit(1);
    }
    const result = importRedmineIssueFixture({
      workspaceRoot,
      issuePath: resolveSourcePath(process.cwd(), issuePath),
    });
    console.log(`redmine imported: issue=${result.issueId}`);
    console.log(`source: ${result.sourcePath}`);
    console.log(`card: ${result.cardPath}`);
    console.log(`status: ${result.status}`);
    console.log(`coverage: ${result.coverageLevel}`);
    console.log(`verification: ${result.verificationStatus}`);
    return true;
  }

  return false;
}
