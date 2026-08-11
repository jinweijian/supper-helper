import type { DiagnosticRequest, DiagnosticResult } from '../../domain.js';
import { closeSync, constants as fsConstants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { redactInternalPaths, redactSecretText } from '../../redaction.js';

const MAX_SAFE_EXCERPT_CODE_POINTS = 1000;
const MAX_WORKSPACE_EVIDENCE_FILE_BYTES = 2_000_000;

export function currentWorkerCoverageEvidence(
  request: DiagnosticRequest,
  result: DiagnosticResult,
  workspaceRoot: string,
): NonNullable<import('../../domain.js').ClaudeWorkerResponse['coverageEvidence']> {
  return result.evidence.flatMap((item) => {
    if (
      item.kind !== 'workspace' ||
      item.confidence === 'low'
    ) {
      return [];
    }
    const safeText = readVerifiedWorkspaceExcerpt(workspaceRoot, item.source);
    if (!safeText || Array.from(safeText).length > MAX_SAFE_EXCERPT_CODE_POINTS) {
      return [];
    }
    return [{
      evidenceId: item.id,
      kind: item.kind,
      safeText,
      runId: request.runId,
      validated: true,
    }];
  });
}

function readVerifiedWorkspaceExcerpt(workspaceRoot: string, source: string): string {
  const locator = source.trim().match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (!locator) return '';
  const sourcePath = locator[1]?.trim() ?? '';
  const startLine = Number(locator[2]);
  const endLine = Number(locator[3] ?? locator[2]);
  if (!sourcePath || !Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine > 40) {
    return '';
  }
  try {
    const root = realpathSync(workspaceRoot);
    const candidate = realpathSync(isAbsolute(sourcePath) ? sourcePath : resolve(root, sourcePath));
    const relativePath = relative(root, candidate);
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      return '';
    }
    const file = openSync(candidate, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    let content = '';
    try {
      const stat = fstatSync(file);
      if (!stat.isFile() || stat.size > MAX_WORKSPACE_EVIDENCE_FILE_BYTES) return '';
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const bytesRead = readSync(file, buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      content = buffer.subarray(0, offset).toString('utf8');
    } finally {
      closeSync(file);
    }
    const lines = content.split(/\r?\n/);
    if (endLine > lines.length) return '';
    return safeWorkerExcerpt(lines.slice(startLine - 1, endLine).join('\n'));
  } catch {
    return '';
  }
}

function safeWorkerExcerpt(value: string): string {
  return redactInternalPaths(redactSecretText(value))
    .replace(/\b(?:stdout|stderr|provider[_ -]?payload|worker[_ -]?trace)\s*[:=][^\n]*/gi, '[内部诊断信息已隐藏]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
