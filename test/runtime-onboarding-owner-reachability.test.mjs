import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const lines = (path) => read(path).split(/\r?\n/).length;

test('event recorder phase owners are real production imports without a giant implementation', () => {
  assert.equal(existsSync(join(root, 'src/runtime/event-recorder-impl.ts')), false);
  const aggregator = read('src/runtime/event-recorder/index.ts');
  for (const owner of ['conversation', 'preflight', 'knowledge', 'review', 'curator', 'worker']) {
    const path = `src/runtime/event-recorder/${owner}.ts`;
    const source = read(path);
    assert.ok(lines(path) >= 20, `${path} is still a marker`);
    assert.doesNotMatch(source, /PHASE_GROUP|event-recorder-impl/);
    assert.match(aggregator, new RegExp(`from ['"]\\./${owner}\\.js['"]`));
  }
  assert.ok(lines('src/runtime/event-recorder/index.ts') <= 80);
});

test('onboarding focused services own behavior and facade stays narrow', () => {
  const facade = read('src/onboarding/service.ts');
  assert.ok(lines('src/onboarding/service.ts') <= 80);
  for (const owner of ['draft-service', 'review-service', 'run-service', 'secrets-service']) {
    const path = `src/onboarding/${owner}.ts`;
    const source = read(path);
    assert.ok(lines(path) >= 20, `${path} is still a duplicate re-export`);
    assert.ok(lines(path) <= 300, `${path} exceeds owner budget`);
    assert.doesNotMatch(source, /from ['"]\.\/service\.js['"]/);
    assert.match(facade, new RegExp(`from ['"]\\./${owner}\\.js['"]`));
  }
});

test('Onboarding facade delegates every public use case to its focused owner', async () => {
  const { OnboardingService } = await import('../dist/onboarding/service.js');
  const calls = [];
  const draft = {
    getState: () => { calls.push('draft.getState'); return { completed: false, needsReview: false }; },
    saveDraft: async () => { calls.push('draft.saveDraft'); },
    validateDraft: async () => { calls.push('draft.validateDraft'); return { ok: true, issues: [] }; },
  };
  const review = {
    getReviewState: () => { calls.push('review.getReviewState'); return { required: false, items: [] }; },
    submitReview: async () => { calls.push('review.submitReview'); return { review: { required: false, items: [] } }; },
  };
  const run = {
    startRun: async () => { calls.push('run.startRun'); return { id: 'run_owner' }; },
    getRun: () => { calls.push('run.getRun'); return { id: 'run_owner' }; },
    retryRun: async () => { calls.push('run.retryRun'); return { id: 'run_owner' }; },
    subscribe: () => { calls.push('run.subscribe'); return () => {}; },
    recoverInterrupted: () => { calls.push('run.recoverInterrupted'); return []; },
  };
  const service = new OnboardingService({ draft, review, run, secrets: {} });

  service.getState();
  await service.saveDraft({});
  await service.validateDraft();
  service.getReviewState();
  await service.submitReview({});
  await service.startRun();
  service.getRun('run_owner');
  await service.retryRun('run_owner');
  service.subscribe('run_owner', () => {});
  service.recoverInterrupted();

  assert.deepEqual(calls, [
    'review.getReviewState', 'draft.getState', 'draft.saveDraft',
    'review.getReviewState', 'draft.getState', 'draft.validateDraft',
    'review.getReviewState', 'review.submitReview', 'run.startRun', 'run.getRun',
    'run.retryRun', 'run.subscribe', 'run.recoverInterrupted',
  ]);
});

test('Main Agent keeps only global authority and Case-scoped memory policy', () => {
  const main = read('src/agents/main.md');
  assert.ok(main.split(/\r?\n/).length <= 180);
  assert.match(main, /AnswerGoal/);
  assert.match(main, /Case-scoped|per-case/i);
  assert.match(main, /不能乱猜/);
  assert.doesNotMatch(main, /^## (Preflight Gate|DiagnosticResult|Output Review|Prompt Regression Cases)$/m);
});
