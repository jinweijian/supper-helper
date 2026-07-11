import type { WorkerTrace } from '../domain.js';
import { redactSecretText } from '../redaction.js';

export function sanitizeWorkerTrace(trace: WorkerTrace): WorkerTrace {
  return {
    command: bounded(trace.command, 2000),
    cwd: bounded(trace.cwd, 1000),
    stdout: bounded(trace.stdout, 8000),
    stderr: bounded(trace.stderr, 8000),
    exitCode: trace.exitCode,
    signal: trace.signal,
    error: trace.error ? bounded(trace.error, 2000) : undefined,
    startedAt: trace.startedAt,
    finishedAt: trace.finishedAt,
  };
}

function bounded(value: string, limit: number): string {
  return redactSecretText(value).slice(0, limit);
}
