import { configuredWorkspaceId, type SuperHelperConfig } from '../config.js';
import { assertSafeCaseId, InvalidCaseIdError } from '../sessions/case-identifier.js';
import { badRequest, PayloadTooLargeError } from './errors.js';

export const MAX_CHAT_MESSAGE_BYTES = 65_536;

export function requireCaseId(value: string | null | undefined): string {
  if (!value) {
    return badRequest('caseId is required');
  }
  try {
    return assertSafeCaseId(value);
  } catch (error) {
    if (error instanceof InvalidCaseIdError) {
      return badRequest('invalid case id');
    }
    throw error;
  }
}

export function resolveConfiguredWorkspaceId(
  config: SuperHelperConfig,
  requested?: string | null,
): string {
  return configuredWorkspaceId(config, requested);
}

export function assertChatMessageSize(message: string): void {
  if (Buffer.byteLength(message, 'utf8') > MAX_CHAT_MESSAGE_BYTES) {
    throw new PayloadTooLargeError('message too large');
  }
}
