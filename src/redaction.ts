export function redactSecretText(value: unknown): string {
  return String(value)
    .replace(/(--?(?:api[-_]?key|token|authorization|cookie|password)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[REDACTED]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(cookie["']?\s*[:=]\s*["']?)[^"',}\n]+/gi, '$1[REDACTED]')
    .replace(/(api[-_]?key["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(password["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]');
}

export const redactProviderErrorMessage = redactSecretText;
