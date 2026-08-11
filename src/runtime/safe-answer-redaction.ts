const COMPATIBILITY_SENTINEL_PATTERN =
  /(?:\\b)?[A-Za-z0-9_]*direct_answer(?:_item)?[A-Za-z0-9_]*(?:\\b)?/gi;

export function redactCompatibilitySentinels(value: string): string {
  return value.replace(COMPATIBILITY_SENTINEL_PATTERN, '');
}
