export function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentArrayKey: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const arrayItem = line.match(/^\s*-\s*(.*)$/);
    if (arrayItem && currentArrayKey) {
      if (!Array.isArray(result[currentArrayKey])) result[currentArrayKey] = [];
      (result[currentArrayKey] as unknown[]).push(parseScalar(arrayItem[1] ?? ''));
      continue;
    }
    const keyValue = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!keyValue) { currentArrayKey = undefined; continue; }
    const key = keyValue[1]!;
    const value = keyValue[2] ?? '';
    if (!value.trim()) { result[key] = []; currentArrayKey = key; }
    else { result[key] = parseScalar(value); currentArrayKey = undefined; }
  }
  return result;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '[]') return [];
  if (trimmed === 'null') return undefined;
  if (/^\[.*\]$/.test(trimmed)) {
    return trimmed.slice(1, -1).split(',').map((item) => parseScalar(item)).filter((item) => item !== '');
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, '');
}
