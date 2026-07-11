import { randomUUID } from 'node:crypto';
import { createEmbeddingProvider } from '../providers/embedding/factory.js';
import { checkKnowledgeVectorCompatibility, discoverSourceFiles } from '../knowledge/index.js';
import { buildOnboardingPlan } from './planner.js';
import type { OnboardingProgressHub } from './progress.js';
import { providerHasExecutionCredentials } from './provider-credentials.js';
import type { FileOnboardingDraftRepository } from './draft-repository.js';
import type { FileOnboardingRunRepository } from './run-repository.js';
import { createOnboardingRun, type OnboardingRunner } from './runner.js';
import type { OnboardingProgressEvent, OnboardingRun } from './types.js';

export class OnboardingRunService {
  constructor(private readonly dependencies: {
    drafts: FileOnboardingDraftRepository;
    runs: FileOnboardingRunRepository;
    progress: OnboardingProgressHub;
    runner: Pick<OnboardingRunner, 'execute' | 'retry'>;
  }) {}

  async startRun(): Promise<OnboardingRun> {
    const active = this.dependencies.runs.findActive();
    if (active) throw new Error(`onboarding run already active: ${active.id}`);
    const draft = this.dependencies.drafts.load();
    if (!draft) throw new Error('onboarding draft is required');
    const run = this.dependencies.runs.save(createOnboardingRun({
      id: `run_${randomUUID()}`,
      draft,
      plan: buildOnboardingPlan({
        draft,
        sourceChanges: sourceChangesForDraft(draft),
        keywordIndexDirty: true,
        vectorCompatibility: vectorCompatibilityForDraft(draft),
      }),
      now: new Date().toISOString(),
    }));
    queueMicrotask(() => { void this.dependencies.runner.execute(run); });
    return run;
  }

  getRun(id: string): OnboardingRun | undefined {
    return this.dependencies.runs.load(id);
  }

  retryRun(id: string): Promise<OnboardingRun> {
    return this.dependencies.runner.retry(id);
  }

  subscribe(id: string, listener: (event: OnboardingProgressEvent) => void): () => void {
    return this.dependencies.progress.subscribe(id, listener);
  }

  recoverInterrupted(): OnboardingRun[] {
    return this.dependencies.runs.recoverInterrupted();
  }
}

function sourceChangesForDraft(draft: Parameters<typeof buildOnboardingPlan>[0]['draft']) {
  if (!draft.knowledge.sourceDir) return { added: [], changed: [], unchanged: [] };
  return { added: discoverSourceFiles(draft.knowledge.sourceDir), changed: [], unchanged: [] };
}

function vectorCompatibilityForDraft(
  draft: Parameters<typeof buildOnboardingPlan>[0]['draft'],
): 'compatible' | 'missing-index' | 'rebuild-required' {
  if (!draft.knowledge.buildVectorIndex || !draft.embedding.enabled || !providerHasExecutionCredentials(draft.embedding)) {
    return 'compatible';
  }
  try {
    createEmbeddingProvider(draft.embedding);
    return checkKnowledgeVectorCompatibility({
      workspaceRoot: draft.knowledge.rootDir,
      embeddingConfig: draft.embedding,
    }).status;
  } catch {
    return 'rebuild-required';
  }
}
