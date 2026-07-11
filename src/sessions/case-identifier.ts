import { isAbsolute, relative, resolve } from 'node:path';

const SAFE_CASE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class InvalidCaseIdError extends Error {
  constructor() {
    super('invalid case id');
    this.name = 'InvalidCaseIdError';
  }
}

export function assertSafeCaseId(caseId: string): string {
  if (!SAFE_CASE_ID.test(caseId)) {
    throw new InvalidCaseIdError();
  }
  return caseId;
}

export function resolveContainedCasePath(casesDir: string, caseId: string): string {
  const safeId = assertSafeCaseId(caseId);
  const root = resolve(casesDir);
  const target = resolve(root, `${safeId}.json`);
  const pathFromRoot = relative(root, target);
  if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new InvalidCaseIdError();
  }
  return target;
}
