import type { SuperHelperConfig } from '../config.js';
import type { OnboardingDraftService } from './draft-service.js';
import type { OnboardingReviewService } from './review-service.js';
import type { OnboardingRunService } from './run-service.js';
import type { OnboardingSecretsService } from './secrets-service.js';
import {
  createOnboardingOwners,
  createOnboardingOwnersFromDependencies,
  type OnboardingOwners,
  type OnboardingServiceDependencies,
} from './service-factory.js';
import type {
  OnboardingDraftInput,
  OnboardingProgressEvent,
  OnboardingReviewInput,
  OnboardingReviewQuery,
} from './types.js';

type OwnerSet = OnboardingOwners & {
  draft: Pick<OnboardingDraftService, 'getState' | 'saveDraft' | 'validateDraft'>;
  review: Pick<OnboardingReviewService, 'getReviewState' | 'submitReview'>;
  run: Pick<OnboardingRunService, 'startRun' | 'getRun' | 'retryRun' | 'subscribe' | 'recoverInterrupted'>;
  secrets: OnboardingSecretsService;
};

/** Public compatibility facade. Business decisions live in the focused owners. */
export class OnboardingService {
  private readonly owners: OwnerSet;

  constructor(owners: OwnerSet | OnboardingServiceDependencies) {
    this.owners = 'draft' in owners ? owners : createOnboardingOwnersFromDependencies(owners);
  }

  getState() { return this.owners.draft.getState(this.owners.review.getReviewState({ limit: 20 })); }
  async saveDraft(input: OnboardingDraftInput) { await this.owners.draft.saveDraft(input); return this.getState(); }
  validateDraft() { return this.owners.draft.validateDraft(); }
  getReviewState(query?: OnboardingReviewQuery) { return this.owners.review.getReviewState(query); }
  submitReview(input: OnboardingReviewInput) { return this.owners.review.submitReview(input); }
  startRun() { return this.owners.run.startRun(); }
  getRun(id: string) { return this.owners.run.getRun(id); }
  retryRun(id: string) { return this.owners.run.retryRun(id); }
  subscribe(id: string, listener: (event: OnboardingProgressEvent) => void) { return this.owners.run.subscribe(id, listener); }
  recoverInterrupted() { return this.owners.run.recoverInterrupted(); }
}

export function createOnboardingService(input: {
  config: SuperHelperConfig;
  onConfigCommitted?(config: SuperHelperConfig): Promise<void> | void;
}): OnboardingService {
  return new OnboardingService(createOnboardingOwners(input));
}
