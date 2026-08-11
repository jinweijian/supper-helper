export function createMonotonicDeadline(
  requestedTimeoutMs,
  clock = () => performance.now(),
) {
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(30_000, requestedTimeoutMs)
    : 300_000;
  const startedAt = clock();
  return {
    timeoutMs,
    expired: () => clock() - startedAt >= timeoutMs,
  };
}

export function describeWorkerExecutionFailure(trace) {
  const fields = [];
  if (Number.isInteger(trace?.exitCode)) {
    fields.push(`exitCode=${trace.exitCode}`);
  }
  if (typeof trace?.signal === 'string' && trace.signal.length > 0) {
    fields.push(`signal=${boundedSafeText(trace.signal)}`);
  }
  if (typeof trace?.error === 'string' && trace.error.length > 0) {
    fields.push(`error=${boundedSafeText(trace.error)}`);
  }
  return fields.join('; ') || 'worker execution failed without bounded metadata';
}

export function resolveRealAcceptanceTimeoutMs(workerTimeoutMs, override) {
  const explicit = Number(override);
  if (override !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.max(30_000, explicit);
  }

  const workerBudget = Number.isFinite(workerTimeoutMs) && workerTimeoutMs > 0
    ? workerTimeoutMs
    : 300_000;
  return Math.min(Math.max(30_000, workerBudget + 300_000), 1_800_000);
}

export function shouldRetryAcceptancePoll(error) {
  return error instanceof TypeError;
}

export function assertAcceptancePollResponse(response) {
  if (response?.ok === true) {
    return;
  }
  const status = Number.isInteger(response?.status) ? response.status : 'unknown';
  throw new Error(`session poll returned HTTP ${status}`);
}

function boundedSafeText(value) {
  return Array.from(String(value)
    .replace(/(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)/gi, '[REDACTED]'))
    .slice(0, 160)
    .join('');
}
