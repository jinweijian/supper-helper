import { createEmbeddingProvider } from '../providers/embedding/factory.js';
import {
  publishApprovedDraftSlices,
  reviewDraftSlices,
} from '../knowledge/index.js';
import { rebuildKnowledgeArtifacts } from '../application/knowledge-rebuild-service.js';
import type { FileOnboardingDraftRepository } from './draft-repository.js';
import { providerHasExecutionCredentials } from './provider-credentials.js';
import { buildReviewState, emptyReviewState } from './review-state.js';
import type { FileOnboardingRunRepository } from './run-repository.js';
import type { OnboardingSecretsService } from './secrets-service.js';
import type {
  OnboardingDraft,
  OnboardingReviewInput,
  OnboardingReviewItem,
  OnboardingReviewQuery,
  OnboardingReviewResult,
  OnboardingReviewState,
} from './types.js';

export class OnboardingReviewService {
  constructor(private readonly dependencies: {
    drafts: FileOnboardingDraftRepository;
    runs: FileOnboardingRunRepository;
    secrets: OnboardingSecretsService;
  }) {}

  getReviewState(query?: OnboardingReviewQuery): OnboardingReviewState {
    const draft = this.dependencies.secrets.loadEffectiveDraft(this.dependencies.drafts);
    if (!draft) return emptyReviewState(query);
    return buildReviewState({ workspaceRoot: this.dependencies.secrets.knowledgeWorkspaceRoot(draft), query });
  }

  async submitReview(input: OnboardingReviewInput): Promise<OnboardingReviewResult> {
    const draft = this.dependencies.drafts.load();
    if (!draft) throw new Error('onboarding draft is required');
    const action = normalizeReviewAction(input.action);
    const reviewer = input.reviewer?.trim() || 'super-helper-dashboard';
    const notes = input.notes?.trim() || (action === 'accept_warnings'
      ? 'Dashboard reviewer accepted warning-quality slices for publish.'
      : 'Dashboard reviewer updated onboarding draft slices.');
    const workspaceRoot = this.dependencies.secrets.knowledgeWorkspaceRoot(draft);
    const current = buildReviewState({ workspaceRoot });
    const targets = selectReviewTargets(current.items, input);
    if (targets.length === 0) return { review: current, publishedSlices: 0, indexedDocuments: 0, indexedChunks: 0 };
    const blocked = targets.filter((item) => item.qualitySeverity === 'error');
    if (blocked.length > 0 && (action === 'approve' || action === 'accept_warnings')) {
      throw new Error(`blocked slices cannot be approved without repair: ${blocked.map((item) => item.id).join(', ')}`);
    }
    for (const [sourceDocumentId, ids] of groupReviewTargets(targets)) {
      reviewDraftSlices({ workspaceRoot, sourceDocumentId, action, reviewer, notes, ids });
    }
    return this.refreshArtifacts(draft, workspaceRoot, input.query);
  }

  private async refreshArtifacts(
    draft: OnboardingDraft,
    workspaceRoot: string,
    query?: OnboardingReviewQuery,
  ): Promise<OnboardingReviewResult> {
    const publish = publishApprovedDraftSlices({ workspaceRoot, qualityGate: 'warn' });
    const vectorEnabled = draft.knowledge.buildVectorIndex
      && draft.embedding.enabled
      && providerHasExecutionCredentials(draft.embedding);
    const executionDraft = vectorEnabled
      ? this.dependencies.secrets.materializeDraft(draft)
      : undefined;
    const rebuilt = await rebuildKnowledgeArtifacts({
      workspaceRoot,
      chunking: draft.knowledge.chunking,
      ...(executionDraft
        ? {
            embedding: {
              enabled: true,
              provider: createEmbeddingProvider(executionDraft.embedding),
              config: executionDraft.embedding,
            },
          }
        : {}),
    });
    const index = rebuilt.index;
    const vectorCount = rebuilt.vector?.vectorCount;
    const review = buildReviewState({ workspaceRoot, query });
    this.updateLatestRun({
      pendingReviewSlices: review.pendingCount,
      blockedSlices: review.blockedCount,
      publishedSlicesDelta: publish.publishedIds.length,
      indexedDocuments: index.documentCount,
      indexedChunks: index.chunkCount,
      vectorCount,
    });
    return {
      review,
      publishedSlices: publish.publishedIds.length,
      indexedDocuments: index.documentCount,
      indexedChunks: index.chunkCount,
      vectorCount,
    };
  }

  private updateLatestRun(input: {
    pendingReviewSlices: number;
    blockedSlices: number;
    publishedSlicesDelta: number;
    indexedDocuments: number;
    indexedChunks: number;
    vectorCount?: number;
  }): void {
    const latest = this.dependencies.runs.latest();
    if (!latest) return;
    this.dependencies.runs.save({
      ...latest,
      counters: {
        ...latest.counters,
        pendingReviewSlices: input.pendingReviewSlices,
        blockedSlices: input.blockedSlices,
        publishedSlices: (latest.counters.publishedSlices ?? 0) + input.publishedSlicesDelta,
        indexedDocuments: input.indexedDocuments,
        indexedChunks: input.indexedChunks,
        ...(input.vectorCount === undefined ? {} : { vectorCount: input.vectorCount }),
      },
      updatedAt: new Date().toISOString(),
    });
  }
}

function normalizeReviewAction(action: OnboardingReviewInput['action']): OnboardingReviewInput['action'] {
  if (!['approve', 'reject', 'request_edits', 'accept_warnings'].includes(action)) {
    throw new Error(`invalid review action: ${action}`);
  }
  return action;
}

function selectReviewTargets(items: OnboardingReviewItem[], input: OnboardingReviewInput): OnboardingReviewItem[] {
  const ids = new Set(input.ids ?? []);
  return items.filter((item) => (!input.sourceDocumentId || item.sourceDocumentId === input.sourceDocumentId)
    && (ids.size === 0 || ids.has(item.id)));
}

function groupReviewTargets(items: OnboardingReviewItem[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const item of items) grouped.set(item.sourceDocumentId, [...(grouped.get(item.sourceDocumentId) ?? []), item.id]);
  return grouped;
}
