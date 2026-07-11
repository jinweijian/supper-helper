const MAX_MCP_RESULT_CHARS = 20_000;

export interface McpContentLocator {
  kind: 'image' | 'audio' | 'blob';
  locator: string;
  mimeType?: string;
  sizeBytes: number;
}

export interface NormalizedMcpResult {
  text: string;
  structuredContent?: string;
  locators: McpContentLocator[];
  truncated: boolean;
}

export function normalizeMcpResult(value: unknown): NormalizedMcpResult {
  const result = objectValue(value);
  const content = Array.isArray(result.content) ? result.content : [];
  const textParts: string[] = [];
  const locators: McpContentLocator[] = [];

  for (const [index, itemValue] of content.entries()) {
    const item = objectValue(itemValue);
    if (item.type === 'text' && typeof item.text === 'string') {
      textParts.push(item.text);
      continue;
    }
    if ((item.type === 'image' || item.type === 'audio') && typeof item.data === 'string') {
      locators.push({
        kind: item.type,
        locator: `mcp://content/${index}`,
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
        sizeBytes: base64Size(item.data),
      });
      continue;
    }
    if (item.type === 'resource') {
      const resource = objectValue(item.resource);
      if (typeof resource.text === 'string') {
        textParts.push(resource.text);
      } else if (typeof resource.blob === 'string') {
        locators.push({
          kind: 'blob',
          locator: typeof resource.uri === 'string' ? resource.uri : `mcp://content/${index}`,
          mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : undefined,
          sizeBytes: base64Size(resource.blob),
        });
      }
    }
  }

  const text = redactMcpText(textParts.join('\n'));
  const structured = result.structuredContent === undefined
    ? undefined
    : redactMcpText(safeJson(result.structuredContent));
  const textBudget = structured ? Math.floor(MAX_MCP_RESULT_CHARS * 0.75) : MAX_MCP_RESULT_CHARS;
  const boundedText = text.slice(0, textBudget);
  const remaining = MAX_MCP_RESULT_CHARS - boundedText.length;
  const boundedStructured = structured?.slice(0, remaining);
  return {
    text: boundedText,
    structuredContent: boundedStructured,
    locators,
    truncated: text.length > boundedText.length || Boolean(structured && structured.length > (boundedStructured?.length ?? 0)),
  };
}

export function redactMcpText(value: string): string {
  return value
    .replace(/authorization\s*[:=]\s*(?:bearer\s+)?[^;,\n]+/gi, '[redacted]')
    .replace(/"?(?:token|password|passwd|cookie|secret|api[_-]?key)"?\s*[:=]\s*"?[^",;\s}]+"?/gi, '[redacted]')
    .replace(/(?:\/[A-Za-z0-9._-]+){2,}/g, '[path]');
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable structured content]';
  }
}

function base64Size(value: string): number {
  try {
    return Buffer.from(value, 'base64').length;
  } catch {
    return 0;
  }
}
