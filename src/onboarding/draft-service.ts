import type { SuperHelperConfig } from '../config.js';
import type { FileOnboardingDraftRepository } from './draft-repository.js';
import type { FileOnboardingRunRepository } from './run-repository.js';
import type { OnboardingSecretsService } from './secrets-service.js';
import type {
  OnboardingDraft,
  OnboardingDraftInput,
  OnboardingReviewState,
  OnboardingValidationResult,
  PublicOnboardingState,
} from './types.js';

export class OnboardingDraftService {
  constructor(private readonly dependencies: {
    config: SuperHelperConfig;
    drafts: FileOnboardingDraftRepository;
    runs: FileOnboardingRunRepository;
    secrets: OnboardingSecretsService;
    validate(draft: OnboardingDraft): OnboardingValidationResult;
  }) {}

  getState(review: OnboardingReviewState): PublicOnboardingState {
    const draft = this.loadEffectiveDraft();
    return {
      completed: Boolean(this.dependencies.config.onboarding.completedAt),
      needsReview: review.required,
      draft: draft ? this.dependencies.secrets.sanitizeDraft(draft) : undefined,
      latestRun: this.dependencies.runs.latest(),
      validation: draft ? this.dependencies.validate(draft) : undefined,
      review,
    };
  }

  async saveDraft(input: OnboardingDraftInput): Promise<void> {
    const draft = this.dependencies.secrets.createDraft(input, this.loadEffectiveDraft());
    this.dependencies.drafts.save(draft);
  }

  async validateDraft(): Promise<OnboardingValidationResult> {
    const draft = this.loadEffectiveDraft();
    if (!draft) {
      return {
        ok: false,
        issues: [{ field: 'draft', code: 'missing_draft', message: 'Onboarding draft is required.' }],
      };
    }
    return this.dependencies.validate(draft);
  }

  loadEffectiveDraft(): OnboardingDraft | undefined {
    return this.dependencies.secrets.loadEffectiveDraft(this.dependencies.drafts);
  }
}
