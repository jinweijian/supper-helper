export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${toYaml(frontmatter)}\n---\n\n${body.trim()}\n`;
}

export function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return /[:#\[\]{},"']|\s$|^\s/.test(value) ? JSON.stringify(value) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map((item) => `${pad}- ${toYaml(item, indent + 1)}`).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (Array.isArray(item) || (item && typeof item === 'object')) return `${pad}${key}:\n${toYaml(item, indent + 1)}`;
      return `${pad}${key}: ${toYaml(item, indent + 1)}`;
    }).join('\n');
  }
  return String(value);
}
