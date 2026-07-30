export function selectAnswerSpan(input: {
  text: string;
  matchedTerms?: string[];
}): string | undefined {
  const canonicalBody = normalize(input.text.replace(/^\s*#{1,6}\s+.*$/gm, ''));
  const terms = Array.from(new Set((input.matchedTerms ?? [])
    .map((term) => normalize(term))
    .filter((term) => Array.from(term).length >= 2)))
    .filter((term) => canonicalBody.includes(term));
  if (terms.length === 0) return undefined;

  const segments = splitCompleteSegments(input.text);
  const candidates: Array<{ text: string; size: number; start: number }> = [];
  for (let size = 1; size <= 3; size += 1) {
    for (let start = 0; start + size <= segments.length; start += 1) {
      const window = segments.slice(start, start + size);
      const text = joinSegments(window);
      if (Array.from(text).length > 500) continue;
      const normalized = normalize(text);
      if (terms.every((term) => normalized.includes(term))) {
        candidates.push({ text, size, start });
      }
    }
  }
  return candidates
    .sort((left, right) => (
      left.size - right.size ||
      Array.from(left.text).length - Array.from(right.text).length ||
      left.start - right.start
    ))[0]?.text;
}

interface CompleteSegment {
  text: string;
  line: number;
}

function splitCompleteSegments(text: string): CompleteSegment[] {
  return text.split(/\n/).flatMap((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed || /^#{1,6}\s+/.test(trimmed)) return [];
    if (/^(?:[-*+]|\d+[.)、])\s*/.test(trimmed)) {
      return [{ text: trimmed, line: lineIndex }];
    }
    return (trimmed.match(/[^。！？!?;；.]+(?:[。！？!?;；.]|$)/g) ?? [])
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => ({ text: segment, line: lineIndex }));
  });
}

function joinSegments(segments: CompleteSegment[]): string {
  return segments.reduce((result, segment, index) => {
    if (index === 0) return segment.text;
    const separator = segments[index - 1]!.line === segment.line ? ' ' : '\n';
    return `${result}${separator}${segment.text}`;
  }, '');
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}
