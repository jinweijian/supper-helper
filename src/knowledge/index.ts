export { parseMarkdownDocument, parseSimpleYaml } from './frontmatter.js';
export { initKnowledgeWorkspace } from './init.js';
export {
  defaultSourceDirectory,
  discoverSourceFiles,
  ingestSourceDocuments,
  intakeSourceDocument,
} from './ingest.js';
export type { IntakeSourceDocumentResult } from './ingest.js';
export {
  chunksPath,
  knowledgeRoot,
  vectorBuildReportPath,
  vectorManifestPath,
  vectorsPath,
} from './paths.js';
export {
  readKnowledgeChunks,
  writeKnowledgeChunks,
} from './indexes/chunks.js';
export type { ReadKnowledgeChunksResult } from './indexes/chunks.js';
export {
  activeGenerationPointerPath,
  createFileKnowledgeGenerationPublisher,
  publishKnowledgeGeneration,
  readActiveKnowledgeGeneration,
  resolveKnowledgeGenerationFile,
  KnowledgeGenerationConflictError,
  recoverStaleKnowledgeGenerationLock,
  rollbackKnowledgeGeneration,
} from './generation-store.js';
export type {
  KnowledgeGenerationManifest,
  KnowledgeGenerationPointer,
  KnowledgeGenerationPublisherPort,
} from './generation-store.js';
export {
  readKnowledgeKeywordIndex,
  writeKnowledgeKeywordIndex,
} from './indexes/keyword-index.js';
export type { KnowledgeKeywordIndex } from './indexes/keyword-index.js';
export {
  bm25IndexPath,
  readKnowledgeBm25Index,
  writeKnowledgeBm25Index,
} from './indexes/bm25-index.js';
export type { KnowledgeBm25Index, KnowledgeBm25IndexEntry } from './indexes/bm25-index.js';
export { resolveKnowledgeWorkspaceRoot, workspaceKnowledgeKey } from './storage-scope.js';
export {
  discoverKnowledgeDocuments,
  loadSourceDocuments,
} from './documents/discovery.js';
export {
  keywordsFromQuery,
  extractKnowledgeTerms,
  normalizeKnowledgeText,
} from './documents/terms.js';
export {
  updateKnowledgeIndex,
  updateKnowledgeIndexWithQuality,
} from './indexes/build.js';
export { loadKnowledgeTaxonomy, routeKnowledgeQuestion, validateKnowledgeTaxonomyCoverage } from './taxonomy.js';
export { buildKnowledgeHealthSummary } from './health.js';
export type { KnowledgeHealthStatus, KnowledgeHealthSummary, KnowledgeSimilarWorkspace } from './health.js';
export {
  auditKnowledgeQuality,
  evaluateQualityGate,
  readKnowledgeQualityReport,
  readSourceQualityReport,
  sourceQualityReportFromQualityReport,
  writeKnowledgeQualityReport,
  writeSourceQualityReport,
  loadChunkQualityMap,
} from './quality.js';
export type { KnowledgeQualityGate } from './quality.js';
export { extractSourceBlocks, normalizeSourceBlocks, readSourceBlocks, readNormalizedBlocks, hashSourceDocument } from './extract.js';
export { buildDraftSlices, readDraftSlices } from './slicer.js';
export type { BuildDraftSlicesInput, BuildDraftSlicesResult } from './slicer.js';
export {
  generateKnowledgeRepairPlan,
  writeKnowledgeRepairPlan,
  readKnowledgeRepairPlan,
  applyKnowledgeRepairPlan,
} from './repair.js';
export { approveQualityCleanDraftSlices, reviewDraftSlices, publishApprovedDraftSlices } from './publish.js';
export type { QualityAutoApprovalResult, ReviewDraftSlicesInput, PublishApprovedDraftSlicesInput } from './publish.js';
export {
  approveSolvedCase,
  convertSolvedToUnresolved,
  loadSolvedCaseDraft,
  rejectSolvedCase,
  requestSolvedCaseEdits,
} from './case-review.js';
export {
  importRedmineIssueFixture,
} from './redmine-card.js';
export type {
  ImportRedmineIssueFixtureInput,
  ImportRedmineIssueFixtureResult,
} from './redmine-card.js';
export { generateKnowledgeMigrationReport } from './migration.js';
export type { KnowledgeMigrationReport } from './migration.js';
export {
  buildKnowledgeVectorIndex,
  checkKnowledgeVectorCompatibility,
  chunkToEmbeddingDocumentInput,
  isChunkEligibleForRemoteEmbedding,
  loadKnowledgeChunksForEmbedding,
  readKnowledgeVectorManifest,
  readKnowledgeVectorRecords,
} from './vector-index.js';
export type {
  BuildKnowledgeVectorIndexInput,
  BuildKnowledgeVectorIndexResult,
  KnowledgeVectorCompatibilityResult,
  KnowledgeVectorCompatibilityStatus,
} from './vector-index.js';
export type {
  // Document types
  KnowledgeChunk,
  KnowledgeConfidence,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeEvidencePack,
  KnowledgeEvidenceResult,
  KnowledgeFrontmatter,
  KnowledgeIndexManifest,
  KnowledgeIngestReport,
  KnowledgeInitResult,
  KnowledgeRoute,
  KnowledgeSearchQuery,
  KnowledgeSourceDocument,
  KnowledgeSourceType,
  KnowledgeStatus,
  KnowledgeUpdateResult,
  KnowledgeVisibility,
  KnowledgeVectorBuildReport,
  KnowledgeVectorManifest,
  KnowledgeVectorRecord,
  // Pipeline types
  KnowledgePipelineStage,
  KnowledgePipelineStatus,
  KnowledgeSourceBlock,
  KnowledgeSourceBlockType,
  KnowledgeNormalizedBlock,
  // Quality types
  KnowledgeQualitySeverity,
  KnowledgeQualityIssueCode,
  KnowledgeQualityIssue,
  KnowledgeQualityThresholds,
  KnowledgeQualityReport,
  // Pipeline reports
  KnowledgeExtractReport,
  KnowledgeNormalizeReport,
  KnowledgeDraftSliceReport,
  KnowledgeRepairAction,
  KnowledgeRepairActionType,
  KnowledgeRepairPlan,
  KnowledgeRepairResult,
  KnowledgeRepairSafety,
  KnowledgeSliceReviewRecord,
  KnowledgeCaseReviewRecord,
  KnowledgeCaseReviewAction,
  KnowledgePublishReport,
  // Acceptance types
  KnowledgeAcceptanceCheck,
  KnowledgeAcceptanceScenario,
  KnowledgeAcceptanceReport,
  KnowledgeAcceptanceSeverity,
} from './types.js';
export { DEFAULT_QUALITY_THRESHOLDS } from './types.js';
