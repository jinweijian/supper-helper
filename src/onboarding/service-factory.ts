import type { SuperHelperConfig } from '../config.js';
import { initKnowledgeWorkspace } from '../knowledge/index.js';
import { commitOnboardingConfig } from './config-commit.js';
import { OnboardingDraftService } from './draft-service.js';
import { FileOnboardingDraftRepository } from './draft-repository.js';
import { runOnboardingKnowledgePipeline } from './knowledge-pipeline.js';
import { OnboardingProgressHub } from './progress.js';
import { testOnboardingProviders } from './provider-tests.js';
import { OnboardingReviewService } from './review-service.js';
import { FileOnboardingRunRepository } from './run-repository.js';
import { OnboardingRunService } from './run-service.js';
import { OnboardingRunner } from './runner.js';
import { OnboardingSecretsService } from './secrets-service.js';
import { FileSecretsRepository } from './secrets.js';
import { validateOnboardingDraft } from './validator.js';
import type { OnboardingDraft, OnboardingValidationResult } from './types.js';

export interface OnboardingOwners {
  draft: OnboardingDraftService;
  review: OnboardingReviewService;
  run: OnboardingRunService;
  secrets: OnboardingSecretsService;
}

export interface OnboardingServiceDependencies {
  config: SuperHelperConfig;
  drafts: FileOnboardingDraftRepository;
  runs: FileOnboardingRunRepository;
  secrets: FileSecretsRepository;
  progress: OnboardingProgressHub;
  runner: Pick<OnboardingRunner, 'execute' | 'retry'>;
  validate(draft: OnboardingDraft): OnboardingValidationResult;
}

export function createOnboardingOwnersFromDependencies(
  dependencies: OnboardingServiceDependencies,
  secrets = new OnboardingSecretsService(dependencies.config, dependencies.secrets),
): OnboardingOwners {
  return {
    secrets,
    draft: new OnboardingDraftService({ ...dependencies, secrets }),
    review: new OnboardingReviewService({ ...dependencies, secrets }),
    run: new OnboardingRunService(dependencies),
  };
}

export function createOnboardingOwners(input: {
  config: SuperHelperConfig;
  onConfigCommitted?(config: SuperHelperConfig): Promise<void> | void;
}): OnboardingOwners {
  const root = input.config.storage.rootDir;
  const drafts = new FileOnboardingDraftRepository(root);
  const runs = new FileOnboardingRunRepository(root);
  const secretRepository = new FileSecretsRepository(root);
  const secrets = new OnboardingSecretsService(input.config, secretRepository);
  const progress = new OnboardingProgressHub();
  const runner = new OnboardingRunner({
    drafts,
    runs,
    progress,
    validate: async (draft) => {
      const result = validateOnboardingDraft(draft, { resolveSecret: (ref) => secrets.resolveSecret(ref) });
      if (!result.ok) throw new Error(`Onboarding draft is invalid: ${result.issues.map((issue) => issue.field).join(', ')}`);
    },
    testProviders: testOnboardingProviders,
    prepareWorkspace: async (draft) => {
      initKnowledgeWorkspace({ workspaceRoot: secrets.knowledgeWorkspaceRoot(draft), qualityGate: 'off' });
    },
    materializeDraftSecrets: (draft) => secrets.materializeDraft(draft),
    runKnowledge: async (runInput) => ({ ...await runOnboardingKnowledgePipeline({
      draft: runInput.draft,
      workspaceRoot: secrets.knowledgeWorkspaceRoot(runInput.draft),
      report: runInput.report,
    }) }) as Record<string, unknown>,
    healthCheck: async () => ({ ok: true }),
    commitConfig: async (draft, runId) => commitOnboardingConfig({ draft, currentConfig: input.config, runId }),
    onConfigCommitted: async (config) => {
      Object.assign(input.config, config);
      await input.onConfigCommitted?.(config);
    },
  });
  return createOnboardingOwnersFromDependencies({
    config: input.config,
    drafts,
    runs,
    secrets: secretRepository,
    progress,
    runner,
    validate: (draft) => validateOnboardingDraft(draft, { resolveSecret: (ref) => secrets.resolveSecret(ref) }),
  }, secrets);
}
