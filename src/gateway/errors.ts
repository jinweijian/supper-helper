import type { ServerResponse } from 'node:http';
import { InvalidWorkspaceIdError } from '../config.js';
import { InvalidCaseIdError } from '../sessions/case-identifier.js';

export class GatewayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = 'GatewayHttpError';
  }
}

export function badRequest(message: string): never {
  throw new GatewayHttpError(400, message);
}

export class PayloadTooLargeError extends GatewayHttpError {
  constructor(message = 'payload too large') {
    super(413, message);
    this.name = 'PayloadTooLargeError';
  }
}

export class InvalidJsonBodyError extends GatewayHttpError {
  constructor() {
    super(400, 'invalid JSON body');
    this.name = 'InvalidJsonBodyError';
  }
}

export function sendGatewayError(
  res: ServerResponse,
  error: unknown,
  reportInternalError: (message: string) => void,
): void {
  if (error instanceof GatewayHttpError) {
    writeError(res, error.status, error.publicMessage);
    return;
  }
  if (error instanceof InvalidCaseIdError) {
    writeError(res, 400, 'invalid case id');
    return;
  }
  if (error instanceof InvalidWorkspaceIdError) {
    writeError(res, 400, 'invalid workspaceId');
    return;
  }
  reportInternalError(`[gateway] ${redactGatewayDiagnostic(error)}`);
  writeError(res, 500, 'internal server error');
}

function writeError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: message }, null, 2));
}

export function redactGatewayDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .replace(/authorization\s*[:=]\s*(?:bearer\s+)?[^;,\n]+/gi, '[redacted]')
    .replace(/\b(?:token|password|passwd|cookie|secret|api[_-]?key)\s*[:=]\s*[^;,\s]+/gi, '[redacted]')
    .replace(/(?:\/[A-Za-z0-9._-]+){2,}/g, '[path]')
    .slice(0, 2_000);
}
