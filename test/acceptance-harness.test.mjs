import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAcceptancePollResponse,
  createMonotonicDeadline,
  describeWorkerExecutionFailure,
  resolveRealAcceptanceTimeoutMs,
  shouldRetryAcceptancePoll,
} from '../scripts/acceptance-time.mjs';

test('real acceptance deadline uses elapsed monotonic time and bounds invalid input', () => {
  let monotonicNow = 1_000;
  const deadline = createMonotonicDeadline(30_000, () => monotonicNow);

  monotonicNow = 30_999;
  assert.equal(deadline.expired(), false);
  monotonicNow = 31_000;
  assert.equal(deadline.expired(), true);

  const invalid = createMonotonicDeadline(Number.NaN, () => monotonicNow);
  assert.equal(invalid.timeoutMs, 300_000);
});

test('real acceptance reports bounded worker failure metadata without provider output', () => {
  assert.equal(
    describeWorkerExecutionFailure({
      exitCode: 1,
      signal: 'SIGTERM',
      error: 'Bearer provider-secret Command exited with code 1',
      stdout: 'provider payload must stay hidden',
      stderr: 'provider stderr must stay hidden',
    }),
    'exitCode=1; signal=SIGTERM; error=[REDACTED] Command exited with code 1',
  );
});

test('real acceptance timeout includes the configured worker budget and review reserve', () => {
  assert.equal(resolveRealAcceptanceTimeoutMs(1_200_000, undefined), 1_500_000);
  assert.equal(resolveRealAcceptanceTimeoutMs(1_200_000, '900000'), 900_000);
  assert.equal(resolveRealAcceptanceTimeoutMs(1_200_000, 'invalid'), 1_500_000);
});

test('real acceptance retries only transient fetch polling failures', () => {
  assert.equal(shouldRetryAcceptancePoll(new TypeError('fetch failed')), true);
  assert.equal(shouldRetryAcceptancePoll(new Error('invalid session payload')), false);
});

test('real acceptance fails fast on a non-success session response without reading its body', () => {
  assert.throws(
    () => assertAcceptancePollResponse({ ok: false, status: 503 }),
    /session poll returned HTTP 503/,
  );
  assert.doesNotThrow(() => assertAcceptancePollResponse({ ok: true, status: 200 }));
});
