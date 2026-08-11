export function redactSecretText(value: unknown): string {
  return String(value)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/(--?(?:api[-_]?key|token|authorization|cookie|password)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[REDACTED]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(cookie["']?\s*[:=]\s*["']?)[^"',}\n]+/gi, '$1[REDACTED]')
    .replace(/(api[-_]?key["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(password["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]');
}

export function redactInternalPaths(value: string): string {
  return value
    .replace(/knowledge\/(?:_sources|faq|whitepapers)\/[^\s，。；)）\]]+/gi, '内部资料')
    .replace(/\/(?:Users|home)\/[^\s，。；)）\]]+/g, (path) => safePathReplacement(path, '/'))
    .replace(/[A-Za-z]:\\[^\s，。；)）\]]+/g, (path) => safePathReplacement(path, '\\'));
}

function safePathReplacement(path: string, separator: string): string {
  const basename = path.split(separator).filter(Boolean).at(-1) ?? '';
  if (!basename || redactSecretText(basename) !== basename || /^(?:_sources|faq|whitepapers)$/i.test(basename)) {
    return '内部路径';
  }
  return `内部路径/${basename}`;
}

export const redactProviderErrorMessage = redactSecretText;
